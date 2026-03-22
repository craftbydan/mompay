import { supabase } from './supabase'
import type { MerchantNormalizeResult } from '../../api/normalize'
import type { ExpenseCategory } from '../types'

export type { MerchantNormalizeResult }

export interface NormalizeResult {
  merchant_id: string
  canonical_name: string
  category: ExpenseCategory
  payment_method: 'qr' | 'card' | 'unknown'
  auto_classified: boolean
  needs_review: boolean
  is_new: boolean
}

/** When OCR already produced a canonical name + category, skip the /api/normalize round-trip. */
export interface OcrMerchantHint {
  canonical_merchant: string | null
  spend_category: ExpenseCategory
}

interface MerchantRow {
  id: string
  canonical_name: string
  category: string
  payment_method: string
  approved_count: number
  flagged_count: number
  auto_classify: boolean
  aliases: string[]
}

const MATCH_THRESHOLD = 0.6

// Bigram Jaccard similarity — handles Thai + English
function similarity(a: string, b: string): number {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\w\u0E00-\u0E7F\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.85
  const bigrams = (s: string) => {
    const bg = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2))
    return bg
  }
  const bgA = bigrams(na)
  const bgB = bigrams(nb)
  const intersection = [...bgA].filter(t => bgB.has(t)).length
  const union = bgA.size + bgB.size - intersection
  return union === 0 ? 0 : intersection / union
}

export async function normalizeMerchant(
  rawMerchantString: string | null,
  ocrPaymentMethod: 'qr' | 'card' | 'unknown' = 'unknown',
  hint?: OcrMerchantHint | null,
): Promise<NormalizeResult | null> {
  const fuzzySource =
    rawMerchantString?.trim() || hint?.canonical_merchant?.trim() || ''
  if (!fuzzySource) return null

  // 1. Load all merchants and fuzzy-match client-side
  const { data: merchants } = await supabase.from('merchants').select('*')

  let bestMatch: MerchantRow | null = null
  let bestScore = 0

  for (const m of (merchants ?? []) as MerchantRow[]) {
    for (const candidate of [m.canonical_name, ...(m.aliases ?? [])]) {
      const score = similarity(fuzzySource, candidate)
      if (score > bestScore) { bestScore = score; bestMatch = m }
    }
  }

  if (bestMatch && bestScore >= MATCH_THRESHOLD) {
    const pm = (bestMatch.payment_method !== 'unknown'
      ? bestMatch.payment_method
      : ocrPaymentMethod) as NormalizeResult['payment_method']
    return {
      merchant_id: bestMatch.id,
      canonical_name: bestMatch.canonical_name,
      category: bestMatch.category as ExpenseCategory,
      payment_method: pm,
      auto_classified: true,
      needs_review: !bestMatch.auto_classify,
      is_new: false,
    }
  }

  // 2. New merchant — prefer OCR hint (same model call as vision); else text-only API
  let canonical_name = hint?.canonical_merchant?.trim() || ''
  let category: ExpenseCategory = hint?.spend_category ?? 'other'
  let payment_method: 'qr' | 'card' | 'unknown' = ocrPaymentMethod

  if (!canonical_name) {
    const res = await fetch('/api/normalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_merchant_string: rawMerchantString ?? fuzzySource }),
    })

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error ?? `Normalize failed: ${res.status}`)
    }

    const api: MerchantNormalizeResult = await res.json()
    canonical_name = api.canonical_name.trim()
    category = api.category
    payment_method = (api.payment_method !== 'unknown' ? api.payment_method : ocrPaymentMethod) as 'qr' | 'card' | 'unknown'
  }

  if (!canonical_name) return null

  const { data: newMerchant, error: insertErr } = await supabase
    .from('merchants')
    .insert({
      canonical_name,
      category,
      payment_method,
      approved_count: 0,
      flagged_count: 0,
      auto_classify: false,
      aliases: rawMerchantString?.trim() ? [rawMerchantString.trim()] : [],
    })
    .select()
    .single()

  if (insertErr || !newMerchant) throw new Error(insertErr?.message ?? 'Failed to create merchant')

  return {
    merchant_id: newMerchant.id,
    canonical_name,
    category,
    payment_method,
    auto_classified: false,
    needs_review: true,
    is_new: true,
  }
}
