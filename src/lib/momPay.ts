import type { ExpenseCategory, MomPayMode } from '../types'

/** Mom reimburses up to this for capped categories (food/other) unless mode adds excess. */
export const MOM_PAY_CAP_THB = 200

/** Full slip amount always eligible (green) — rides / transit. */
export function isUncappedGreenCategory(c: ExpenseCategory): boolean {
  return c === 'transportation' || c === 'grab'
}

/** Categories where mom pay follows cap / partial / full. */
export function usesMomPayCap(c: ExpenseCategory): boolean {
  return c === 'food' || c === 'other'
}

function normMerchant(s: string) {
  return s.trim().toLowerCase()
}

/** Starbucks (canonical or OCR text) is always reimbursed in full, like rides. */
export function isStarbucksMerchant(
  canonicalName?: string | null,
  rawOcr?: string | null,
): boolean {
  const c = normMerchant(canonicalName ?? '')
  const r = normMerchant(rawOcr ?? '')
  if (c.includes('starbuck') || c.includes('starbucks')) return true
  if (r.includes('starbuck') || r.includes('starbucks')) return true
  if (r.includes('สตาร์บัค')) return true
  return false
}

type MerchantFields = {
  merchant?: { canonical_name?: string } | null
  ocr?: { raw_merchant_string?: string | null } | null
}

/** Full slip for mom: rides/transit, or Starbucks. */
export function isAlwaysFullMomPay(e: { category: ExpenseCategory } & MerchantFields): boolean {
  if (isUncappedGreenCategory(e.category)) return true
  return isStarbucksMerchant(e.merchant?.canonical_name, e.ocr?.raw_merchant_string)
}

export function excessOverCap(amount: number): number {
  return Math.max(0, round2(amount) - MOM_PAY_CAP_THB)
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function normalizeMomPayMode(m: string | undefined): MomPayMode {
  if (m === 'partial' || m === 'full') return m
  return 'cap'
}

/** New slips: "other" waits for mom to include; everything else defaults included. */
export function defaultMomIncludedInPay(category: ExpenseCategory): boolean {
  return category !== 'other'
}

/** "Other" is never auto-OK for mom's bill until you allow it. */
export function defaultOtherOkForMom(category: ExpenseCategory): boolean {
  return category !== 'other'
}

/** Whether this line counts toward mom's payment (false = she declined or not yet included). */
export function isMomIncludedInPay(e: {
  mom_included_in_pay?: boolean | null
  category?: ExpenseCategory
}): boolean {
  if (e.mom_included_in_pay === false) return false
  if (e.mom_included_in_pay === true) return true
  if (e.category === 'other') return false
  return true
}

/** You (organizer) allowed this "other" slip onto mom's bill. Food / rides / transport are always OK. */
export function isOrganizerOkForMomPay(e: {
  category: ExpenseCategory
  other_ok_for_mom?: boolean | null
}): boolean {
  if (e.category !== 'other') return true
  return e.other_ok_for_mom === true
}

/** Line can affect mom's totals: organizer OK (for "other") + mom did not decline. */
export function isEligibleForMomPay(e: {
  category: ExpenseCategory
  other_ok_for_mom?: boolean | null
  mom_included_in_pay?: boolean | null
}): boolean {
  return isOrganizerOkForMomPay(e) && isMomIncludedInPay(e)
}

/** Green "full slip" styling on mom's report: never for category "other". */
export function isReportGreenMomPay(
  e: {
    category: ExpenseCategory
    mom_included_in_pay?: boolean | null
    other_ok_for_mom?: boolean | null
  } & MerchantFields,
): boolean {
  if (!isEligibleForMomPay(e)) return false
  if (e.category === 'other') return false
  return isAlwaysFullMomPay(e)
}

export function reimbursableForMom(
  e: {
    amount: number
    category: ExpenseCategory
    mom_pay_mode?: string
    mom_partial_excess_amount?: number
    mom_included_in_pay?: boolean | null
    other_ok_for_mom?: boolean | null
  } & MerchantFields,
): number {
  if (!isEligibleForMomPay(e)) return 0

  const amt = round2(e.amount)
  const mode = normalizeMomPayMode(e.mom_pay_mode)
  const partialRaw = round2(Math.max(0, e.mom_partial_excess_amount ?? 0))

  if (isAlwaysFullMomPay(e)) return amt
  if (usesMomPayCap(e.category)) {
    const base = round2(Math.min(amt, MOM_PAY_CAP_THB))
    const excess = excessOverCap(amt)
    if (mode === 'full') return amt
    if (mode === 'cap') return base
    const add = round2(Math.min(partialRaw, excess))
    return round2(base + add)
  }
  return amt
}

export function uncoveredExcess(
  e: {
    amount: number
    category: ExpenseCategory
    mom_pay_mode?: string
    mom_partial_excess_amount?: number
    mom_included_in_pay?: boolean | null
    other_ok_for_mom?: boolean | null
  } & MerchantFields,
): number {
  const amt = round2(e.amount)
  const paid = reimbursableForMom(e)
  return Math.max(0, round2(amt - paid))
}

export function formatThb(n: number) {
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} THB`
}
