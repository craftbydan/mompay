-- Wipe all Slip / mompay test data (run in Supabase → SQL Editor).
-- Reports cascade-removes linked expenses and ocr_raw rows.

truncate table reports cascade;
truncate table merchants cascade;

-- Receipt files: Supabase does NOT allow `delete from storage.objects` in SQL.
-- Clear the bucket manually:
--   Dashboard → Storage → bucket "receipts" → select all → Delete
-- Or use the Storage API / supabase-js (service role) to remove objects under prefix "expenses/".
