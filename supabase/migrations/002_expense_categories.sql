-- Expand categories: food, grab, transportation, other (replaces food, transport, unknown)

alter table expenses drop constraint if exists expenses_category_check;
alter table merchants drop constraint if exists merchants_category_check;

update expenses set category = 'transportation' where category = 'transport';
update merchants set category = 'transportation' where category = 'transport';

update expenses set category = 'other' where category = 'unknown';
update merchants set category = 'other' where category = 'unknown';

alter table expenses add constraint expenses_category_check
  check (category in ('food', 'grab', 'transportation', 'other'));

alter table merchants add constraint merchants_category_check
  check (category in ('food', 'grab', 'transportation', 'other'));

-- Column default must match the new check (avoids implicit "unknown" inserts failing)
alter table expenses alter column category set default 'other';
alter table merchants alter column category set default 'other';
