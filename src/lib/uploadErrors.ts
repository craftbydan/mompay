/** Turn Supabase/Postgres errors into short, actionable copy for the upload list. */
export function friendlyProcessingError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)

  if (/expenses_category_check|merchants_category_check/i.test(raw)) {
    return 'Database is still on old category rules. Supabase → SQL Editor → paste and run supabase/migrations/002_expense_categories.sql'
  }

  if (/violates check constraint/i.test(raw)) {
    return 'Database rejected this save. If you upgraded the app, run pending SQL files in supabase/migrations/.'
  }

  return raw.length > 220 ? `${raw.slice(0, 217)}…` : raw
}
