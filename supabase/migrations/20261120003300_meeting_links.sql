-- Meetings linked to projects, campaigns and brand partnerships.
--
--  * Link from either side (the meeting's page or the project's page). The
--    person linking must be able to edit the meeting and be in the project,
--    as before.
--  * When linking, the meeting's existing action items can move into the
--    project's tasks too.
--  * A recurring meeting can be linked as a series: every future meeting in
--    it is linked the same way.
--  * Action items always land in a linked project's tasks, even when the
--    person adding them isn't in the project. Linked to several: each action
--    item goes where you pick (new ones go to the first one linked).
--  * Unlinking moves that project's items to the next one still linked, or
--    leaves them only in the meeting.
-- Who can create tasks, and who can see a project, doesn't change.

alter table public.meeting_projects add column if not exists added_at timestamptz not null default now();

create table public.meeting_series_projects (
  series_id uuid not null references public.meeting_series (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (series_id, project_id)
);
alter table public.meeting_series_projects enable row level security;
revoke all on public.meeting_series_projects from anon;
grant select on public.meeting_series_projects to authenticated;
create policy meeting_series_projects_select on public.meeting_series_projects for select to authenticated
  using (public.is_project_member(project_id) or exists (select 1 from public.meetings m where m.series_id = meeting_series_projects.series_id));

/** The project new action items from this meeting go to: the first one linked. */
create or replace function public.meeting_default_project(p_meeting uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select project_id from public.meeting_projects where meeting_id = p_meeting order by added_at, project_id limit 1;
$$;

-- New action items: into the first linked project, whoever adds them. Done
-- after the insert (as the system), so the rule for who may create a task in
-- a project is unchanged.
create or replace function public.tasks_from_linked_meeting()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  return new; -- replaced by tasks_into_linked_project (after insert)
end;
$$;

-- The task guard, unchanged except that the meeting-link functions below may
-- move an action item into a linked project the person isn't in.
create or replace function public.tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_lead boolean := public.is_dept_lead(old.department_id);
  v_in_project boolean := public.is_project_member(old.project_id);
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

  if new.parent_task_id is distinct from old.parent_task_id then
    raise exception 'A subtask stays with its main task'
      using errcode = 'insufficient_privilege';
  end if;

  -- Reassigning: anyone who can edit the task (checked by the policy) may hand it to anyone.

  if new.parent_task_id is not null
     and (new.department_id is not null or new.project_id is not null) then
    raise exception 'A subtask stays with its main task'
      using errcode = 'insufficient_privilege';
  end if;

  if new.project_id is distinct from old.project_id
     and new.project_id is not null
     and not public.is_project_member(new.project_id)
     -- Action items moved by the meeting-link functions below (they check who may).
     and current_setting('highfy.meeting_link', true) is distinct from 'on' then
    raise exception 'You can only move a task into a project you''re in'
      using errcode = 'insufficient_privilege';
  end if;

  if new.department_id is distinct from old.department_id
     and not v_is_lead
     and not (old.department_id is null and public.is_dept_member(new.department_id))
     and not (new.department_id is null and new.project_id is not null and v_in_project) then
    raise exception 'Only a department admin can move a task to another department'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create or replace function public.tasks_into_linked_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
begin
  if new.meeting_id is null or new.project_id is not null or new.parent_task_id is not null then return null; end if;
  v_project := public.meeting_default_project(new.meeting_id);
  if v_project is not null then
    perform set_config('highfy.meeting_link', 'on', true);
    update public.tasks set project_id = v_project where id = new.id;
    perform set_config('highfy.meeting_link', 'off', true);
  end if;
  return null;
end;
$$;
create trigger tasks_into_linked_project after insert on public.tasks
  for each row execute function public.tasks_into_linked_project();

-- A new meeting in a linked series is linked too.
create or replace function public.meetings_link_from_series()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.series_id is not null then
    insert into public.meeting_projects (meeting_id, project_id, added_at)
    select new.id, sp.project_id, sp.added_at from public.meeting_series_projects sp where sp.series_id = new.series_id
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger meetings_link_from_series after insert on public.meetings
  for each row execute function public.meetings_link_from_series();

-- Unlinked: its action items go to the next project still linked, or stay only in the meeting.
create or replace function public.meeting_projects_unlinked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('highfy.meeting_link', 'on', true);
  update public.tasks
     set project_id = public.meeting_default_project(old.meeting_id)
   where meeting_id = old.meeting_id and project_id = old.project_id and parent_task_id is null;
  perform set_config('highfy.meeting_link', 'off', true);
  return null;
end;
$$;
create trigger meeting_projects_unlinked after delete on public.meeting_projects
  for each row execute function public.meeting_projects_unlinked();

/** Link a meeting to a project, optionally moving its action items and linking its whole series. */
create or replace function public.link_meeting(p_meeting uuid, p_project uuid, p_move boolean default false, p_series boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series uuid;
  v_date date;
begin
  if not (public.can_edit_meeting(p_meeting) and public.is_project_member(p_project)) then
    raise exception 'Only people who can edit the meeting and are in the project can link them' using errcode = 'insufficient_privilege';
  end if;
  select series_id, meeting_date into v_series, v_date from public.meetings where id = p_meeting;
  insert into public.meeting_projects (meeting_id, project_id) values (p_meeting, p_project) on conflict do nothing;
  if p_move then
    perform set_config('highfy.meeting_link', 'on', true);
    update public.tasks set project_id = p_project
     where meeting_id = p_meeting and project_id is null and parent_task_id is null and deleted_at is null;
    perform set_config('highfy.meeting_link', 'off', true);
  end if;
  if p_series and v_series is not null then
    insert into public.meeting_series_projects (series_id, project_id) values (v_series, p_project) on conflict do nothing;
    insert into public.meeting_projects (meeting_id, project_id)
    select m.id, p_project from public.meetings m where m.series_id = v_series and m.meeting_date >= v_date
    on conflict do nothing;
  end if;
end;
$$;

/** Unlink; with p_series, future meetings in the series stop being linked too. */
create or replace function public.unlink_meeting(p_meeting uuid, p_project uuid, p_series boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series uuid;
  v_date date;
begin
  if not (public.can_edit_meeting(p_meeting) or public.can_manage_project(p_project)) then
    raise exception 'Only people who can edit the meeting, or the project''s owners, can unlink them' using errcode = 'insufficient_privilege';
  end if;
  select series_id, meeting_date into v_series, v_date from public.meetings where id = p_meeting;
  delete from public.meeting_projects where meeting_id = p_meeting and project_id = p_project;
  if p_series and v_series is not null then
    delete from public.meeting_series_projects where series_id = v_series and project_id = p_project;
    delete from public.meeting_projects mp using public.meetings m
     where mp.meeting_id = m.id and m.series_id = v_series and m.meeting_date > v_date and mp.project_id = p_project;
  end if;
end;
$$;

/** Where one action item goes: one of the meeting's linked projects, or only the meeting (null). */
create or replace function public.set_action_item_project(p_task uuid, p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task and deleted_at is null;
  if not found or t.meeting_id is null or not public.can_edit_meeting(t.meeting_id) then
    raise exception 'Only people who can edit the meeting can move its action items' using errcode = 'insufficient_privilege';
  end if;
  if p_project is not null and not exists (select 1 from public.meeting_projects where meeting_id = t.meeting_id and project_id = p_project) then
    raise exception 'Link the meeting to it first' using errcode = 'check_violation';
  end if;
  perform set_config('highfy.meeting_link', 'on', true);
  update public.tasks set project_id = p_project where id = p_task;
  perform set_config('highfy.meeting_link', 'off', true);
end;
$$;

revoke execute on function public.link_meeting(uuid, uuid, boolean, boolean), public.unlink_meeting(uuid, uuid, boolean),
  public.set_action_item_project(uuid, uuid), public.meeting_default_project(uuid) from public, anon;
grant execute on function public.link_meeting(uuid, uuid, boolean, boolean), public.unlink_meeting(uuid, uuid, boolean),
  public.set_action_item_project(uuid, uuid), public.meeting_default_project(uuid) to authenticated;

notify pgrst, 'reload schema';
