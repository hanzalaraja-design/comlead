-- 1. Anyone in a meeting can write its minutes.
--    * Any department member can start a meeting for their department.
--    * Attendees (plus the meeting's creator, the department's Leads and
--      Admin) can edit minutes, decisions, attendees and action items,
--      including reassigning action items.
--    * Attendees from other departments can open the meeting.
--    * Deleting a meeting stays Lead / Admin only.
-- 2. Tasks get an optional start date (for the timeline / Gantt view).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_meeting_attendee(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and exists (
    select 1 from public.meeting_attendees a
     where a.meeting_id = p_meeting_id and a.user_id = auth.uid());
$$;

create or replace function public.can_edit_meeting(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.meetings m
     where m.id = p_meeting_id
       and (public.is_dept_lead(m.department_id)
            or public.is_meeting_attendee(m.id)
            or (public.is_active_user() and m.created_by = auth.uid())));
$$;

grant execute on function public.is_meeting_attendee(uuid), public.can_edit_meeting(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Meetings
-- ---------------------------------------------------------------------------

drop policy meetings_select on public.meetings;
create policy meetings_select on public.meetings
  for select to authenticated
  using (public.can_read_dept(department_id) or public.is_meeting_attendee(id));

drop policy meetings_insert on public.meetings;
create policy meetings_insert on public.meetings
  for insert to authenticated
  with check (public.is_dept_member(department_id) and created_by = auth.uid());

drop policy meetings_update on public.meetings;
create policy meetings_update on public.meetings
  for update to authenticated
  using (public.can_edit_meeting(id))
  with check (public.can_edit_meeting(id));

-- A meeting can't be moved to another department except by its Leads.
create or replace function public.meetings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.department_id is distinct from old.department_id
     and not (public.is_dept_lead(old.department_id) and public.is_dept_lead(new.department_id)) then
    raise exception 'Only a department Lead can move a meeting to another department'
      using errcode = 'insufficient_privilege';
  end if;
  if new.created_by is distinct from old.created_by and auth.uid() is not null then
    raise exception 'created_by cannot be changed' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger meetings_guard
  before update on public.meetings
  for each row execute function public.meetings_guard();

drop policy meeting_attendees_select on public.meeting_attendees;
create policy meeting_attendees_select on public.meeting_attendees
  for select to authenticated
  using (public.can_read_dept(public.meeting_department(meeting_id)) or public.is_meeting_attendee(meeting_id));

drop policy meeting_attendees_insert on public.meeting_attendees;
create policy meeting_attendees_insert on public.meeting_attendees
  for insert to authenticated
  with check (public.can_edit_meeting(meeting_id));

drop policy meeting_attendees_delete on public.meeting_attendees;
create policy meeting_attendees_delete on public.meeting_attendees
  for delete to authenticated
  using (public.can_edit_meeting(meeting_id));

-- ---------------------------------------------------------------------------
-- Action items (tasks with meeting_id): editable by the meeting's editors
-- ---------------------------------------------------------------------------

drop policy tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and deleted_at is null
    and (
      (public.is_dept_member(department_id)
       and (meeting_id is null or public.meeting_department(meeting_id) = department_id))
      -- Action items added by anyone who can edit the meeting.
      or (meeting_id is not null
          and public.meeting_department(meeting_id) = department_id
          and public.can_edit_meeting(meeting_id))));

create or replace function public.can_edit_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task_id
       and t.deleted_at is null
       and (public.is_dept_lead(t.department_id)
            or (public.is_active_user() and t.created_by = auth.uid())
            or public.is_on_task(t.id)
            or (t.meeting_id is not null and public.can_edit_meeting(t.meeting_id))));
$$;

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.can_edit_task(id))
  with check (
    deleted_at is null
    and (public.is_dept_member(department_id)
         or public.is_on_task(id)
         or (meeting_id is not null and public.can_edit_meeting(meeting_id))));

create or replace function public.tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_lead boolean := public.is_dept_lead(old.department_id);
  v_meeting_editor boolean := old.meeting_id is not null and public.can_edit_meeting(old.meeting_id);
begin
  -- Direct SQL / service role (no JWT) is trusted.
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

  -- Leads, and people in the meeting an action item came from, may reassign.
  if not v_is_lead and not v_meeting_editor
     and new.owner_id is distinct from old.owner_id
     and old.owner_id is not null
     and old.owner_id <> auth.uid() then
    raise exception 'Only a department Lead can reassign a task someone else owns'
      using errcode = 'insufficient_privilege';
  end if;

  if not v_is_lead and new.department_id is distinct from old.department_id then
    raise exception 'Only a department Lead can move a task to another department'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Start date
-- ---------------------------------------------------------------------------

alter table public.tasks add column start_date date;
alter table public.tasks add constraint tasks_start_before_due
  check (start_date is null or due_date is null or start_date <= due_date);
create index tasks_start_idx on public.tasks (start_date) where deleted_at is null;

-- Log start date changes with other edits.
create or replace function public.tasks_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(
      'task.created', 'task', new.id, new.title, new.department_id, new.id, new.meeting_id, null, null,
      jsonb_build_object(
        'status', new.status, 'priority', new.priority, 'owner_id', new.owner_id,
        'due_date', new.due_date, 'due_time', new.due_time, 'start_date', new.start_date, 'source', new.source,
        'meeting_id', new.meeting_id));
    return new;
  end if;

  -- Soft delete
  if new.deleted_at is not null and old.deleted_at is null then
    perform public.log_activity(
      'task.deleted', 'task', new.id, new.title, new.department_id, new.id, new.meeting_id, null,
      jsonb_build_object('status', old.status), null);
    return new;
  end if;

  if new.status is distinct from old.status then
    perform public.log_activity(
      case when new.status = 'done' then 'task.completed' else 'task.status_changed' end,
      'task', new.id, new.title, new.department_id, new.id, new.meeting_id, null,
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status, 'blocked_reason', new.blocked_reason));
  end if;

  if new.owner_id is distinct from old.owner_id then
    perform public.log_activity(
      'task.reassigned', 'task', new.id, new.title, new.department_id, new.id, new.meeting_id, null,
      jsonb_build_object('owner_id', old.owner_id),
      jsonb_build_object('owner_id', new.owner_id));
  end if;

  if new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time then
    perform public.log_activity(
      'task.due_changed', 'task', new.id, new.title, new.department_id, new.id, new.meeting_id, null,
      jsonb_build_object('due_date', old.due_date, 'due_time', old.due_time),
      jsonb_build_object('due_date', new.due_date, 'due_time', new.due_time));
  end if;

  -- Everything else is one "edited" entry listing just the changed fields.
  if new.title is distinct from old.title then
    v_old := v_old || jsonb_build_object('title', old.title);
    v_new := v_new || jsonb_build_object('title', new.title);
  end if;
  if new.description is distinct from old.description then
    v_old := v_old || jsonb_build_object('description', old.description);
    v_new := v_new || jsonb_build_object('description', new.description);
  end if;
  if new.start_date is distinct from old.start_date then
    v_old := v_old || jsonb_build_object('start_date', old.start_date);
    v_new := v_new || jsonb_build_object('start_date', new.start_date);
  end if;
  if new.priority is distinct from old.priority then
    v_old := v_old || jsonb_build_object('priority', old.priority);
    v_new := v_new || jsonb_build_object('priority', new.priority);
  end if;
  if new.tags is distinct from old.tags then
    v_old := v_old || jsonb_build_object('tags', old.tags);
    v_new := v_new || jsonb_build_object('tags', new.tags);
  end if;
  if new.department_id is distinct from old.department_id then
    v_old := v_old || jsonb_build_object('department_id', old.department_id);
    v_new := v_new || jsonb_build_object('department_id', new.department_id);
  end if;
  if new.sub_team_id is distinct from old.sub_team_id then
    v_old := v_old || jsonb_build_object('sub_team_id', old.sub_team_id);
    v_new := v_new || jsonb_build_object('sub_team_id', new.sub_team_id);
  end if;
  if new.blocked_reason is distinct from old.blocked_reason and new.status is not distinct from old.status then
    v_old := v_old || jsonb_build_object('blocked_reason', old.blocked_reason);
    v_new := v_new || jsonb_build_object('blocked_reason', new.blocked_reason);
  end if;
  if new.meeting_id is distinct from old.meeting_id then
    v_old := v_old || jsonb_build_object('meeting_id', old.meeting_id);
    v_new := v_new || jsonb_build_object('meeting_id', new.meeting_id);
  end if;

  if v_new <> '{}'::jsonb then
    perform public.log_activity(
      'task.edited', 'task', new.id, new.title, new.department_id, new.id, new.meeting_id, null,
      v_old, v_new);
  end if;

  return new;
end;
$$;
