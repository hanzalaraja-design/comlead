-- When a task was done: logging something after the fact no longer makes it late.
--
--  * "Already done on <date>": a past completed_at given with the change is kept.
--  * Logged after the fact: a task added after its due date and ticked off the
--    same day counts as done on its due date, not late.
--  * The owner (or an Admin) can correct the date of a finished task.
-- The activity log still records when each change was actually made.

create or replace function public.tasks_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    if new.completed_at is not null
       and new.completed_at <= now()
       and (tg_op = 'INSERT' or new.completed_at is distinct from old.completed_at) then
      null;  -- a date given with the change: keep it
    elsif new.due_date is not null
       and new.due_date < (coalesce(new.created_at, now()) at time zone 'Asia/Karachi')::date
       and (coalesce(new.created_at, now()) at time zone 'Asia/Karachi')::date = v_today then
      new.completed_at := least(now(), (new.due_date + coalesce(new.due_time, time '12:00')) at time zone 'Asia/Karachi');
    else
      new.completed_at := now();
    end if;
  elsif new.status = 'done' and new.completed_at is distinct from old.completed_at then
    -- Correcting when it was done.
    if new.completed_at is null or new.completed_at > now() then
      new.completed_at := old.completed_at;
    elsif auth.uid() is not null and new.owner_id is distinct from auth.uid() and not public.is_admin() then
      raise exception 'Only the task''s owner can change when it was done'
        using errcode = 'insufficient_privilege';
    end if;
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  if new.status <> 'blocked' then
    new.blocked_reason := null;
  end if;

  if tg_op = 'INSERT' and new.meeting_id is not null and new.source = 'manual' then
    new.source := 'meeting';
  end if;

  -- Tags: trimmed, no blanks, no duplicates.
  new.tags := coalesce(
    (select array_agg(distinct t order by t)
       from unnest(new.tags) as u(raw)
       cross join lateral (select trim(u.raw) as t) x
      where x.t <> ''),
    '{}');

  return new;
end;
$$;

notify pgrst, 'reload schema';
