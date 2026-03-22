-- Run this only if you already applied 002 before defaults were added to that file.
alter table expenses alter column category set default 'other';
alter table merchants alter column category set default 'other';
