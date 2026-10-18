-- Meeting-first update.
--  1. People see only the departments they belong to. Dept admins (role
--     'lead', shown as "Dept admin") no longer see other departments.
--     Company Admin still sees everything.
--  2. Personal tasks: no department, visible only to their owner.
--  3. @mentions in comments: the person is added as a collaborator and gets
--     a mention in their inbox.
--  4. Meetings are set up on their own (one-off, weekly, fortnightly,
--     monthly; internal or external) instead of as a department schedule.

-- ---------------------------------------------------------------------------
-- 1. Access
-- ---------------------------------------------------------------------------

create or replace function public.is_dept_member(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_department_id is not null and (
    public.is_admin()
    or (public.is_active_user() and exists (
          select 1 from public.department_members m
           where m.department_id = p_department_id
             and m.user_id = auth.uid())));
$$;

create or replace function public.is_dept_lead(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_department_id is not null and (
    public.is_admin()
    or (public.is_active_user() and exists (
          select 1 from public.department_members m
           where m.department_id = p_department_id
             and m.user_id = auth.uid()
             and m.role = 'lead')));
$$;

-- No more cross-department reading for dept admins.
create or replace function public.can_read_dept(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_dept_member(p_department_id);
$$;

-- ---------------------------------------------------------------------------
-- 2. Personal tasks
-- ---------------------------------------------------------------------------

alter table public.tasks alter column department_id drop not null;
alter table public.tasks add constraint tasks_personal_shape
  check (department_id is not null or (meeting_id is null and sub_team_id is null));
create index tasks_personal_idx on public.tasks (owner_id) where department_id is null and deleted_at is null;

-- Owners see their personal tasks. Checked on the row itself so a new task
-- can be read back straight after it's created.
drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    deleted_at is null
    and (public.can_read_dept(department_id)
         or public.is_on_task(id)
         or (department_id is null and owner_id = auth.uid() and public.is_active_user())));

drop policy tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and deleted_at is null
    and (
      (public.is_dept_member(department_id)
       and (meeting_id is null or public.meeting_department(meeting_id) = department_id))
      or (meeting_id is not null
          and public.meeting_department(meeting_id) = department_id
          and public.can_edit_meeting(meeting_id))
      -- Personal task: mine, no department.
      or (department_id is null and public.is_active_user() and owner_id = auth.uid())));

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.can_edit_task(id))
  with check (
    deleted_at is null
    and (public.is_dept_member(department_id)
         or public.is_on_task(id)
         or (meeting_id is not null and public.can_edit_meeting(meeting_id))));

-- A personal task can be moved into a department you're in.
create or replace function public.tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_lead boolean := public.is_dept_lead(old.department_id);
  v_meeting_editor boolean := old.meeting_id is not null and public.can_edit_meeting(old.meeting_id);
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.source is distinct from old.source then
    raise exception 'created_by, created_at and source cannot be changed'
      using errcode = 'insufficient_privilege';
  end if;

  if new.deleted_at is distinct from old.deleted_at
     and current_setting('highfy.allow_soft_delete', true) is distinct from 'on' then
    raise exception 'Use delete_task() to delete tasks'
      using errcode = 'insufficient_privilege';
  end if;

  if not v_is_lead and not v_meeting_editor
     and new.owner_id is distinct from old.owner_id
     and old.owner_id is not null
     and old.owner_id <> auth.uid() then
    raise exception 'Only a department admin can reassign a task someone else owns'
      using errcode = 'insufficient_privilege';
  end if;

  -- Personal tasks stay with their owner until moved into a department.
  if new.department_id is null and new.owner_id is distinct from auth.uid() then
    raise exception 'A personal task must belong to you'
      using errcode = 'insufficient_privilege';
  end if;

  if new.department_id is distinct from old.department_id
     and not v_is_lead
     and not (old.department_id is null and public.is_dept_member(new.department_id)) then
    raise exception 'Only a department admin can move a task to another department'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Personal tasks stay out of the shared activity log.
create or replace function public.log_activity(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_entity_label text,
  p_department_id uuid,
  p_task_id uuid default null,
  p_meeting_id uuid default null,
  p_subject_user_id uuid default null,
  p_old jsonb default null,
  p_new jsonb default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_log (
    actor_id, action, entity_type, entity_id, entity_label, department_id,
    task_id, meeting_id, subject_user_id, old_value, new_value)
  select
    auth.uid(), p_action, p_entity_type, p_entity_id, p_entity_label, p_department_id,
    p_task_id, p_meeting_id, p_subject_user_id, p_old, p_new
  where p_task_id is null
     or not exists (select 1 from public.tasks t where t.id = p_task_id and t.department_id is null);
$$;

revoke execute on function public.log_activity(text, text, uuid, text, uuid, uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Mentions
-- ---------------------------------------------------------------------------

create table public.task_mentions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.task_comments (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  mentioned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  unique (comment_id, user_id)
);
create index task_mentions_user_idx on public.task_mentions (user_id, created_at desc);

alter table public.task_mentions enable row level security;
revoke all on public.task_mentions from anon, authenticated;
grant select, update (seen_at) on public.task_mentions to authenticated;

create policy task_mentions_select on public.task_mentions
  for select to authenticated
  using (user_id = auth.uid() and public.is_active_user());

create policy task_mentions_update on public.task_mentions
  for update to authenticated
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid());

-- Called right after posting a comment. Tagged people become collaborators
-- (so they can open the task) and get a mention.
create or replace function public.add_comment_mentions(p_comment_id uuid, p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment public.task_comments;
  v_task public.tasks;
begin
  select * into v_comment from public.task_comments where id = p_comment_id;
  if v_comment.id is null or v_comment.author_id is distinct from auth.uid() or not public.is_active_user() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_task from public.tasks where id = v_comment.task_id;

  insert into public.task_collaborators (task_id, user_id)
  select v_task.id, p.id
    from public.profiles p
   where p.id = any (p_user_ids)
     and p.status = 'active'
     and p.id is distinct from v_task.owner_id
  on conflict do nothing;

  insert into public.task_mentions (comment_id, task_id, user_id, mentioned_by)
  select v_comment.id, v_task.id, p.id, auth.uid()
    from public.profiles p
   where p.id = any (p_user_ids)
     and p.status = 'active'
     and p.id <> auth.uid()
  on conflict do nothing;
end;
$$;

revoke execute on function public.add_comment_mentions(uuid, uuid[]) from public, anon;
grant execute on function public.add_comment_mentions(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Meeting setup
-- ---------------------------------------------------------------------------

create table public.meeting_series (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  -- Home department: who can see and manage it.
  department_id uuid not null references public.departments (id) on delete cascade,
  kind text not null default 'internal' check (kind in ('internal', 'external')),
  frequency text not null default 'weekly' check (frequency in ('once', 'weekly', 'fortnightly', 'monthly')),
  start_date date not null,
  meeting_time time not null,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  external_emails text[] not null default '{}',
  archived boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meeting_series_department_idx on public.meeting_series (department_id) where not archived;

create trigger meeting_series_updated_at
  before update on public.meeting_series
  for each row execute function public.set_updated_at();

-- Whole departments invited.
create table public.meeting_series_departments (
  series_id uuid not null references public.meeting_series (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  primary key (series_id, department_id)
);
create index meeting_series_departments_dept_idx on public.meeting_series_departments (department_id);

-- Individual people invited.
create table public.meeting_series_people (
  series_id uuid not null references public.meeting_series (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (series_id, user_id)
);
create index meeting_series_people_user_idx on public.meeting_series_people (user_id);

alter table public.meetings add column series_id uuid references public.meeting_series (id) on delete set null;
create index meetings_series_date_idx on public.meetings (series_id, meeting_date);

create or replace function public.is_series_invitee(p_series_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and (
    exists (select 1 from public.meeting_series_people p where p.series_id = p_series_id and p.user_id = auth.uid())
    or exists (
      select 1 from public.meeting_series_departments d
        join public.department_members m on m.department_id = d.department_id
       where d.series_id = p_series_id and m.user_id = auth.uid()));
$$;

-- Manage a meeting: its home department's admins, or whoever set it up.
create or replace function public.can_manage_series(p_series_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.meeting_series s
     where s.id = p_series_id
       and (public.is_dept_lead(s.department_id)
            or (public.is_dept_member(s.department_id) and s.created_by = auth.uid())));
$$;

create or replace function public.can_read_series(p_series_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.meeting_series s
     where s.id = p_series_id
       and (public.can_read_dept(s.department_id) or public.is_series_invitee(s.id)));
$$;

grant execute on function public.is_series_invitee(uuid), public.can_manage_series(uuid), public.can_read_series(uuid)
  to authenticated;

alter table public.meeting_series enable row level security;
alter table public.meeting_series_departments enable row level security;
alter table public.meeting_series_people enable row level security;

create policy meeting_series_select on public.meeting_series
  for select to authenticated
  using (public.can_read_dept(department_id) or public.is_series_invitee(id));
create policy meeting_series_insert on public.meeting_series
  for insert to authenticated
  with check (public.is_dept_member(department_id) and created_by = auth.uid());
create policy meeting_series_update on public.meeting_series
  for update to authenticated
  using (public.can_manage_series(id))
  with check (public.is_dept_member(department_id));

create policy meeting_series_departments_select on public.meeting_series_departments
  for select to authenticated using (public.can_read_series(series_id));
create policy meeting_series_departments_insert on public.meeting_series_departments
  for insert to authenticated with check (public.can_manage_series(series_id));
create policy meeting_series_departments_delete on public.meeting_series_departments
  for delete to authenticated using (public.can_manage_series(series_id));

create policy meeting_series_people_select on public.meeting_series_people
  for select to authenticated using (public.can_read_series(series_id));
create policy meeting_series_people_insert on public.meeting_series_people
  for insert to authenticated with check (public.can_manage_series(series_id));
create policy meeting_series_people_delete on public.meeting_series_people
  for delete to authenticated using (public.can_manage_series(series_id));

grant select, insert, update on public.meeting_series to authenticated;
grant select, insert, delete on public.meeting_series_departments, public.meeting_series_people to authenticated;

-- Invitees can open the meetings of a series even outside their department.
drop policy meetings_select on public.meetings;
create policy meetings_select on public.meetings
  for select to authenticated
  using (public.can_read_dept(department_id)
         or public.is_meeting_attendee(id)
         or (series_id is not null and public.is_series_invitee(series_id)));


-- Open the minutes for one occurrence of a meeting, starting them if nobody
-- has yet. Anyone who can see the meeting can do this, including invitees
-- from other departments. Everyone invited becomes an attendee.
create or replace function public.open_series_meeting(p_series_id uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series public.meeting_series;
  v_id uuid;
begin
  if not public.can_read_series(p_series_id) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_series from public.meeting_series where id = p_series_id;
  perform pg_advisory_xact_lock(hashtext(p_series_id::text || p_date::text));

  select id into v_id from public.meetings
   where series_id = p_series_id and meeting_date = p_date
   order by created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.meetings (department_id, series_id, title, meeting_date, meeting_time, created_by)
  values (v_series.department_id, v_series.id, v_series.title, p_date, v_series.meeting_time, auth.uid())
  returning id into v_id;

  insert into public.meeting_attendees (meeting_id, user_id)
  select distinct v_id, u.user_id from (
    select p.user_id from public.meeting_series_people p where p.series_id = p_series_id
    union
    select m.user_id from public.meeting_series_departments d
      join public.department_members m on m.department_id = d.department_id
     where d.series_id = p_series_id
    union
    select auth.uid()
  ) u
  join public.profiles pr on pr.id = u.user_id and pr.status = 'active'
  on conflict do nothing;

  return v_id;
end;
$$;

revoke execute on function public.open_series_meeting(uuid, date) from public, anon;
grant execute on function public.open_series_meeting(uuid, date) to authenticated;

-- Outlook links for meetings set up here.
alter table public.calendar_links add column series_id uuid references public.meeting_series (id) on delete cascade;
alter table public.calendar_links drop constraint calendar_links_kind_check;
alter table public.calendar_links add constraint calendar_links_kind_check
  check (kind in ('department_series', 'task', 'meeting_series'));
alter table public.calendar_links drop constraint calendar_links_target;
alter table public.calendar_links add constraint calendar_links_target check (
  (kind = 'department_series' and department_id is not null and task_id is null)
  or (kind = 'task' and task_id is not null)
  or (kind = 'meeting_series' and series_id is not null));
create unique index calendar_links_series_uq on public.calendar_links (series_id) where kind = 'meeting_series';

-- Move each department's weekly schedule into a meeting of its own, keeping
-- the Outlook series it already has (so nobody gets a second invite).
do $$
declare
  d record;
  v_series uuid;
  v_start date;
begin
  for d in select * from public.departments where meeting_weekday is not null and meeting_time is not null loop
    v_start := public.pkt_today() + ((d.meeting_weekday - extract(isodow from public.pkt_today())::int + 7) % 7);
    insert into public.meeting_series (title, department_id, kind, frequency, start_date, meeting_time, duration_minutes, created_by)
    values (d.name || ' weekly', d.id, 'internal', 'weekly', v_start, d.meeting_time, coalesce(d.meeting_duration_minutes, 60), null)
    returning id into v_series;
    insert into public.meeting_series_departments (series_id, department_id) values (v_series, d.id);
    update public.calendar_links
       set kind = 'meeting_series', series_id = v_series, department_id = null, synced_hash = 'migrated'
     where kind = 'department_series' and department_id = d.id;
    -- Past and current weekly meetings belong to the new series.
    update public.meetings set series_id = v_series where department_id = d.id and series_id is null;
  end loop;
  update public.departments set meeting_weekday = null, meeting_time = null;
end;
$$;

notify pgrst, 'reload schema';
