import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { supabase } from '../lib/supabase'
import { reimbursableForMom } from '../lib/momPay'
import type { Report } from '../types'

export function MomPage() {
  const navigate = useNavigate()
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('reports')
      .select('*')
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setReports((data ?? []) as Report[])
        setLoading(false)
      })
  }, [])

  const pending  = reports.filter(r => r.status === 'pending')
  const approved = reports.filter(r => r.status === 'approved')

  return (
    <Layout role="mom">
      <div className="page-mom">
        <div className="page-header">
          <div>
            <h1 className="page-title">Reports to review</h1>
            <p className="page-intro">
              Published reports from the organizer show up here. Open one to see line items and approve.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="loading-text">Loading…</p>
        ) : reports.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">Nothing waiting</p>
            <p>When the organizer publishes a report, it will appear under <strong>Pending approval</strong>. Ask them to send the link if you expected one.</p>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <section className="mom-section">
                <h2 className="mom-section-title">Pending approval</h2>
                <div className="mom-cards">
                  {pending.map(r => (
                    <ReportCard
                      key={r.id}
                      report={r}
                      onClick={() => navigate(`/report/${r.token}`)}
                    />
                  ))}
                </div>
              </section>
            )}

            {approved.length > 0 && (
              <section className="mom-section">
                <h2 className="mom-section-title">Approved</h2>
                <div className="mom-cards">
                  {approved.map(r => (
                    <ReportCard
                      key={r.id}
                      report={r}
                      onClick={() => navigate(`/report/${r.token}`)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Layout>
  )
}

function ReportCard({ report, onClick }: { report: Report; onClick: () => void }) {
  const [expenseCount, setExpenseCount] = useState<number | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [youPay, setYouPay] = useState<number | null>(null)

  useEffect(() => {
    const apply = (rows: Record<string, unknown>[]) => {
      setExpenseCount(rows.length)
      const slip = rows.reduce((s, e) => s + (Number(e.amount) || 0), 0)
      setTotal(slip)
      const mom = rows.reduce((s, row) => {
        const m = row.merchant
        const o = row.ocr
        const merchant = Array.isArray(m) ? (m[0] as { canonical_name?: string } | undefined) ?? null : (m as { canonical_name?: string } | null) ?? null
        const ocr = Array.isArray(o) ? (o[0] as { raw_merchant_string?: string | null } | undefined) ?? null : (o as { raw_merchant_string?: string | null } | null) ?? null
        return (
          s +
          reimbursableForMom({
            amount: Number(row.amount) || 0,
            category: (row.category ?? 'other') as 'food' | 'grab' | 'transportation' | 'other',
            mom_pay_mode: row.mom_pay_mode as string | undefined,
            mom_partial_excess_amount: Number(row.mom_partial_excess_amount) || 0,
            mom_included_in_pay: row.mom_included_in_pay as boolean | undefined,
            other_ok_for_mom: row.other_ok_for_mom as boolean | undefined,
            merchant,
            ocr,
          })
        )
      }, 0)
      setYouPay(mom)
    }

    supabase
      .from('expenses')
      .select(
        'amount, category, mom_pay_mode, mom_partial_excess_amount, mom_included_in_pay, other_ok_for_mom, merchant:merchants(canonical_name), ocr:ocr_raw(raw_merchant_string)',
      )
      .eq('report_id', report.id)
      .then(({ data, error }) => {
        if (!error && data) {
          apply(data)
          return
        }
        supabase
          .from('expenses')
          .select('amount, category')
          .eq('report_id', report.id)
          .then(({ data: rows }) => {
            apply(rows ?? [])
          })
      })
  }, [report.id])

  const isPending = report.status === 'pending'

  return (
    <div className={`mom-card ${isPending ? 'mom-card-pending' : 'mom-card-approved'}`} onClick={onClick}>
      <div className="mom-card-header">
        <span className="mono mom-card-period">
          {report.period_start === report.period_end
            ? report.period_start
            : `${report.period_start} → ${report.period_end}`}
        </span>
        <span className={`status-badge status-${report.status}`}>{report.status}</span>
      </div>
      <div className="mom-card-body">
        {expenseCount !== null && youPay !== null ? (
          <>
            <div className="mom-card-body-primary">
              <span className="mom-card-you-label">Your total</span>
              <span className="mono mom-card-you-pay">
                {youPay.toLocaleString('en-US', { minimumFractionDigits: 2 })} THB
              </span>
            </div>
            <div className="mom-card-body-secondary">
              <span className="mom-card-count">{expenseCount} line{expenseCount !== 1 ? 's' : ''}</span>
              <span className="mono mom-card-slip-total">
                Receipts total {total?.toLocaleString('en-US', { minimumFractionDigits: 2 })} THB
              </span>
            </div>
          </>
        ) : (
          <span className="text-muted">Loading…</span>
        )}
      </div>
      {isPending && (
        <div className="mom-card-cta">Open to review and approve →</div>
      )}
    </div>
  )
}
