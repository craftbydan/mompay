import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import type { Report } from '../types'
import { supabase } from '../lib/supabase'

export function MePage() {
  const navigate = useNavigate()
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null)

  useEffect(() => {
    fetchReports()
  }, [])

  async function fetchReports() {
    setLoading(true)
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error && data) setReports(data as Report[])
    setLoading(false)
  }

  async function handleCreateReport() {
    setCreating(true)
    setCreateError('')
    const today = new Date().toISOString().split('T')[0]
    const token = crypto.randomUUID()

    const { data, error } = await supabase
      .from('reports')
      .insert({
        period_start: today,
        period_end: today,
        status: 'draft',
        token,
      })
      .select()
      .single()

    setCreating(false)
    if (error || !data) {
      setCreateError(error?.message ?? 'Failed to create report')
      return
    }
    navigate(`/me/report/${data.id}`)
  }

  function copyReportLink(e: React.MouseEvent, token: string) {
    e.stopPropagation()
    navigator.clipboard.writeText(`${window.location.origin}/report/${token}`)
  }

  async function handleDeleteDraft(e: React.MouseEvent, report: Report) {
    e.stopPropagation()
    if (!confirm('Delete this draft report and all its expenses? Receipt files will be removed. This cannot be undone.')) return
    setDeletingReportId(report.id)
    try {
      const { data: rows } = await supabase.from('expenses').select('id').eq('report_id', report.id)
      const paths = (rows ?? []).map(r => `expenses/${r.id}`)
      if (paths.length) await supabase.storage.from('receipts').remove(paths)
      await supabase.from('reports').delete().eq('id', report.id)
      await fetchReports()
    } finally {
      setDeletingReportId(null)
    }
  }

  async function handleDeleteSentReport(e: React.MouseEvent, report: Report) {
    e.stopPropagation()
    const isPending = report.status === 'pending'
    const msg = isPending
      ? 'Delete this request? The link you sent to mom will stop working, all slips will be removed, and receipt files will be deleted. This cannot be undone.'
      : 'Delete this approved report? Mom’s link will stop working and all data for this report will be removed. This cannot be undone.'
    if (!confirm(msg)) return
    setDeletingReportId(report.id)
    try {
      const { data: rows } = await supabase.from('expenses').select('id').eq('report_id', report.id)
      const paths = (rows ?? []).map(r => `expenses/${r.id}`)
      if (paths.length) await supabase.storage.from('receipts').remove(paths)
      await supabase.from('reports').delete().eq('id', report.id)
      await fetchReports()
    } finally {
      setDeletingReportId(null)
    }
  }

  return (
    <Layout role="me">
      <div className="page-me">
        <div className="page-header">
          <div>
            <h1 className="page-title">Reports</h1>
            <p className="page-intro">
              Each report holds your receipts. When you are ready, publish a link for the reviewer.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <button className="btn-primary" onClick={handleCreateReport} disabled={creating}>
              {creating ? 'Creating…' : 'New report'}
            </button>
            {createError && <p className="form-error">{createError}</p>}
          </div>
        </div>

        {loading ? (
          <p className="loading-text">Loading reports…</p>
        ) : reports.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">No reports yet</p>
            <p>Use <strong>New report</strong> to start a period, upload receipts, then publish when the rows look right.</p>
          </div>
        ) : (
          <table className="reports-table">
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {reports.map(report => (
                <tr
                  key={report.id}
                  className="report-row clickable"
                  onClick={() => navigate(`/me/report/${report.id}`)}
                >
                  <td className="mono">
                    {report.period_start === report.period_end
                      ? report.period_start
                      : `${report.period_start} → ${report.period_end}`}
                  </td>
                  <td>
                    <span className={`status-badge status-${report.status}`}>
                      {report.status}
                    </span>
                  </td>
                  <td className="mono text-muted">
                    {new Date(report.created_at).toLocaleDateString()}
                  </td>
                  <td className="row-actions">
                    {(report.status === 'pending' || report.status === 'approved') && (
                      <>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={e => copyReportLink(e, report.token)}
                        >
                          Copy link
                        </button>
                        <button
                          type="button"
                          className="btn-danger-ghost"
                          disabled={deletingReportId === report.id}
                          onClick={e => void handleDeleteSentReport(e, report)}
                        >
                          {deletingReportId === report.id
                            ? 'Deleting…'
                            : report.status === 'pending'
                              ? 'Delete request'
                              : 'Delete report'}
                        </button>
                      </>
                    )}
                    {report.status === 'draft' && (
                      <button
                        type="button"
                        className="btn-danger-ghost"
                        disabled={deletingReportId === report.id}
                        onClick={e => void handleDeleteDraft(e, report)}
                      >
                        {deletingReportId === report.id ? 'Deleting…' : 'Delete draft'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  )
}
