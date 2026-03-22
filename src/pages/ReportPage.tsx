import { useEffect, useState, Fragment } from 'react'
import { useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { supabase } from '../lib/supabase'
import { displayMerchantName } from '../lib/merchantDisplay'
import {
  formatThb,
  isAlwaysFullMomPay,
  isUncappedGreenCategory,
  reimbursableForMom,
  uncoveredExcess,
} from '../lib/momPay'
import type { Report, Expense } from '../types'

const CATEGORY_LABEL: Record<string, string> = {
  food: 'Food',
  grab: 'Grab',
  transportation: 'Transport',
  other: 'Other',
}
const METHOD_LABEL = { qr: 'QR', card: 'Card', unknown: '—' }

type ExpenseWithImage = Expense & {
  merchant?: { canonical_name: string; category: string; payment_method: string } | null
  ocr?: { raw_merchant_string: string | null } | null
  signedImageUrl?: string | null
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

    const { data: expenseData } = await supabase
      .from('expenses')
      .select('*, merchant:merchants(canonical_name, category, payment_method), ocr:ocr_raw(raw_merchant_string)')
      .eq('report_id', reportData.id)
      .order('date', { ascending: true })

    const rows = (expenseData ?? []) as ExpenseWithImage[]

    // Batch-generate all signed URLs in one request — instant tap-to-expand
    if (rows.length > 0) {
      const paths = rows.map(e => `expenses/${e.id}`)
      const { data: signed } = await supabase.storage
        .from('receipts').createSignedUrls(paths, 3600)

      if (signed) {
        const urlMap = Object.fromEntries(
          signed.map(s => [s.path?.replace('expenses/', '') ?? '', s.signedUrl ?? null])
        )
        rows.forEach(e => { e.signedImageUrl = urlMap[e.id] ?? null })
      }
    }

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

  const total = expenses.reduce((sum, e) => sum + e.amount, 0)
  const totalMomPays = expenses.reduce((sum, e) => sum + reimbursableForMom(e), 0)
  const totalNotCovered = expenses.reduce((sum, e) => sum + uncoveredExcess(e), 0)

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
              Tap any row to open or close the receipt photo.
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
                </tr>
              </thead>
              <tbody>
                {expenses.map(expense => (
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
                        <span className="category-tag">
                          {CATEGORY_LABEL[expense.category] ?? expense.category}
                        </span>
                      </td>
                      <td className="report-mom-pay" data-label="You pay">
                        {isAlwaysFullMomPay(expense) ? (
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
                    </tr>
                    {expandedId === expense.id && (
                      <tr className="proof-row proof-row--mom">
                        <td colSpan={6}>
                          <div className="proof-cell proof-cell--mom">
                            {expense.signedImageUrl
                              ? <img src={expense.signedImageUrl} alt="Receipt photo" className="proof-img" />
                              : <p className="proof-missing">Receipt image not available</p>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="total-row">
                  <td colSpan={5} className="text-right text-muted">Total spent</td>
                  <td className="mono text-right">
                    {total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                    <span className="currency">THB</span>
                  </td>
                </tr>
                <tr className="total-row">
                  <td colSpan={5} className="text-right text-muted">Your total</td>
                  <td className="mono text-right">
                    {totalMomPays.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                    <span className="currency">THB</span>
                  </td>
                </tr>
                {totalNotCovered > 0 && (
                  <tr className="total-row">
                    <td colSpan={5} className="text-right text-muted">Paid by them, not you</td>
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
                  Check the numbers above and each receipt. When it all looks right, approve — photos are removed after approval.
                </p>
                <button type="button" className="btn-approve btn-approve--mom" onClick={handleApprove} disabled={approving}>
                  {approving ? 'Approving…' : 'Approve report'}
                </button>
              </div>
            )}

            {(report.status === 'approved' || approved) && (
              <div className="approved-banner">
                You approved this report. Receipt images were removed afterward.
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  )
}
