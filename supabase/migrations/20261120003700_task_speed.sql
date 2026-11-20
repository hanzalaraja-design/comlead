-- Faster task lists.
--  * Each task keeps how often its deadline was pushed later (due_moves) and
--    its first deadline (first_due_date), kept up to date by the database, so
--    lists don't have to read the activity log to show "+2".
--  * task_history(): a task's history in one go, after one check that you can
--    see the task (instead of checking every history entry).
-- Nothing changes about who can see or change what.

alter table public.tasks
  add column if not exists due_moves integer not null default 0,
  add column if not exists first_due_date date;

-- Count what's already in the history (without touching "last updated").
alter table public.tasks disable trigger tasks_updated_at;
with pushes as (
  select a.task_id,
         count(*) as n,
         (array_agg((a.old_value ->> 'due_date')::date order by a.created_at))[1] as first_due
    from public.activity_log a
   where a.action = 'task.due_changed'
     and a.task_id is not null
     and (a.old_value ->> 'due_date') is not null
     and (a.new_value ->> 'due_date') is not null
     and (a.new_value ->> 'due_date')::date > (a.old_value ->> 'due_date')::date
   group by a.task_id
)
update public.tasks t
   set due_moves = p.n, first_due_date = p.first_due
  from pushes p
 where p.task_id = t.id;
alter table public.tasks enable trigger tasks_updated_at;

create or replace function public.tasks_count_due_moves()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.due_date is not null and new.due_date is not null and new.due_date > old.due_date then
    new.due_moves := old.due_moves + 1;
    new.first_due_date := coalesce(old.first_due_date, old.due_date);
  else
    -- Only the database changes these.
    new.due_moves := old.due_moves;
    new.first_due_date := old.first_due_date;
  end if;
  return new;
end;
$$;
create trigger tasks_count_due_moves before update on public.tasks
  for each row execute function public.tasks_count_due_moves();

-- A task's history, newest first, if you can see the task.
create or replace function public.task_history(p_task uuid, p_limit integer default 50)
returns setof public.activity_log
language sql
stable
security definer
set search_path = ''
as $$
  select a.* from public.activity_log a
   where public.can_read_task(p_task)
     and a.task_id = p_task
     and a.entity_type <> 'meeting'
   order by a.created_at desc
   limit least(coalesce(p_limit, 50), 200);
$$;
revoke execute on function public.task_history(uuid, integer) from public, anon;
grant execute on function public.task_history(uuid, integer) to authenticated;

create index if not exists activity_log_task_time_idx on public.activity_log (task_id, created_at desc) where task_id is not null;

notify pgrst, 'reload schema';
