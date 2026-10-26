-- Subtasks ("Needed from others"): a piece of a task given to someone, from
-- any team, with their own deadline. A subtask is a task of its own (status,
-- comments, calendar) that points at its main task. One level only.
--
-- Whoever can see the main task sees its subtasks; whoever has a subtask can
-- see the main task it feeds into. Whoever can edit the main task can add,
-- change and close its subtasks.

alter table public.tasks add column parent_task_id uuid references public.tasks (id) on delete cascade;
create index tasks_parent_idx on public.tasks (parent_task_id) where parent_task_id is not null and deleted_at is null;

create or replace function public.task_parent(p_task_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select parent_task_id from public.tasks where id = p_task_id;
$$;

-- You own (or help on) a subtask of this task.
create or replace function public.has_subtask_on(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and exists (
    select 1 from public.tasks s
     where s.parent_task_id = p_task_id
       and s.deleted_at is null
       and (s.owner_id = auth.uid()
            or exists (select 1 from public.task_collaborators c where c.task_id = s.id and c.user_id = auth.uid())));
$$;

grant execute on function public.task_parent(uuid), public.has_subtask_on(uuid) to authenticated;

create or replace function public.can_read_task(p_task_id uuid)
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
       and (public.can_read_dept(t.department_id)
            or public.is_on_task(t.id)
            or public.is_project_member(t.project_id)
            or public.has_subtask_on(t.id)
            or (t.parent_task_id is not null and public.can_read_task(t.parent_task_id))));
$$;

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
            or (t.meeting_id is not null and public.can_edit_meeting(t.meeting_id))
            or public.is_project_member(t.project_id)
            or (t.parent_task_id is not null and public.can_edit_task(t.parent_task_id))));
$$;

create or replace function public.can_delete_task(p_task_id uuid)
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
            or public.can_manage_project(t.project_id)
            or (t.parent_task_id is not null and public.can_edit_task(t.parent_task_id))
            or (public.is_active_user() and t.created_by = auth.uid()
                and (t.owner_id is null or t.owner_id = auth.uid()))));
$$;

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    deleted_at is null
    and (public.can_read_dept(department_id)
         or public.is_on_task(id)
         or public.is_project_member(project_id)
         or (department_id is null and owner_id = auth.uid() and public.is_active_user())
         or public.has_subtask_on(id)
         or (parent_task_id is not null and public.can_read_task(parent_task_id))));

drop policy tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and deleted_at is null
    and (project_id is null or public.is_project_member(project_id))
    and (
      -- Subtask: for anyone, by whoever can edit the main task. One level deep.
      (parent_task_id is not null
       and department_id is null and project_id is null and meeting_id is null
       and public.task_parent(parent_task_id) is null
       and public.can_edit_task(parent_task_id))
      or (parent_task_id is null and (
        (public.is_dept_member(department_id)
         and (meeting_id is null or public.meeting_department(meeting_id) = department_id))
        or (meeting_id is not null
            and public.meeting_department(meeting_id) = department_id
            and public.can_edit_meeting(meeting_id))
        or (department_id is null and project_id is not null and meeting_id is null)
        or (department_id is null and project_id is null and public.is_active_user() and owner_id = auth.uid())))));

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.can_edit_task(id))
  with check (
    deleted_at is null
    and (public.is_dept_member(department_id)
         or public.is_on_task(id)
         or public.is_project_member(project_id)
         or (meeting_id is not null and public.can_edit_meeting(meeting_id))
         or (parent_task_id is not null and public.can_edit_task(parent_task_id))));

create or replace function public.tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_lead boolean := public.is_dept_lead(old.department_id);
  v_meeting_editor boolean := old.meeting_id is not null and public.can_edit_meeting(old.meeting_id);
  v_in_project boolean := public.is_project_member(old.project_id);
  v_parent_editor boolean := old.parent_task_id is not null and public.can_edit_task(old.parent_task_id);
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

  -- Project members share the work; whoever runs the main task hands out its subtasks.
  if not v_is_lead and not v_meeting_editor and not v_in_project and not v_parent_editor
     and new.owner_id is distinct from old.owner_id
     and old.owner_id is not null
     and old.owner_id <> auth.uid() then
    raise exception 'Only a department admin can reassign a task someone else owns'
      using errcode = 'insufficient_privilege';
  end if;

  -- Private tasks stay with their owner until moved into a team or project.
  if new.department_id is null and new.project_id is null and new.parent_task_id is null
     and new.owner_id is distinct from auth.uid() then
    raise exception 'A personal task must belong to you'
      using errcode = 'insufficient_privilege';
  end if;

  if new.parent_task_id is not null
     and (new.department_id is not null or new.project_id is not null) then
    raise exception 'A subtask stays with its main task'
      using errcode = 'insufficient_privilege';
  end if;

  if new.project_id is distinct from old.project_id
     and new.project_id is not null
     and not public.is_project_member(new.project_id) then
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

-- Deleting a task deletes its subtasks.
create or replace function public.delete_task(p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_delete_task(p_task_id) then
    raise exception 'You do not have permission to delete this task'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('highfy.allow_soft_delete', 'on', true);
  update public.tasks
     set deleted_at = now(), deleted_by = auth.uid()
   where (id = p_task_id or parent_task_id = p_task_id) and deleted_at is null;
  perform set_config('highfy.allow_soft_delete', 'off', true);

  return true;
end;
$$;

notify pgrst, 'reload schema';
