-- Replace boolean excess with: cap | partial (adjust THB of excess) | full
alter table expenses add column if not exists mom_pay_mode text;
alter table expenses add column if not exists mom_partial_excess_amount numeric(12, 2);

update expenses set mom_pay_mode = 'cap' where mom_pay_mode is null or trim(mom_pay_mode) = '';
update expenses set mom_partial_excess_amount = 0 where mom_partial_excess_amount is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'expenses' and column_name = 'mom_allow_excess'
  ) then
    update expenses set mom_pay_mode = 'full' where mom_allow_excess = true;
    alter table expenses drop column mom_allow_excess;
  end if;
end $$;

alter table expenses alter column mom_pay_mode set default 'cap';
alter table expenses alter column mom_partial_excess_amount set default 0;

alter table expenses drop constraint if exists expenses_mom_pay_mode_check;
alter table expenses add constraint expenses_mom_pay_mode_check
  check (mom_pay_mode in ('cap', 'partial', 'full'));

alter table expenses alter column mom_pay_mode set not null;
alter table expenses alter column mom_partial_excess_amount set not null;
