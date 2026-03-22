export type ReportStatus = 'draft' | 'pending' | 'approved'
export type ExpenseCategory = 'food' | 'grab' | 'transportation' | 'other'
export type PaymentMethod = 'qr' | 'card' | 'unknown'
export type ExpenseStatus = 'pending' | 'confirmed' | 'flagged'
export type MomPayMode = 'cap' | 'partial' | 'full'

export interface Report {
  id: string
  period_start: string
  period_end: string
  status: ReportStatus
  token: string
  created_at: string
}

export interface Merchant {
  id: string
  canonical_name: string
  category: ExpenseCategory
  payment_method: PaymentMethod
  approved_count: number
  flagged_count: number
  auto_classify: boolean
  aliases: string[]
  created_at: string
  updated_at: string
}

export interface Expense {
  id: string
  report_id: string
  date: string
  amount: number
  currency: string
  category: ExpenseCategory
  merchant_id: string | null
  payment_method: PaymentMethod
  auto_classified: boolean
  needs_review: boolean
  status: ExpenseStatus
  /** cap = ฿200 only; partial = ฿200 + up to mom_partial_excess_amount of the overage; full = whole slip */
  mom_pay_mode?: MomPayMode
  /** THB of the *excess* (above ฿200) mom will cover when mode is partial; clamped to actual excess */
  mom_partial_excess_amount?: number
  created_at: string
  merchant?: Merchant
}

export interface OcrRaw {
  id: string
  expense_id: string
  raw_json: Record<string, unknown>
  confidence_scores: Record<string, number>
  raw_merchant_string: string | null
}

export type Role = 'me' | 'mom'
