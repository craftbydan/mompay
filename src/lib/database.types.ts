export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      reports: {
        Row: {
          id: string
          period_start: string
          period_end: string
          status: 'draft' | 'pending' | 'approved'
          token: string
          created_at: string
        }
        Insert: {
          id?: string
          period_start: string
          period_end: string
          status?: 'draft' | 'pending' | 'approved'
          token?: string
          created_at?: string
        }
        Update: {
          id?: string
          period_start?: string
          period_end?: string
          status?: 'draft' | 'pending' | 'approved'
          token?: string
          created_at?: string
        }
      }
      expenses: {
        Row: {
          id: string
          report_id: string
          date: string
          amount: number
          currency: string
          category: 'food' | 'grab' | 'transportation' | 'other'
          merchant_id: string | null
          payment_method: 'qr' | 'card' | 'unknown'
          auto_classified: boolean
          needs_review: boolean
          status: 'pending' | 'confirmed' | 'flagged'
          mom_pay_mode: 'cap' | 'partial' | 'full'
          mom_partial_excess_amount: number
          mom_included_in_pay: boolean
          other_ok_for_mom: boolean
          created_at: string
        }
        Insert: {
          id?: string
          report_id: string
          date: string
          amount: number
          currency?: string
          category?: 'food' | 'grab' | 'transportation' | 'other'
          merchant_id?: string | null
          payment_method?: 'qr' | 'card' | 'unknown'
          auto_classified?: boolean
          needs_review?: boolean
          status?: 'pending' | 'confirmed' | 'flagged'
          mom_pay_mode?: 'cap' | 'partial' | 'full'
          mom_partial_excess_amount?: number
          mom_included_in_pay?: boolean
          other_ok_for_mom?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          report_id?: string
          date?: string
          amount?: number
          currency?: string
          category?: 'food' | 'grab' | 'transportation' | 'other'
          merchant_id?: string | null
          payment_method?: 'qr' | 'card' | 'unknown'
          auto_classified?: boolean
          needs_review?: boolean
          status?: 'pending' | 'confirmed' | 'flagged'
          mom_pay_mode?: 'cap' | 'partial' | 'full'
          mom_partial_excess_amount?: number
          mom_included_in_pay?: boolean
          other_ok_for_mom?: boolean
          created_at?: string
        }
      }
      ocr_raw: {
        Row: {
          id: string
          expense_id: string
          raw_json: Json
          confidence_scores: Json
          raw_merchant_string: string | null
        }
        Insert: {
          id?: string
          expense_id: string
          raw_json: Json
          confidence_scores: Json
          raw_merchant_string?: string | null
        }
        Update: {
          id?: string
          expense_id?: string
          raw_json?: Json
          confidence_scores?: Json
          raw_merchant_string?: string | null
        }
      }
      merchants: {
        Row: {
          id: string
          canonical_name: string
          category: 'food' | 'grab' | 'transportation' | 'other'
          payment_method: 'qr' | 'card' | 'unknown'
          approved_count: number
          flagged_count: number
          auto_classify: boolean
          aliases: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          canonical_name: string
          category?: 'food' | 'grab' | 'transportation' | 'other'
          payment_method?: 'qr' | 'card' | 'unknown'
          approved_count?: number
          flagged_count?: number
          auto_classify?: boolean
          aliases?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          canonical_name?: string
          category?: 'food' | 'grab' | 'transportation' | 'other'
          payment_method?: 'qr' | 'card' | 'unknown'
          approved_count?: number
          flagged_count?: number
          auto_classify?: boolean
          aliases?: string[]
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}
