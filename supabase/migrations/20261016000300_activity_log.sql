-- Highfy Tasks: activity log
-- Written only by database triggers so nothing is missed. Nobody can edit
-- or delete entries through the app (no write policies, no write grants,
-- and a guard trigger that rejects UPDATE/DELETE outright).

create table public.activity_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,                  -- null = system / direct SQL
  action text not null,           -- e.g. 'task.created', 'task.status_changed'
  entity_type text not null,      -- 'task' | 'comment' | 'meeting' | 'membership' | 'attachment'
  entity_id uuid,
  entity_label text,              -- snapshot of the title/name at the time
  department_id uuid,
  task_id uuid,
  meeting_id uuid,
  subject_user_id uuid,           -- membership changes: the person added/removed
  old_value jsonb,
  new_value jsonb
);

create index activity_log_actor_time_idx on public.activity_log (actor_id, created_at);
create index activity_log_dept_time_idx on public.activity_log (department_id, created_at);
create index activity_log_time_idx on public.activity_log (created_at);
create index activity_log_task_idx on public.activity_log (task_id);
create index activity_log_meeting_idx on public.activity_log (meeting_id);

alter table public.activity_log enable row level security;

revoke all on public.activity_log from anon, authenticated;
grant select on public.activity_log to authenticated;

-- Admin sees all. Leads see their departments. Members see their own.
create policy activity_log_select on public.activity_log
  for select to authenticated
  using (
    public.is_admin()
    or (public.is_active_user() and actor_id = auth.uid())
    or (department_id is not null and public.is_dept_lead(department_id)));

create or replace function public.activity_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Activity log entries cannot be changed or deleted'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger activity_log_no_update
  before update or delete on public.activity_log
  for each row execute function public.activity_log_immutable();

create trigger activity_log_no_truncate
  before truncate on public.activity_log
  for each statement execute function public.activity_log_immutable();

-- ---------------------------------------------------------------------------
-- Writer
-- ---------------------------------------------------------------------------

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
  values (
    auth.uid(), p_action, p_entity_type, p_entity_id, p_entity_label, p_department_id,
    p_task_id, p_meeting_id, p_subject_user_id, p_old, p_new);
$$;

-- Internal only: never callable through the API.
revoke execute on function public.log_activity(text, text, uuid, text, uuid, uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

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
        'due_date', new.due_date, 'due_time', new.due_time, 'source', new.source,
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

create trigger tasks_activity
  after insert or update on public.tasks
  for each row execute function public.tasks_activity();

create or replace function public.task_collaborators_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.task_collaborators := coalesce(new, old);
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = v_row.task_id;
  if v_task.id is null then
    return null;  -- task itself is being removed
  end if;
  perform public.log_activity(
    case when tg_op = 'INSERT' then 'task.collaborator_added' else 'task.collaborator_removed' end,
    'task', v_task.id, v_task.title, v_task.department_id, v_task.id, v_task.meeting_id, v_row.user_id,
    null, jsonb_build_object('user_id', v_row.user_id));
  return null;
end;
$$;

create trigger task_collaborators_activity
  after insert or delete on public.task_collaborators
  for each row execute function public.task_collaborators_activity();

-- ---------------------------------------------------------------------------
-- Comments and attachments
-- ---------------------------------------------------------------------------

create or replace function public.task_comments_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = new.task_id;
  perform public.log_activity(
    'comment.added', 'comment', new.id, v_task.title, v_task.department_id, v_task.id, v_task.meeting_id, null,
    null, jsonb_build_object('body', left(new.body, 500)));
  return null;
end;
$$;

create trigger task_comments_activity
  after insert on public.task_comments
  for each row execute function public.task_comments_activity();

create or replace function public.task_attachments_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = new.task_id;
  perform public.log_activity(
    'attachment.added', 'attachment', new.id, v_task.title, v_task.department_id, v_task.id, v_task.meeting_id, null,
    null, jsonb_build_object('file_name', new.file_name));
  return null;
end;
$$;

create trigger task_attachments_activity
  after insert on public.task_attachments
  for each row execute function public.task_attachments_activity();

-- ---------------------------------------------------------------------------
-- Meetings
-- ---------------------------------------------------------------------------

create or replace function public.meetings_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := coalesce(new.title, 'Meeting') || ' (' || to_char(new.meeting_date, 'DD Mon YYYY') || ')';
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(
      'meeting.created', 'meeting', new.id, v_label, new.department_id, null, new.id, null,
      null, jsonb_build_object('meeting_date', new.meeting_date, 'meeting_time', new.meeting_time));
    return null;
  end if;

  if new.minutes is distinct from old.minutes
     or new.agenda is distinct from old.agenda
     or new.decisions is distinct from old.decisions
     or new.title is distinct from old.title
     or new.meeting_date is distinct from old.meeting_date
     or new.meeting_time is distinct from old.meeting_time then
    perform public.log_activity(
      'meeting.minutes_edited', 'meeting', new.id, v_label, new.department_id, null, new.id, null,
      jsonb_build_object(
        'agenda_changed', new.agenda is distinct from old.agenda,
        'minutes_changed', new.minutes is distinct from old.minutes,
        'decisions', old.decisions),
      jsonb_build_object('decisions', new.decisions));
  end if;
  return null;
end;
$$;

create trigger meetings_activity
  after insert or update on public.meetings
  for each row execute function public.meetings_activity();

-- Action items are tasks with meeting_id set. Log them against the meeting
-- too, so a meeting's history shows what was added.
create or replace function public.meeting_action_items_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings;
begin
  if new.meeting_id is null
     or (tg_op = 'UPDATE' and new.meeting_id is not distinct from old.meeting_id) then
    return null;
  end if;
  select * into v_meeting from public.meetings where id = new.meeting_id;
  perform public.log_activity(
    'meeting.action_item_added', 'meeting', v_meeting.id,
    coalesce(v_meeting.title, 'Meeting') || ' (' || to_char(v_meeting.meeting_date, 'DD Mon YYYY') || ')',
    v_meeting.department_id, new.id, v_meeting.id, null,
    null, jsonb_build_object('task_id', new.id, 'title', new.title, 'owner_id', new.owner_id));
  return null;
end;
$$;

create trigger meeting_action_items_activity
  after insert or update of meeting_id on public.tasks
  for each row execute function public.meeting_action_items_activity();

-- ---------------------------------------------------------------------------
-- Department membership
-- ---------------------------------------------------------------------------

create or replace function public.department_members_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.department_members := coalesce(new, old);
  v_dept public.departments;
  v_person text;
begin
  select * into v_dept from public.departments where id = v_row.department_id;
  if v_dept.id is null then
    return null;  -- department itself is being removed
  end if;
  select coalesce(full_name, email) into v_person from public.profiles where id = v_row.user_id;

  if tg_op = 'INSERT' then
    perform public.log_activity(
      'membership.added', 'membership', v_dept.id, coalesce(v_person, 'Unknown') || ' → ' || v_dept.name,
      v_dept.id, null, null, v_row.user_id, null, jsonb_build_object('role', new.role));
  elsif tg_op = 'DELETE' then
    perform public.log_activity(
      'membership.removed', 'membership', v_dept.id, coalesce(v_person, 'Unknown') || ' → ' || v_dept.name,
      v_dept.id, null, null, v_row.user_id, jsonb_build_object('role', old.role), null);
  elsif new.role is distinct from old.role then
    perform public.log_activity(
      'membership.role_changed', 'membership', v_dept.id, coalesce(v_person, 'Unknown') || ' → ' || v_dept.name,
      v_dept.id, null, null, v_row.user_id,
      jsonb_build_object('role', old.role), jsonb_build_object('role', new.role));
  end if;
  return null;
end;
$$;

create trigger department_members_activity
  after insert or update or delete on public.department_members
  for each row execute function public.department_members_activity();
