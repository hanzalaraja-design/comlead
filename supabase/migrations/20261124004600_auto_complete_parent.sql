-- When the last open subtask of a task is done, the task is marked done too.
-- Cancelled and deleted subtasks don't count; there has to be at least one
-- done. It's recorded (and people are told) as finished by whoever finished
-- that last subtask. Reopening a subtask doesn't reopen the task.
-- Safe to run twice.

create or replace function public.tasks_complete_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_task_id is null then return null; end if;
  -- Only when this subtask was just finished (or another one was cancelled or deleted).
  if new.status is not distinct from old.status and new.deleted_at is not distinct from old.deleted_at then return null; end if;
  if new.status not in ('done', 'cancelled') and new.deleted_at is null then return null; end if;

  if exists (
       select 1 from public.tasks p
        where p.id = new.parent_task_id and p.deleted_at is null and p.status not in ('done', 'cancelled'))
     and exists (
       select 1 from public.tasks s
        where s.parent_task_id = new.parent_task_id and s.deleted_at is null and s.status = 'done')
     and not exists (
       select 1 from public.tasks s
        where s.parent_task_id = new.parent_task_id and s.deleted_at is null and s.status not in ('done', 'cancelled')) then
    update public.tasks set status = 'done' where id = new.parent_task_id;
  end if;
  return null;
end;
$$;
revoke execute on function public.tasks_complete_parent() from public, anon, authenticated;

drop trigger if exists tasks_complete_parent on public.tasks;
create trigger tasks_complete_parent after update of status, deleted_at on public.tasks
  for each row execute function public.tasks_complete_parent();

notify pgrst, 'reload schema';
