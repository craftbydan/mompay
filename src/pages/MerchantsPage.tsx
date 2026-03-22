import { useEffect, useState, type KeyboardEvent } from 'react'
import { Layout } from '../components/Layout'
import { supabase } from '../lib/supabase'

interface Merchant {
  id: string
  canonical_name: string
  category: 'food' | 'grab' | 'transportation' | 'other'
  payment_method: 'qr' | 'card' | 'unknown'
  approved_count: number
  flagged_count: number
  auto_classify: boolean
  aliases: string[]
}

interface EditState {
  id: string
  field: string
  value: string
}

const CATEGORIES = ['food', 'grab', 'transportation', 'other'] as const
const METHODS    = ['qr', 'card', 'unknown'] as const

export function MerchantsPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [loading, setLoading] = useState(true)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => { fetchMerchants() }, [])

  async function fetchMerchants() {
    setLoading(true)
    const { data } = await supabase
      .from('merchants')
      .select('*')
      .order('approved_count', { ascending: false })
    setMerchants((data ?? []) as Merchant[])
    setLoading(false)
  }

  // ─── Toggle auto-classify ──────────────────────────────────────────────────

  async function toggleAutoClassify(merchant: Merchant) {
    const next = !merchant.auto_classify
    setSaving(merchant.id)
    await supabase
      .from('merchants')
      .update({ auto_classify: next })
      .eq('id', merchant.id)
    setMerchants(prev =>
      prev.map(m => m.id === merchant.id ? { ...m, auto_classify: next } : m)
    )
    setSaving(null)
  }

  // ─── Inline editing ────────────────────────────────────────────────────────

  function startEdit(id: string, field: string, value: string) {
    setEditState({ id, field, value })
  }

  async function commitEdit() {
    if (!editState) return
    const { id, field, value } = editState
    setEditState(null)
    if (!value.trim()) return
    setSaving(id)
    await supabase.from('merchants').update({ [field]: value }).eq('id', id)
    setMerchants(prev =>
      prev.map(m => m.id === id ? { ...m, [field]: value } : m)
    )
    setSaving(null)
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') setEditState(null)
  }

  // ─── Alias management ─────────────────────────────────────────────────────

  async function removeAlias(merchant: Merchant, alias: string) {
    const aliases = merchant.aliases.filter(a => a !== alias)
    setSaving(merchant.id)
    await supabase.from('merchants').update({ aliases }).eq('id', merchant.id)
    setMerchants(prev =>
      prev.map(m => m.id === merchant.id ? { ...m, aliases } : m)
    )
    setSaving(null)
  }

  // ─── Filtered list ─────────────────────────────────────────────────────────

  const filtered = merchants.filter(m =>
    !search ||
    m.canonical_name.toLowerCase().includes(search.toLowerCase()) ||
    m.aliases.some(a => a.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <Layout role="me">
      <div className="page-merchants">
        <div className="page-header">
          <h1 className="page-title">Merchants</h1>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {merchants.length} total
          </span>
        </div>

        <p className="merchants-hint">
          Toggle <strong>always recognize</strong> on merchants you want auto-classified
          without waiting for the 10-approval threshold.
        </p>

        <input
          type="text"
          className="search-input"
          placeholder="search merchants…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {loading ? (
          <p className="loading-text">loading…</p>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p>{search ? 'No merchants match.' : 'No merchants yet. They appear after OCR.'}</p>
          </div>
        ) : (
          <table className="merchants-table">
            <thead>
              <tr>
                <th className="col-train">always recognize</th>
                <th>merchant</th>
                <th>category</th>
                <th>method</th>
                <th className="text-right">approved</th>
                <th className="text-right">flagged</th>
                <th className="col-expand" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(merchant => {
                const isEditing = (f: string) =>
                  editState?.id === merchant.id && editState.field === f
                const isSaving = saving === merchant.id
                const isExpanded = expandedId === merchant.id

                return (
                  <>
                    <tr
                      key={merchant.id}
                      className={`merchant-row ${isSaving ? 'saving' : ''} ${merchant.auto_classify ? 'merchant-trained' : ''}`}
                    >
                      {/* Auto-classify toggle */}
                      <td className="col-train">
                        <button
                          className={`train-toggle ${merchant.auto_classify ? 'active' : ''}`}
                          onClick={() => toggleAutoClassify(merchant)}
                          disabled={isSaving}
                          title={merchant.auto_classify ? 'Click to disable auto-recognition' : 'Click to always auto-recognize'}
                        >
                          {merchant.auto_classify ? '★ on' : '☆ off'}
                        </button>
                      </td>

                      {/* Name */}
                      <td
                        className="merchant-name-cell"
                        onClick={() => startEdit(merchant.id, 'canonical_name', merchant.canonical_name)}
                      >
                        {isEditing('canonical_name') ? (
                          <input
                            autoFocus
                            type="text"
                            className="cell-input"
                            value={editState!.value}
                            onChange={e => setEditState(s => s && { ...s, value: e.target.value })}
                            onBlur={commitEdit}
                            onKeyDown={handleKeyDown}
                          />
                        ) : (
                          <span className="merchant-name">{merchant.canonical_name}</span>
                        )}
                      </td>

                      {/* Category */}
                      <td onClick={() => startEdit(merchant.id, 'category', merchant.category)}>
                        {isEditing('category') ? (
                          <select
                            autoFocus
                            className="cell-select"
                            value={editState!.value}
                            onChange={e => setEditState(s => s && { ...s, value: e.target.value })}
                            onBlur={commitEdit}
                            onKeyDown={handleKeyDown}
                          >
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : (
                          <span className="category-tag">{merchant.category}</span>
                        )}
                      </td>

                      {/* Method */}
                      <td onClick={() => startEdit(merchant.id, 'payment_method', merchant.payment_method)}>
                        {isEditing('payment_method') ? (
                          <select
                            autoFocus
                            className="cell-select"
                            value={editState!.value}
                            onChange={e => setEditState(s => s && { ...s, value: e.target.value })}
                            onBlur={commitEdit}
                            onKeyDown={handleKeyDown}
                          >
                            {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        ) : (
                          <span className="text-muted">{merchant.payment_method}</span>
                        )}
                      </td>

                      {/* Stats */}
                      <td className="mono text-right">
                        <span className="stat-approved">{merchant.approved_count}</span>
                      </td>
                      <td className="mono text-right">
                        <span className={merchant.flagged_count > 0 ? 'stat-flagged' : 'text-muted'}>
                          {merchant.flagged_count}
                        </span>
                      </td>

                      {/* Expand aliases */}
                      <td className="col-expand">
                        {merchant.aliases.length > 0 && (
                          <button
                            className={`action-btn proof-btn ${isExpanded ? 'active' : ''}`}
                            onClick={() => setExpandedId(p => p === merchant.id ? null : merchant.id)}
                            title="View aliases"
                          >
                            {isExpanded ? '⌃' : '⌄'}
                          </button>
                        )}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr key={`${merchant.id}-aliases`} className="aliases-row">
                        <td colSpan={7}>
                          <div className="aliases-cell">
                            <span className="aliases-label">aliases</span>
                            <div className="aliases-list">
                              {merchant.aliases.map(alias => (
                                <span key={alias} className="alias-tag">
                                  {alias}
                                  <button
                                    className="alias-remove"
                                    onClick={() => removeAlias(merchant, alias)}
                                    title="Remove alias"
                                  >×</button>
                                </span>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  )
}
