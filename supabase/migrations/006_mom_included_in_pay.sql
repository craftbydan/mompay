-- Mom can exclude lines from her total; "other" defaults to excluded until she includes them.
alter table expenses add column if not exists mom_included_in_pay boolean not null default true;

update expenses set mom_included_in_pay = false where category = 'other';
