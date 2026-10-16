-- Phase 2: Outlook calendar sync.
--  * Each department's weekly meeting becomes a recurring Outlook series sent
--    from a shared mailbox (MS_CALENDAR_MAILBOX) to the department's members.
--  * People who switch it on get their own tasks with due dates in Outlook.
-- Sync runs on the server with the service role; nothing here is exposed to
-- normal users except their own on/off switch.

alter table public.departments
  add column meeting_duration_minutes integer not null default 60
    check (meeting_duration_minutes between 15 and 480);

alter table public.profiles
  add column outlook_tasks_enabled boolean not null default false;

-- People can turn their own Outlook task sync on or off (profiles are
-- otherwise Admin-only to update).
create or replace function public.set_outlook_tasks(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_active_user() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.profiles set outlook_tasks_enabled = p_enabled where id = auth.uid();
end;
$$;

revoke execute on function public.set_outlook_tasks(boolean) from public, anon;
grant execute on function public.set_outlook_tasks(boolean) to authenticated;

-- Which Outlook event belongs to which department series / task.
create table public.calendar_links (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('department_series', 'task')),
  department_id uuid references public.departments (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  -- The mailbox the event lives in (shared mailbox, or the task owner's).
  mailbox text not null,
  outlook_event_id text not null,
  -- Fingerprint of what was last written, to skip no-op updates.
  synced_hash text not null,
  updated_at timestamptz not null default now(),
  constraint calendar_links_target check (
    (kind = 'department_series' and department_id is not null and task_id is null)
    or (kind = 'task' and task_id is not null))
);

create unique index calendar_links_department_uq on public.calendar_links (department_id) where kind = 'department_series';
create unique index calendar_links_task_uq on public.calendar_links (task_id, mailbox) where kind = 'task';

-- Service role only: RLS on with no policies.
alter table public.calendar_links enable row level security;
revoke all on public.calendar_links from anon, authenticated;
