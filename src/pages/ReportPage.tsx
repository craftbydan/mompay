import { useEffect, useState, Fragment, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { CategoryPill } from '../components/CategoryPill'
import { Layout } from '../components/Layout'
import { supabase } from '../lib/supabase'
import { displayMerchantName } from '../lib/merchantDisplay'
import {
  formatThb,
  isMomIncludedInPay,
  isOrganizerOkForMomPay,
  isReportGreenMomPay,
  isUncappedGreenCategory,
  reimbursableForMom,
  uncoveredExcess,
} from '../lib/momPay'
import type { Report, Expense } from '../types'

const METHOD_LABEL = { qr: 'QR', card: 'Card', unknown: '—' }

function parseMomPaymentUrl(raw: string | undefined): string | null {
  const s = raw?.trim()
  if (!s || !/^https?:\/\//i.test(s)) return null
  try {
    new URL(s)
    return s
  } catch {
    return null
  }
}

type ExpenseWithImage = Expense & {
  merchant?: { canonical_name: string; category: string; payment_method: string } | null
  ocr?: { raw_merchant_string: string | null } | null
  signedImageUrl?: string | null
}

async function loadExpenseRows(reportId: string): Promise<ExpenseWithImage[]> {
  const { data: expenseData } = await supabase
    .from('expenses')
    .select('*, merchant:merchants(canonical_name, category, payment_method), ocr:ocr_raw(raw_merchant_string)')
    .eq('report_id', reportId)
    .order('date', { ascending: true })

  const rows = (expenseData ?? []) as ExpenseWithImage[]

  if (rows.length > 0) {
    const paths = rows.map(e => `expenses/${e.id}`)
    const { data: signed } = await supabase.storage.from('receipts').createSignedUrls(paths, 3600)

    if (signed) {
      const urlMap = Object.fromEntries(
        signed.map(s => [s.path?.replace('expenses/', '') ?? '', s.signedUrl ?? null])
      )
      rows.forEach(e => { e.signedImageUrl = urlMap[e.id] ?? null })
    }
  }

  return rows
}

export function ReportPage() {
  const { token } = useParams<{ token: string }>()
  const [report, setReport] = useState<Report | null>(null)
  const [expenses, setExpenses] = useState<ExpenseWithImage[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rowActionId, setRowActionId] = useState<string | null>(null)

  const refreshExpenses = useCallback(async () => {
    if (!report) return
    const rows = await loadExpenseRows(report.id)
    setExpenses(rows)
  }, [report])

  useEffect(() => {
    if (!token) return
    fetchReport(token)
  }, [token])

  async function fetchReport(tok: string) {
    setLoading(true)

    const { data: reportData, error } = await supabase
      .from('reports').select('*').eq('token', tok).single()

    if (error || !reportData) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setReport(reportData as Report)
    const rows = await loadExpenseRows(reportData.id)
    setExpenses(rows)
    setLoading(false)
  }

  async function handleApprove() {
    if (!report) return
    setApproving(true)
    const imagePaths = expenses.map(e => `expenses/${e.id}`)
    if (imagePaths.length > 0) {
      await supabase.storage.from('receipts').remove(imagePaths)
    }
    await supabase.from('reports').update({ status: 'approved' }).eq('id', report.id)
    setApproved(true)
    setApproving(false)
    setReport(r => r ? { ...r, status: 'approved' } : r)
  }

  async function momSetIncluded(expense: ExpenseWithImage, included: boolean) {
    setRowActionId(expense.id)
    try {
      await supabase.from('expenses').update({ mom_included_in_pay: included }).eq('id', expense.id)
      await refreshExpenses()
    } finally {
      setRowActionId(null)
    }
  }

  async function momFlagExpense(expense: ExpenseWithImage) {
    setRowActionId(expense.id)
    try {
      await supabase.from('expenses').update({ status: 'flagged' }).eq('id', expense.id)
      if (expense.merchant_id) {
        const { data: m } = await supabase
          .from('merchants').select('flagged_count').eq('id', expense.merchant_id).single()
        if (m) {
          await supabase.from('merchants').update({
            flagged_count: m.flagged_count + 1,
            auto_classify: false,
          }).eq('id', expense.merchant_id)
        }
      }
      await refreshExpenses()
    } finally {
      setRowActionId(null)
    }
  }

  async function momDeleteExpense(expense: ExpenseWithImage) {
    if (!confirm('Remove this slip from the report? Totals update right away. This cannot be undone.')) return
    setRowActionId(expense.id)
    try {
      await supabase.storage.from('receipts').remove([`expenses/${expense.id}`])
      await supabase.from('expenses').delete().eq('id', expense.id)
      setExpandedId(id => (id === expense.id ? null : id))
      await refreshExpenses()
    } finally {
      setRowActionId(null)
    }
  }

  const total = expenses.reduce((sum, e) => sum + e.amount, 0)
  const totalMomPays = expenses.reduce((sum, e) => sum + reimbursableForMom(e), 0)
  const totalNotCovered = expenses.reduce((sum, e) => sum + uncoveredExcess(e), 0)

  const canMomAct = report && report.status === 'pending' && !approved

  const momPaymentUrl = parseMomPaymentUrl(import.meta.env.VITE_MOM_PAYMENT_URL as string | undefined)
  const momPaymentLabel =
    (import.meta.env.VITE_MOM_PAYMENT_LABEL as string | undefined)?.trim() || 'Open payment'

  if (loading) {
    return <Layout><p className="loading-text">Loading report…</p></Layout>
  }

  if (notFound || !report) {
    return (
      <Layout>
        <div className="not-found">
          <h2>Report not found</h2>
          <p className="text-muted">This link may have expired or is invalid.</p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="page-report page-report--mom">
        <div className="report-header">
          <div>
            <h1 className="page-title">Expense report</h1>
            <p className="report-period mono">
              {report.period_start} → {report.period_end}
            </p>
          </div>
          <span className={`status-badge status-${report.status}`}>{report.status}</span>
        </div>

        {expenses.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">No line items</p>
            <p>The organizer has not added expenses to this report yet, or they were removed.</p>
          </div>
        ) : (
          <>
            <section className="report-mom-summary" aria-label="Payment totals">
              <div className="report-mom-stat report-mom-stat--primary">
                <span className="report-mom-stat-label">Your total</span>
                <span className="report-mom-stat-value mono" aria-live="polite">
                  {totalMomPays.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                  <span className="report-mom-stat-currency">THB</span>
                </span>
              </div>
              <div className="report-mom-stat">
                <span className="report-mom-stat-label">On the receipts</span>
                <span className="report-mom-stat-value report-mom-stat-value--muted mono">
                  {total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                  <span className="report-mom-stat-currency">THB</span>
                </span>
              </div>
              {totalNotCovered > 0 && (
                <div className="report-mom-stat report-mom-stat--note">
                  <span className="report-mom-stat-label">Paid by them, not you</span>
                  <span className="report-mom-stat-value mono report-mom-gap-inline">
                    {totalNotCovered.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                    <span className="report-mom-stat-currency">THB</span>
                  </span>
                </div>
              )}
            </section>

            <p className="report-tap-hint" role="note">
              Tap a row (outside the buttons) to open or close the receipt photo.
            </p>

            <table className="expense-table expense-table--mom">
              <thead>
                <tr>
                  <th>date</th>
                  <th>merchant</th>
                  <th>category</th>
                  <th>You pay</th>
                  <th>method</th>
                  <th className="text-right">Receipt</th>
                  <th className="report-actions-th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(expense => {
                  const organizerOk = isOrganizerOkForMomPay(expense)
                  const busy = rowActionId === expense.id
                  return (
                    <Fragment key={expense.id}>
                      <tr
                        className={`expense-row clickable${expandedId === expense.id ? ' expense-row--proof-open' : ''}`}
                        onClick={() => setExpandedId(id => id === expense.id ? null : expense.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setExpandedId(id => id === expense.id ? null : expense.id)
                          }
                        }}
                        tabIndex={0}
                        aria-expanded={expandedId === expense.id}
                        aria-label={`${displayMerchantName(expense.merchant?.canonical_name, expense.ocr?.raw_merchant_string)}, tap for receipt`}
                      >
                        <td className="mono" data-label="Date">{expense.date}</td>
                        <td data-label="Merchant">
                          {displayMerchantName(
                            expense.merchant?.canonical_name,
                            expense.ocr?.raw_merchant_string,
                          )}
                        </td>
                        <td data-label="Category">
                          <span className="category-pill-row">
                            <CategoryPill
                              category={expense.category}
                              otherEmphasis={expense.category === 'other'}
                            />
                            {expense.category === 'other' && (
                              <span className="category-tag-hint"> · review</span>
                            )}
                          </span>
                        </td>
                        <td className="report-mom-pay" data-label="You pay">
                          {!organizerOk ? (
                            <div className="report-mom-pay-stack">
                              <span className="mono report-mom-pay-main report-mom-excluded-amount">0.00 THB</span>
                              <span className="report-mom-pay-rest report-mom-excluded-note">
                                Not on your bill yet — organizer must OK this &quot;Other&quot; slip first
                              </span>
                            </div>
                          ) : !isMomIncludedInPay(expense) ? (
                            <div className="report-mom-pay-stack">
                              <span className="mono report-mom-pay-main report-mom-excluded-amount">0.00 THB</span>
                              <span className="report-mom-pay-rest report-mom-excluded-note">Not included — tap Include if you will pay</span>
                            </div>
                          ) : isReportGreenMomPay(expense) ? (
                            <span
                              className="report-mom-green"
                              title={
                                isUncappedGreenCategory(expense.category)
                                  ? 'You cover the full receipt (ride / transit)'
                                  : 'You cover the full receipt (Starbucks)'
                              }
                            >
                              {formatThb(expense.amount)}
                            </span>
                          ) : (
                            <div className="report-mom-pay-stack">
                              <span className="mono report-mom-pay-main">{formatThb(reimbursableForMom(expense))}</span>
                              {uncoveredExcess(expense) > 0 && (
                                <span className="report-mom-pay-rest">
                                  They pay {formatThb(uncoveredExcess(expense))}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="text-muted" data-label="Paid with">{METHOD_LABEL[expense.payment_method]}</td>
                        <td className="mono text-right" data-label="Receipt">
                          {expense.amount.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          <span className="currency">{expense.currency}</span>
                        </td>
                        <td
                          className="report-actions-cell"
                          data-label="Actions"
                          onClick={e => e.stopPropagation()}
                        >
                          {canMomAct && (
                            <div className="report-row-actions">
                              {organizerOk && !isMomIncludedInPay(expense) && (
                                <button
                                  type="button"
                                  className="btn-report-action btn-report-include"
                                  disabled={busy}
                                  onClick={() => momSetIncluded(expense, true)}
                                >
                                  Include
                                </button>
                              )}
                              {organizerOk && isMomIncludedInPay(expense) && (
                                <button
                                  type="button"
                                  className="btn-report-action btn-report-decline"
                                  disabled={busy}
                                  onClick={() => momSetIncluded(expense, false)}
                                >
                                  Decline
                                </button>
                              )}
                              {expense.status !== 'flagged' && (
                                <button
                                  type="button"
                                  className="btn-report-action btn-report-flag"
                                  disabled={busy}
                                  onClick={() => momFlagExpense(expense)}
                                >
                                  Flag
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn-report-action btn-report-delete"
                                disabled={busy}
                                onClick={() => momDeleteExpense(expense)}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                          {expense.status === 'flagged' && (
                            <span className="report-flagged-pill">Flagged for organizer</span>
                          )}
                        </td>
                      </tr>
                      {expandedId === expense.id && (
                        <tr className="proof-row proof-row--mom">
                          <td colSpan={7}>
                            <div className="proof-cell proof-cell--mom">
                              {expense.signedImageUrl
                                ? <img src={expense.signedImageUrl} alt="Receipt photo" className="proof-img" />
                                : <p className="proof-missing">Receipt image not available</p>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="total-row">
                  <td colSpan={6} className="text-right text-muted">Total spent</td>
                  <td className="mono text-right">
                    {total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                    <span className="currency">THB</span>
                  </td>
                </tr>
                <tr className="total-row">
                  <td colSpan={6} className="text-right text-muted">Your total</td>
                  <td className="mono text-right">
                    {totalMomPays.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                    <span className="currency">THB</span>
                  </td>
                </tr>
                {totalNotCovered > 0 && (
                  <tr className="total-row">
                    <td colSpan={6} className="text-right text-muted">Paid by them, not you</td>
                    <td className="mono text-right report-mom-gap">
                      {totalNotCovered.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                      <span className="currency">THB</span>
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>

            {report.status === 'pending' && !approved && (
              <div className="approve-section">
                <p className="approve-hint">
                  Lines in <strong>Other</strong> only count after the organizer OKs them. Then you can <strong>Include</strong> or <strong>Decline</strong>. Use <strong>Flag</strong> or <strong>Delete</strong> anytime — totals update right away.
                </p>
                <button type="button" className="btn-approve btn-approve--mom" onClick={handleApprove} disabled={approving}>
                  {approving ? 'Approving…' : 'Approve report'}
                </button>
              </div>
            )}

            {(report.status === 'approved' || approved) && (
              <>
                <div className="approved-banner">
                  You approved this report. Receipt images were removed afterward.
                </div>
                {momPaymentUrl && (
                  <div className="report-payment-cta">
                    <p className="report-payment-cta-title">Next step — pay the organizer</p>
                    <p className="report-payment-cta-hint">
                      Your total to reimburse is{' '}
                      <span className="mono">
                        {totalMomPays.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} THB
                      </span>
                      . Tap the button to open your bank or payment link.
                    </p>
                    <a
                      className="btn-payment-link"
                      href={momPaymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {momPaymentLabel}
                    </a>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  )
}
