import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

// Typed Database interface lives in database.types.ts.
// Use `supabase gen types` after linking your project to regenerate it.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
