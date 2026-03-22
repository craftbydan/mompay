-- Organizer can approve reimbursing amount above the ฿200 cap (food/other)
alter table expenses
  add column if not exists mom_allow_excess boolean not null default false;
