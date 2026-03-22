import { useState, useRef, useEffect, Fragment, type KeyboardEvent } from 'react'
import { supabase } from '../lib/supabase'
import { CropSelector } from './CropSelector'
import {
  defaultMomIncludedInPay,
  defaultOtherOkForMom,
  excessOverCap,
  formatThb,
  isMomIncludedInPay,
  isReportGreenMomPay,
  isUncappedGreenCategory,
  MOM_PAY_CAP_THB,
  reimbursableForMom,
  uncoveredExcess,
  usesMomPayCap,
} from '../lib/momPay'
import { displayMerchantName } from '../lib/merchantDisplay'
import { CategoryPill } from './CategoryPill'
import type { ExpenseCategory, MomPayMode } from '../types'

export interface ExpenseRow {
  id: string
  date: string
  amount: number
  currency: string
  category: 'food' | 'grab' | 'transportation' | 'other'
  payment_method: 'qr' | 'card' | 'unknown'
  merchant_id: string | null
  auto_classified: boolean
  needs_review: boolean
  status: 'pending' | 'confirmed' | 'flagged'
  merchant?: { id: string; canonical_name: string } | null
  ocr?: { raw_merchant_string: string | null } | null
  signedImageUrl?: string | null
  mom_pay_mode?: MomPayMode
  mom_partial_excess_amount?: number
  mom_included_in_pay?: boolean
  other_ok_for_mom?: boolean
}

interface EditState {
  id: string
  field: string
  value: string
}

interface ReviewTableProps {
  expenses: ExpenseRow[]
  onRefresh: () => void
  onRerunOcr?: (expense: ExpenseRow) => Promise<void>
}

const CATEGORIES = ['food', 'grab', 'transportation', 'other'] as const
const METHODS = ['qr', 'card', 'unknown'] as const

function rowClass(e: ExpenseRow): string {
  if (e.status === 'flagged') return 'row-flagged'
  if (e.category === 'other' && e.other_ok_for_mom !== true) return 'row-other-await-ok'
  if (e.status === 'confirmed') return 'row-confirmed'
  if (!e.merchant_id) return 'row-unknown'
  if (e.needs_review && !e.auto_classified) return 'row-unknown'
  if (e.needs_review) return 'row-review'
  if (e.auto_classified && !e.needs_review) return 'row-auto'
  return ''
}

function rowDot(e: ExpenseRow): string {
  if (e.status === 'flagged') return 'dot-red'
  if (e.category === 'other' && e.other_ok_for_mom !== true) return 'dot-magenta'
  if (e.status === 'confirmed') return 'dot-green'
  if (!e.merchant_id || (e.needs_review && !e.auto_classified)) return 'dot-orange'
  if (e.needs_review) return 'dot-yellow'
  return 'dot-green'
}

export function ReviewTable({ expenses, onRefresh, onRerunOcr }: ReviewTableProps) {
  const [editState, setEditState] = useState<EditState | null>(null)
  const [proofId, setProofId] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null)

  useEffect(() => {
    if (editState) inputRef.current?.focus()
  }, [editState])

  // ─── Selection ─────────────────────────────────────────────────────────────

  const allSelected = expenses.length > 0 && selected.size === expenses.length

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(expenses.map(e => e.id)))
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ─── Bulk delete ───────────────────────────────────────────────────────────

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`Delete ${selected.size} expense${selected.size !== 1 ? 's' : ''}?`)) return
    setBulkDeleting(true)
    try {
      const ids = [...selected]
      await supabase.storage
        .from('receipts')
        .remove(ids.map(id => `expenses/${id}`))
      await supabase.from('expenses').delete().in('id', ids)
      setSelected(new Set())
    } finally {
      setBulkDeleting(false)
      onRefresh()
    }
  }

  // ─── Single row actions ────────────────────────────────────────────────────

  function startEdit(id: string, field: string, value: string) {
    setEditState({ id, field, value })
  }

  async function commitEdit() {
    if (!editState) return
    const { id, field, value } = editState
    setEditState(null)
    setSaving(id)
    try {
      if (field === 'merchant_name') {
        await saveMerchant(id, value)
      } else if (field === 'category') {
        const cat = value as ExpenseCategory
        await supabase
          .from('expenses')
          .update({
            category: cat,
            mom_included_in_pay: defaultMomIncludedInPay(cat),
            other_ok_for_mom: defaultOtherOkForMom(cat),
          })
          .eq('id', id)
      } else {
        await supabase
          .from('expenses')
          .update({ [field]: field === 'amount' ? parseFloat(value) || 0 : value })
          .eq('id', id)
      }
    } finally {
      setSaving(null)
      onRefresh()
    }
  }

  async function saveMerchant(expenseId: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) {
      await supabase.from('expenses').update({ merchant_id: null }).eq('id', expenseId)
      return
    }
    const { data: existing } = await supabase
      .from('merchants').select('id').ilike('canonical_name', trimmed).limit(1).single()
    if (existing) {
      await supabase.from('expenses').update({ merchant_id: existing.id }).eq('id', expenseId)
      return
    }
    const { data: created } = await supabase
      .from('merchants')
      .insert({ canonical_name: trimmed, category: 'other', payment_method: 'unknown' })
      .select('id').single()
    if (created) {
      await supabase.from('expenses')
        .update({ merchant_id: created.id, needs_review: true, auto_classified: false })
        .eq('id', expenseId)
    }
  }

  async function confirmExpense(expense: ExpenseRow) {
    setSaving(expense.id)
    try {
      await supabase.from('expenses').update({ status: 'confirmed' }).eq('id', expense.id)
      if (expense.merchant_id) {
        const { data: m } = await supabase
          .from('merchants').select('approved_count, flagged_count, aliases')
          .eq('id', expense.merchant_id).single()
        if (m) {
          const newCount = m.approved_count + 1
          const aliases: string[] = m.aliases ?? []
          const raw = expense.ocr?.raw_merchant_string
          if (raw && !aliases.includes(raw)) aliases.push(raw)
          await supabase.from('merchants').update({
            approved_count: newCount,
            auto_classify: newCount > 10 && m.flagged_count === 0,
            aliases,
          }).eq('id', expense.merchant_id)
        }
      }
    } finally {
      setSaving(null)
      onRefresh()
    }
  }

  async function flagExpense(expense: ExpenseRow) {
    setSaving(expense.id)
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
    } finally {
      setSaving(null)
      onRefresh()
    }
  }

  async function handleRerunOcr(expense: ExpenseRow) {
    if (!onRerunOcr) return
    setRerunning(expense.id)
    try {
      await onRerunOcr(expense)
    } finally {
      setRerunning(null)
      onRefresh()
    }
  }

  async function setMomPayMode(expense: ExpenseRow, mode: MomPayMode) {
    const excess = excessOverCap(expense.amount)
    let partial = expense.mom_partial_excess_amount ?? 0
    if (mode === 'cap' || mode === 'full') partial = 0
    if (mode === 'partial') {
      partial = Math.min(Math.max(0, partial), excess)
    }
    setSaving(expense.id)
    try {
      await supabase
        .from('expenses')
        .update({ mom_pay_mode: mode, mom_partial_excess_amount: partial })
        .eq('id', expense.id)
    } finally {
      setSaving(null)
      onRefresh()
    }
  }

  async function setMomPartialAmount(expense: ExpenseRow, raw: number) {
    const excess = excessOverCap(expense.amount)
    const partial = Math.round(Math.min(Math.max(0, raw), excess) * 100) / 100
    setSaving(expense.id)
    try {
      await supabase.from('expenses').update({ mom_partial_excess_amount: partial }).eq('id', expense.id)
    } finally {
      setSaving(null)
      onRefresh()
    }
  }

  async function setOtherOkForMom(expense: ExpenseRow, ok: boolean) {
    setSaving(expense.id)
    try {
      await supabase
        .from('expenses')
        .update({
          other_ok_for_mom: ok,
          mom_included_in_pay: ok,
        })
        .eq('id', expense.id)
    } finally {
      setSaving(null)
      onRefresh()
    }
  }

  async function deleteExpense(expense: ExpenseRow) {
    setSaving(expense.id)
    try {
      await supabase.storage.from('receipts').remove([`expenses/${expense.id}`])
      await supabase.from('expenses').delete().eq('id', expense.id)
      setSelected(prev => { const n = new Set(prev); n.delete(expense.id); return n })
    } finally {
      setSaving(null)
      onRefresh()
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') setEditState(null)
  }

  if (expenses.length === 0) {
    return <div className="empty-state"><p>No expenses yet.</p></div>
  }

  return (
    <div className="review-table-wrap">
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">{selected.size} selected</span>
          <button
            className="btn-ghost"
            onClick={() => setSelected(new Set())}
          >
            clear
          </button>
          <button
            className="btn-danger"
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
          >
            {bulkDeleting ? 'deleting…' : `delete (${selected.size})`}
          </button>
        </div>
      )}

      <table className="review-table">
        <thead>
          <tr>
            <th className="col-check">
              <input
                type="checkbox"
                className="row-checkbox"
                checked={allSelected}
                onChange={toggleAll}
              />
            </th>
            <th className="col-dot" />
            <th className="col-date">date</th>
            <th className="col-amount">amount</th>
            <th className="col-merchant">merchant</th>
            <th className="col-category">category</th>
            <th className="col-other-ok" title="You must OK each Other slip before mom can pay or you can publish">
              other→mom
            </th>
            <th className="col-mom-pay">Mom pays</th>
            <th className="col-method">method</th>
            <th className="col-status">status</th>
            <th className="col-actions" />
          </tr>
        </thead>
        <tbody>
          {expenses.map(expense => {
            const isEditing = (field: string) =>
              editState?.id === expense.id && editState.field === field
            const isSaving = saving === expense.id
            const isRerunning = rerunning === expense.id
            const isSelected = selected.has(expense.id)

            return (
              <Fragment key={expense.id}>
                  <tr
                    className={`review-row ${rowClass(expense)} ${isSaving || isRerunning ? 'saving' : ''} ${isSelected ? 'row-selected' : ''}`}
                  >
                  {/* Checkbox */}
                  <td className="col-check" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="row-checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(expense.id)}
                    />
                  </td>

                  {/* Status dot */}
                  <td className="col-dot">
                    <span className={`dot ${rowDot(expense)}`} />
                  </td>

                  {/* Date */}
                  <td className="col-date mono" onClick={() => startEdit(expense.id, 'date', expense.date)}>
                    {isEditing('date') ? (
                      <input
                        ref={inputRef as React.RefObject<HTMLInputElement>}
                        type="date" className="cell-input mono"
                        value={editState!.value}
                        onChange={e => setEditState(s => s && { ...s, value: e.target.value })}
                        onBlur={commitEdit} onKeyDown={handleKeyDown}
                      />
                    ) : expense.date}
                  </td>

                  {/* Amount */}
                  <td className="col-amount mono text-right" onClick={() => startEdit(expense.id, 'amount', String(expense.amount))}>
                    {isEditing('amount') ? (
                      <input
                        ref={inputRef as React.RefObject<HTMLInputElement>}
                        type="number" step="0.01" className="cell-input mono text-right"
                        value={editState!.value}
                        onChange={e => setEditState(s => s && { ...s, value: e.target.value })}
                        onBlur={commitEdit} onKeyDown={handleKeyDown}
                      />
                    ) : (
                      <>
                        {expense.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                        <span className="currency">{expense.currency}</span>
                      </>
                    )}
                  </td>

                  {/* Merchant */}
                  <td
                    className="col-merchant"
                    onClick={() => {
                      const shown = displayMerchantName(
                        expense.merchant?.canonical_name,
                        expense.ocr?.raw_merchant_string,
                      )
                      startEdit(expense.id, 'merchant_name', shown === '—' ? '' : shown)
                    }}
                  >
                    {isEditing('merchant_name') ? (
                      <input
                        ref={inputRef as React.RefObject<HTMLInputElement>}
                        type="text" className="cell-input"
                        value={editState!.value}
                        onChange={e => setEditState(s => s && { ...s, value: e.target.value })}
                        onBlur={commitEdit} onKeyDown={handleKeyDown}
                        placeholder="merchant name…"
                      />
                    ) : (
                      <span className={expense.merchant || expense.ocr?.raw_merchant_string ? '' : 'text-muted'}>
                        {displayMerchantName(expense.merchant?.canonical_name, expense.ocr?.raw_merchant_string)}
                      </span>
                    )}
                  </td>

                  {/* Category */}
                  <td className="col-category" onClick={() => startEdit(expense.id, 'category', expense.category)}>
                    {isEditing('category') ? (
                      <select
                        ref={inputRef as React.RefObject<HTMLSelectElement>}
                        className="cell-select" value={editState!.value}
                        onChange={e => setEditState(s => s && { ...s, value: e.target.value })}
                        onBlur={commitEdit} onKeyDown={handleKeyDown}
                      >
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <CategoryPill category={expense.category} />
                    )}
                  </td>

                  <td className="col-other-ok" onClick={e => e.stopPropagation()}>
                    {expense.category === 'other' ? (
                      expense.other_ok_for_mom ? (
                        <div className="other-ok-cell">
                          <span className="other-ok-badge">OK</span>
                          <button
                            type="button"
                            className="btn-other-revoke"
                            disabled={isSaving || isRerunning}
                            onClick={() => setOtherOkForMom(expense, false)}
                          >
                            Revoke
                          </button>
                        </div>
                      ) : (
                        <div className="other-ok-cell">
                          <span className="other-await-label">Needs you</span>
                          <button
                            type="button"
                            className="btn-other-ok"
                            disabled={isSaving || isRerunning}
                            onClick={() => setOtherOkForMom(expense, true)}
                          >
                            OK for mom
                          </button>
                        </div>
                      )
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>

                  {/* Mom pay cap / green transit */}
                  <td className="col-mom-pay" onClick={e => e.stopPropagation()}>
                    <MomPayCell
                      expense={expense}
                      disabled={isSaving || isRerunning}
                      onSetMode={mode => setMomPayMode(expense, mode)}
                      onSetPartial={amt => setMomPartialAmount(expense, amt)}
                    />
                  </td>

                  {/* Method */}
                  <td className="col-method" onClick={() => startEdit(expense.id, 'payment_method', expense.payment_method)}>
                    {isEditing('payment_method') ? (
                      <select
                        ref={inputRef as React.RefObject<HTMLSelectElement>}
                        className="cell-select" value={editState!.value}
                        onChange={e => setEditState(s => s && { ...s, value: e.target.value })}
                        onBlur={commitEdit} onKeyDown={handleKeyDown}
                      >
                        {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ) : <span className="text-muted">{expense.payment_method}</span>}
                  </td>

                  {/* Status */}
                  <td className="col-status">
                    <span className={`status-badge status-${expense.status}`}>{expense.status}</span>
                  </td>

                  {/* Actions */}
                  <td className="col-actions">
                    <div className="row-action-group">
                      {expense.status !== 'confirmed' && (
                        <button className="action-btn confirm-btn" title="Confirm"
                          onClick={() => confirmExpense(expense)} disabled={isSaving || isRerunning}>✓</button>
                      )}
                      {expense.status !== 'flagged' && (
                        <button className="action-btn flag-btn" title="Flag"
                          onClick={() => flagExpense(expense)} disabled={isSaving || isRerunning}>⚑</button>
                      )}
                      <button
                        className={`action-btn proof-btn ${proofId === expense.id ? 'active' : ''}`}
                        title="View receipt" onClick={() => setProofId(p => p === expense.id ? null : expense.id)}>⌄
                      </button>
                      {onRerunOcr && (
                        <button
                          className={`action-btn rerun-btn ${isRerunning ? 'active' : ''}`}
                          title="Re-run OCR"
                          onClick={() => handleRerunOcr(expense)}
                          disabled={isSaving || isRerunning}
                        >
                          {isRerunning ? '…' : '↻'}
                        </button>
                      )}
                      <button className="action-btn delete-btn" title="Delete"
                        onClick={() => { if (confirm('Delete this expense?')) deleteExpense(expense) }}
                        disabled={isSaving || isRerunning}>×</button>
                    </div>
                  </td>
                </tr>

                {proofId === expense.id && (
                  <tr className="proof-row">
                    <td colSpan={11}>
                      <ProofCell
                        url={expense.signedImageUrl}
                        rawMerchant={expense.ocr?.raw_merchant_string}
                        expenseId={expense.id}
                        onRefresh={onRefresh}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MomPayCell({
  expense,
  disabled,
  onSetMode,
  onSetPartial,
}: {
  expense: ExpenseRow
  disabled: boolean
  onSetMode: (mode: MomPayMode) => void | Promise<void>
  onSetPartial: (amount: number) => void | Promise<void>
}) {
  const cat = expense.category
  const mode: MomPayMode =
    expense.mom_pay_mode === 'partial' || expense.mom_pay_mode === 'full'
      ? expense.mom_pay_mode
      : 'cap'
  const reimb = reimbursableForMom(expense)
  const rawExcess = excessOverCap(expense.amount)
  const uncovered = uncoveredExcess(expense)
  const partialStored = Math.min(Math.max(0, expense.mom_partial_excess_amount ?? 0), rawExcess)
  const [partialDraft, setPartialDraft] = useState(String(partialStored))

  useEffect(() => {
    setPartialDraft(String(partialStored))
  }, [expense.id, partialStored, mode])

  if (cat === 'other' && expense.other_ok_for_mom !== true) {
    return (
      <div className="mom-pay-cell mom-pay-cell--blocked">
        <span className="text-muted">—</span>
        <div className="mom-pay-note">OK in other→mom first</div>
      </div>
    )
  }

  if (!isMomIncludedInPay({ mom_included_in_pay: expense.mom_included_in_pay, category: cat })) {
    return (
      <div className="mom-pay-cell mom-pay-cell--excluded">
        <span className="mono text-muted">{formatThb(0)}</span>
        <div className="mom-pay-note">Mom has not included this line, or she declined</div>
      </div>
    )
  }

  if (
    isReportGreenMomPay({
      category: cat,
      merchant: expense.merchant,
      ocr: expense.ocr,
      mom_included_in_pay: expense.mom_included_in_pay,
      other_ok_for_mom: expense.other_ok_for_mom,
    })
  ) {
    const starbucks = !isUncappedGreenCategory(cat)
    return (
      <div className="mom-pay-cell mom-pay-cell--green">
        <span
          className="mom-pay-green-flag"
          title={starbucks ? 'Starbucks — full amount' : 'Ride / transit — full amount'}
        >
          ●
        </span>
        <span className="mono mom-pay-full">{formatThb(expense.amount)}</span>
      </div>
    )
  }

  if (usesMomPayCap(cat)) {
    return (
      <div className="mom-pay-cell mom-pay-capped">
        <div className="mono mom-pay-line">
          {mode === 'full' ? (
            <span className="mom-pay-full-ok">{formatThb(reimb)}</span>
          ) : rawExcess === 0 ? (
            formatThb(reimb)
          ) : mode === 'partial' && partialStored > 0 ? (
            <>
              <span className="mom-pay-cap-amt">{formatThb(reimb)}</span>
              <span className="mom-pay-exceeds">
                {' '}
                · {formatThb(MOM_PAY_CAP_THB)} + {formatThb(partialStored)} of excess
              </span>
            </>
          ) : (
            <>
              <span className="mom-pay-cap-amt">{formatThb(MOM_PAY_CAP_THB)}</span>
              <span className="mom-pay-exceeds"> · +{formatThb(rawExcess)} over cap</span>
            </>
          )}
        </div>
        {rawExcess > 0 && (
          <>
            <div className="mom-pay-mode-row" role="group" aria-label="Mom pay over cap">
              <button
                type="button"
                className={`btn-mom-mode ${mode === 'cap' ? 'active' : ''}`}
                disabled={disabled}
                onClick={() => onSetMode('cap')}
              >
                Cap only
              </button>
              <button
                type="button"
                className={`btn-mom-mode ${mode === 'partial' ? 'active' : ''}`}
                disabled={disabled}
                onClick={() => onSetMode('partial')}
              >
                Adjust
              </button>
              <button
                type="button"
                className={`btn-mom-mode ${mode === 'full' ? 'active' : ''}`}
                disabled={disabled}
                onClick={() => onSetMode('full')}
              >
                Full slip
              </button>
            </div>
            {mode === 'partial' && (
              <label className="mom-pay-partial">
                <span className="mom-pay-partial-label">Mom covers of excess (max {formatThb(rawExcess)})</span>
                <input
                  type="number"
                  className="mom-pay-partial-input"
                  min={0}
                  max={rawExcess}
                  step={0.01}
                  disabled={disabled}
                  value={partialDraft}
                  onChange={e => setPartialDraft(e.target.value)}
                  onBlur={() => {
                    const n = parseFloat(partialDraft.replace(/,/g, ''))
                    if (Number.isNaN(n)) {
                      setPartialDraft(String(partialStored))
                      return
                    }
                    void onSetPartial(n)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                />
              </label>
            )}
          </>
        )}
        {uncovered > 0 && mode !== 'full' && (
          <div className="mom-pay-note">{formatThb(uncovered)} not covered (you pay)</div>
        )}
      </div>
    )
  }

  return (
    <div className="mom-pay-cell">
      <span className="mono text-muted">{formatThb(reimb)}</span>
    </div>
  )
}

function ProofCell({
  url,
  rawMerchant,
  expenseId,
  onRefresh,
}: {
  url: string | null | undefined
  rawMerchant?: string | null
  expenseId: string
  onRefresh: () => void
}) {
  const [cropMode, setCropMode] = useState(false)

  if (!url) return <div className="proof-cell"><p className="proof-missing">No receipt image</p></div>

  return (
    <div className="proof-cell">
      {cropMode ? (
        <CropSelector
          imageUrl={url}
          expenseId={expenseId}
          onDone={() => { setCropMode(false); onRefresh() }}
        />
      ) : (
        <>
          <img src={url} alt="receipt" className="proof-img" />
          <div className="proof-footer">
            {rawMerchant && (
              <p className="proof-raw-merchant">
                <span className="proof-raw-label">OCR read:</span> {rawMerchant}
              </p>
            )}
            <button
              className="proof-crop-btn"
              onClick={() => setCropMode(true)}
              title="Select a region to re-read"
            >
              ✎ select region
            </button>
          </div>
        </>
      )}
    </div>
  )
}
