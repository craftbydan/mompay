-- Organizer must explicitly allow each "other" slip before it can count toward mom's pay or block publish.
alter table expenses add column if not exists other_ok_for_mom boolean not null default true;

update expenses set other_ok_for_mom = false where category = 'other';
