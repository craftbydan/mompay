const THAI_RE = /[\u0E00-\u0E7F]/

export function textHasThai(s: string): boolean {
  return THAI_RE.test(s)
}

/**
 * Show Thai from the slip when the linked merchant row is Latin-only (old OCR / bad canonical).
 */
export function displayMerchantName(
  merchantCanonical: string | null | undefined,
  rawOcrMerchant: string | null | undefined,
): string {
  const canon = merchantCanonical?.trim() ?? ''
  const raw = rawOcrMerchant?.trim() ?? ''
  if (raw && textHasThai(raw) && canon && !textHasThai(canon)) return raw
  if (canon) return canon
  if (raw) return raw
  return '—'
}
