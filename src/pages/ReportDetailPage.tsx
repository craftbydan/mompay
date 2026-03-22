import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { UploadZone, type UploadItem } from '../components/UploadZone'
import { ReviewTable, type ExpenseRow } from '../components/ReviewTable'
import { supabase } from '../lib/supabase'
import { runOcr } from '../lib/ocr'
import { normalizeMerchant } from '../lib/normalize'
import { friendlyProcessingError } from '../lib/uploadErrors'
import type { ExpenseCategory, Report } from '../types'
import { defaultMomIncludedInPay, defaultOtherOkForMom } from '../lib/momPay'

/** Parallel slip pipeline (create row → upload → OCR → normalize). OpenAI tier RPM/TPM may limit higher values. */
const CONCURRENCY = 10

export function ReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [report, setReport] = useState<Report | null>(null)
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [uploadItems, setUploadItems] = useState<UploadItem[]>([])
  const queueRef = useRef<UploadItem[]>([])
  const activeRef = useRef(0)

  const [publishing, setPublishing] = useState(false)
  const [confirmingAll, setConfirmingAll] = useState(false)
  const [deletingDraft, setDeletingDraft] = useState(false)

  // ─── Data loading ──────────────────────────────────────────────────────────

  const fetchExpenses = useCallback(async (reportId: string) => {
    const { data } = await supabase
      .from('expenses')
      .select('*, merchant:merchants(id, canonical_name), ocr:ocr_raw(raw_merchant_string)')
      .eq('report_id', reportId)
      .order('date', { ascending: true })

    const rows = (data ?? []) as unknown as ExpenseRow[]

    // Batch-generate signed URLs for all receipts in one request
    if (rows.length > 0) {
      const paths = rows.map(e => `expenses/${e.id}`)
      const { data: signed } = await supabase.storage
        .from('receipts')
        .createSignedUrls(paths, 3600)

      if (signed) {
        const urlMap = Object.fromEntries(
          signed.map(s => [s.path?.replace('expenses/', '') ?? '', s.signedUrl ?? null])
        )
        rows.forEach(e => { e.signedImageUrl = urlMap[e.id] ?? null })
      }
    }

    setExpenses(rows)
  }, [])

  // Auto-set report period from the min/max dates across all expenses
  const syncReportDates = useCallback(async (reportId: string) => {
    const { data } = await supabase
      .from('expenses')
      .select('date')
      .eq('report_id', reportId)
      .not('date', 'is', null)

    if (!data || data.length === 0) return

    const dates = data.map((e: { date: string }) => e.date).sort()
    const period_start = dates[0]
    const period_end = dates[dates.length - 1]

    await supabase
      .from('reports')
      .update({ period_start, period_end })
      .eq('id', reportId)

    setReport(r => r ? { ...r, period_start, period_end } : r)
  }, [])

  useEffect(() => {
    if (!id) return
    setLoading(true)

    supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setNotFound(true)
        } else {
          setReport(data as Report)
          fetchExpenses(id)
        }
        setLoading(false)
      })
  }, [id, fetchExpenses])

  // ─── Upload + OCR pipeline ─────────────────────────────────────────────────

  function updateItem(key: string, patch: Partial<UploadItem>) {
    setUploadItems(prev => prev.map(i => (i.key === key ? { ...i, ...patch } : i)))
    // Keep queueRef in sync
    const idx = queueRef.current.findIndex(i => i.key === key)
    if (idx !== -1) queueRef.current[idx] = { ...queueRef.current[idx], ...patch }
  }

  async function processItem(item: UploadItem) {
    activeRef.current++

    try {
      // 1. Create placeholder expense
      updateItem(item.key, { status: 'creating' })
      const today = new Date().toISOString().split('T')[0]
      const { data: expense, error: createErr } = await supabase
        .from('expenses')
        .insert({
          report_id: id!,
          date: today,
          amount: 0,
          currency: 'THB',
          status: 'pending',
          needs_review: true,
          auto_classified: false,
          payment_method: 'unknown',
          category: 'other',
          mom_pay_mode: 'cap',
          mom_partial_excess_amount: 0,
          mom_included_in_pay: false,
          other_ok_for_mom: false,
        })
        .select()
        .single()

      if (createErr || !expense) throw new Error(createErr?.message ?? 'Failed to create expense')
      const expenseId: string = expense.id
      updateItem(item.key, { expenseId })

      // 2. Upload image to Supabase Storage
      updateItem(item.key, { status: 'uploading' })
      const storagePath = `expenses/${expenseId}`
      const { error: uploadErr } = await supabase.storage
        .from('receipts')
        .upload(storagePath, item.file, { contentType: item.file.type, upsert: true })

      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

      // Get a signed URL valid for 5 minutes — OpenAI vision fetches this URL
      const { data: signedData, error: signErr } = await supabase.storage
        .from('receipts')
        .createSignedUrl(storagePath, 300)

      if (signErr || !signedData) throw new Error('Could not create signed URL for OCR')

      // 3. OCR + category (OpenAI gpt-5-nano, one structured JSON response)
      updateItem(item.key, { status: 'ocr' })
      const ocrResult = await runOcr(signedData.signedUrl)

      // Update expense with extracted fields
      const ocrDate = new Date().toISOString().split('T')[0]
      await supabase.from('expenses').update({
        date: ocrResult.date ?? ocrDate,
        amount: ocrResult.amount ?? 0,
        currency: ocrResult.currency || 'THB',
        payment_method: ocrResult.payment_method ?? 'unknown',
        needs_review: ocrResult.confidence !== 'high',
      }).eq('id', expenseId)

      // Write raw OCR output
      await supabase.from('ocr_raw').upsert({
        expense_id: expenseId,
        raw_json: ocrResult as unknown as Record<string, unknown>,
        confidence_scores: { overall: ocrResult.confidence },
        raw_merchant_string: ocrResult.raw_merchant_string,
      })

      // 4. Merchant row — fuzzy DB match, else create from OCR fields (no extra vision call)
      updateItem(item.key, { status: 'normalizing' })
      const ocrHint = {
        canonical_merchant: ocrResult.canonical_merchant,
        spend_category: ocrResult.spend_category,
      }
      const merchant = await normalizeMerchant(
        ocrResult.raw_merchant_string,
        ocrResult.payment_method,
        ocrHint,
      )

      if (merchant) {
        const cat = merchant.category as ExpenseCategory
        await supabase.from('expenses').update({
          merchant_id: merchant.merchant_id,
          category: merchant.category,
          payment_method: merchant.payment_method,
          auto_classified: merchant.auto_classified,
          needs_review: cat === 'other' ? true : merchant.needs_review,
          mom_included_in_pay: defaultMomIncludedInPay(cat),
          other_ok_for_mom: defaultOtherOkForMom(cat),
        }).eq('id', expenseId)
      } else {
        const cat = ocrResult.spend_category as ExpenseCategory
        await supabase.from('expenses').update({
          category: ocrResult.spend_category,
          needs_review: cat === 'other' ? true : ocrResult.confidence !== 'high',
          mom_included_in_pay: defaultMomIncludedInPay(cat),
          other_ok_for_mom: defaultOtherOkForMom(cat),
        }).eq('id', expenseId)
      }

      updateItem(item.key, { status: 'done' })
    } catch (err) {
      updateItem(item.key, {
        status: 'error',
        error: friendlyProcessingError(err),
      })
    } finally {
      activeRef.current--
      drainQueue()
    }
  }

  function drainQueue() {
    while (activeRef.current < CONCURRENCY) {
      const next = queueRef.current.find(i => i.status === 'queued')
      if (!next) break
      processItem(next)
    }
    // When all workers finish, refresh table and sync report dates from OCR results
    if (activeRef.current === 0 && id) {
      fetchExpenses(id)
      syncReportDates(id)
    }
  }

  function handleFiles(files: File[]) {
    const newItems: UploadItem[] = files.map(file => ({
      key: `${file.name}-${Date.now()}-${Math.random()}`,
      file,
      preview: URL.createObjectURL(file),
      status: 'queued' as const,
    }))

    queueRef.current = [...queueRef.current, ...newItems]
    setUploadItems(prev => [...prev, ...newItems])

    // Kick off workers
    drainQueue()
  }

  // ─── Re-run OCR on single expense ─────────────────────────────────────────

  async function handleRerunOcr(expense: ExpenseRow) {
    // Generate a fresh signed URL for the stored image
    const { data: signedData, error: signErr } = await supabase.storage
      .from('receipts')
      .createSignedUrl(`expenses/${expense.id}`, 300)

    if (signErr || !signedData) throw new Error('Could not get signed URL for image')

    const ocrResult = await runOcr(signedData.signedUrl)

    const fallbackDate = new Date().toISOString().split('T')[0]
    await supabase.from('expenses').update({
      date: ocrResult.date ?? fallbackDate,
      amount: ocrResult.amount ?? 0,
      currency: ocrResult.currency || 'THB',
      payment_method: ocrResult.payment_method ?? 'unknown',
      needs_review: ocrResult.confidence !== 'high',
    }).eq('id', expense.id)

    await supabase.from('ocr_raw').upsert({
      expense_id: expense.id,
      raw_json: ocrResult as unknown as Record<string, unknown>,
      confidence_scores: { overall: ocrResult.confidence },
      raw_merchant_string: ocrResult.raw_merchant_string,
    })

    const merchant = await normalizeMerchant(
      ocrResult.raw_merchant_string,
      ocrResult.payment_method,
      {
        canonical_merchant: ocrResult.canonical_merchant,
        spend_category: ocrResult.spend_category,
      },
    )

    if (merchant) {
      const cat = merchant.category as ExpenseCategory
      await supabase.from('expenses').update({
        merchant_id: merchant.merchant_id,
        category: merchant.category,
        payment_method: merchant.payment_method,
        auto_classified: merchant.auto_classified,
        needs_review: cat === 'other' ? true : merchant.needs_review,
        mom_included_in_pay: defaultMomIncludedInPay(cat),
        other_ok_for_mom: defaultOtherOkForMom(cat),
      }).eq('id', expense.id)
    } else {
      const cat = ocrResult.spend_category as ExpenseCategory
      await supabase.from('expenses').update({
        category: ocrResult.spend_category,
        needs_review: cat === 'other' ? true : ocrResult.confidence !== 'high',
        mom_included_in_pay: defaultMomIncludedInPay(cat),
        other_ok_for_mom: defaultOtherOkForMom(cat),
      }).eq('id', expense.id)
    }

    if (id) await syncReportDates(id)
  }

  // ─── Confirm all ───────────────────────────────────────────────────────────

  async function handleConfirmAll() {
    const pending = expenses.filter(e => e.status === 'pending')
    if (pending.length === 0) return
    setConfirmingAll(true)

    try {
      for (const expense of pending) {
        await supabase.from('expenses').update({ status: 'confirmed' }).eq('id', expense.id)

        if (expense.merchant_id) {
          const { data: m } = await supabase
            .from('merchants')
            .select('approved_count, flagged_count, aliases')
            .eq('id', expense.merchant_id)
            .single()

          if (m) {
            const newCount = m.approved_count + 1
            const rawStr = expense.ocr?.raw_merchant_string
            const aliases: string[] = m.aliases ?? []
            if (rawStr && !aliases.includes(rawStr)) aliases.push(rawStr)
            await supabase
              .from('merchants')
              .update({
                approved_count: newCount,
                auto_classify: newCount > 10 && m.flagged_count === 0,
                aliases,
              })
              .eq('id', expense.merchant_id)
          }
        }
      }
    } finally {
      setConfirmingAll(false)
      if (id) fetchExpenses(id)
    }
  }

  // ─── Publish ───────────────────────────────────────────────────────────────

  async function handleDeleteDraft() {
    if (!report) return
    if (!confirm('Delete this draft report and all its expenses?')) return
    setDeletingDraft(true)
    // Delete all receipt images
    const paths = expenses.map(e => `expenses/${e.id}`)
    if (paths.length) await supabase.storage.from('receipts').remove(paths)
    // Delete report (cascades to expenses + ocr_raw)
    await supabase.from('reports').delete().eq('id', report.id)
    navigate('/me')
  }

  async function handlePublish() {
    if (!report) return
    const otherNotOk = expenses.filter(e => e.category === 'other' && e.other_ok_for_mom !== true)
    if (otherNotOk.length > 0) {
      window.alert(
        `You have ${otherNotOk.length} slip${otherNotOk.length === 1 ? '' : 's'} in category “Other” that are not OK’d for mom yet. Open the “Other → mom” column and tap OK for each, or change the category, then publish.`,
      )
      return
    }
    setPublishing(true)
    const { error } = await supabase
      .from('reports')
      .update({ status: 'pending' })
      .eq('id', report.id)

    if (!error) {
      setReport(r => r ? { ...r, status: 'pending' } : r)
    }
    setPublishing(false)
  }

  // ─── Derived state ─────────────────────────────────────────────────────────

  const pendingCount = expenses.filter(e => e.status === 'pending').length
  const allConfirmedOrFlagged = expenses.length > 0 && pendingCount === 0
  const otherAwaitingOk = expenses.filter(e => e.category === 'other' && e.other_ok_for_mom !== true).length
  const canPublish =
    report?.status === 'draft' && allConfirmedOrFlagged && otherAwaitingOk === 0
  const reportLink = report ? `${window.location.origin}/report/${report.token}` : ''

  function copyLink() {
    navigator.clipboard.writeText(reportLink)
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Layout role="me">
        <p className="loading-text">Loading report…</p>
      </Layout>
    )
  }

  if (notFound || !report) {
    return (
      <Layout role="me">
        <div className="not-found">
          <h2>Report not found</h2>
          <button type="button" className="btn-ghost" onClick={() => navigate('/me')}>Back to reports</button>
        </div>
      </Layout>
    )
  }

  const isProcessing = uploadItems.some(
    i => i.status !== 'queued' && i.status !== 'done' && i.status !== 'error',
  )

  const total = expenses.reduce((s, e) => s + e.amount, 0)

  return (
    <Layout role="me">
      <div className="page-detail">
        {/* Header */}
        <div className="detail-header">
          <div className="detail-header-left">
            <button type="button" className="btn-ghost back-btn" onClick={() => navigate('/me')}>Back to reports</button>
            <div>
              <h1 className="page-title">
                <span className="mono">{report.period_start}</span>
                <span className="period-arrow"> → </span>
                <span className="mono">{report.period_end}</span>
              </h1>
              {expenses.length > 0 && (
                <p className="detail-summary">
                  {expenses.length} expense{expenses.length !== 1 ? 's' : ''} ·{' '}
                  <span className="mono">
                    {total.toLocaleString('en-US', { minimumFractionDigits: 2 })} THB
                  </span>
                </p>
              )}
            </div>
          </div>
          <div className="detail-header-right">
            <span className={`status-badge status-${report.status}`}>{report.status}</span>
            {(report.status === 'pending' || report.status === 'approved') && (
              <button type="button" className="btn-ghost" onClick={copyLink}>Copy link</button>
            )}
            {report.status === 'draft' && (
              <button
                className="btn-danger-ghost"
                onClick={handleDeleteDraft}
                disabled={deletingDraft}
              >
                {deletingDraft ? 'Deleting…' : 'Delete draft'}
              </button>
            )}
          </div>
        </div>

        {/* Upload zone — only in draft */}
        {report.status === 'draft' && (
          <UploadZone
            items={uploadItems}
            onFiles={handleFiles}
            disabled={isProcessing}
          />
        )}

        {/* Review table */}
        {expenses.length > 0 && (
          <>
            <div className="review-section">
              <div className="review-header">
                <h2 className="section-title">Review expenses</h2>
                <div className="review-legend" aria-label="Row highlight meanings">
                  <span className="legend-item"><span className="dot dot-green" aria-hidden /> Auto-matched</span>
                  <span className="legend-item"><span className="dot dot-yellow" aria-hidden /> Double-check</span>
                  <span className="legend-item"><span className="dot dot-orange" aria-hidden /> Unknown merchant</span>
                  <span className="legend-item"><span className="dot dot-red" aria-hidden /> Flagged</span>
                  <span className="legend-item"><span className="dot dot-magenta" aria-hidden /> Other — needs your OK</span>
                </div>
              </div>
              {report.status === 'draft' && otherAwaitingOk > 0 && (
                <p className="review-other-banner" role="status">
                  <strong>{otherAwaitingOk}</strong> slip{otherAwaitingOk !== 1 ? 's are' : ' is'} in <strong>Other</strong> and need your OK before mom can see them on her bill (and before you can publish). Use the <strong>Other → mom</strong> column.
                </p>
              )}
              <p className="review-mom-hint">
                <span className="mom-pay-green-flag" aria-hidden>●</span>
                <strong>Mom pay:</strong> Grab, transportation, and <strong>Starbucks</strong> behave like before (full slip when eligible). <strong>Other</strong> is never automatic: you must OK each line for mom; OCR marks them for review. Food = up to{' '}
                <span className="mono">฿200</span> by default; use <em>Cap only</em>, <em>Adjust</em>, or <em>Full slip</em>. Mom can still decline a line after you OK it.
              </p>
              <ReviewTable
                expenses={expenses}
                onRefresh={() => fetchExpenses(id!)}
                onRerunOcr={report.status === 'draft' ? handleRerunOcr : undefined}
              />
            </div>

            {/* Actions bar */}
            {report.status === 'draft' && (
              <div className="actions-bar">
                {pendingCount > 0 && (
                  <div className="actions-left">
                    <span className="actions-hint">
                      {pendingCount} expense{pendingCount !== 1 ? 's' : ''} still need confirmation before you can publish.
                    </span>
                    <button
                      className="btn-primary"
                      onClick={handleConfirmAll}
                      disabled={confirmingAll || isProcessing}
                    >
                      {confirmingAll ? 'Confirming…' : `Confirm all (${pendingCount})`}
                    </button>
                  </div>
                )}
                {allConfirmedOrFlagged && otherAwaitingOk > 0 && (
                  <span className="actions-hint actions-hint--block">
                    Fix or OK all <strong>Other</strong> slips above to enable publish.
                  </span>
                )}
                {canPublish && (
                  <button
                    className="btn-publish"
                    onClick={handlePublish}
                    disabled={publishing}
                  >
                    {publishing ? 'Publishing…' : 'Publish for review'}
                  </button>
                )}
              </div>
            )}

            {report.status === 'pending' && (
              <div className="pending-banner">
                <span className="pending-banner-text">
                  This report is waiting for the reviewer. Send them the link so they can open it and approve.
                </span>
                <button type="button" className="btn-ghost" onClick={copyLink}>Copy link</button>
              </div>
            )}

            {report.status === 'approved' && (
              <div className="approved-banner">
                Approved. Receipt images were removed from storage after approval.
              </div>
            )}
          </>
        )}

        {expenses.length === 0 && uploadItems.length === 0 && (
          <div className="empty-state">
            <p className="empty-state-title">Add your first receipts</p>
            <p>Drag photos into the box above or click to choose files. We read each receipt and fill the table—you can edit anything before you publish.</p>
          </div>
        )}
      </div>
    </Layout>
  )
}
