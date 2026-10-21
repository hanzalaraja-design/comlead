-- The same task given to several people: each gets their own copy (own status,
-- own due date), linked by set_id so whoever assigned it can see progress.

alter table public.tasks add column set_id uuid;

create index tasks_set_idx on public.tasks (set_id) where set_id is not null;
