-- Anyone can give a task to anyone, and every task remembers who gave it.
--
--  * Whoever can edit a task can hand it to anyone (no admin needed).
--  * A task with no team or project given to someone else is a direct task:
--    the person it's for and whoever gave it can both see it.
--  * assigned_by / assigned_at are filled in automatically whenever the owner
--    changes.

alter table public.tasks
  add column assigned_by uuid references public.profiles (id) on delete set null,
  add column assigned_at timestamptz;

update public.tasks
   set assigned_by = created_by, assigned_at = created_at
 where owner_id is not null and assigned_by is null;

create or replace function public.tasks_set_assigned()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    if new.owner_id is null then
      new.assigned_by := null;
      new.assigned_at := null;
    else
      new.assigned_by := coalesce(auth.uid(), new.created_by);
      new.assigned_at := now();
    end if;
  elsif new.assigned_by is distinct from old.assigned_by or new.assigned_at is distinct from old.assigned_at then
    -- Only the trigger writes these.
    new.assigned_by := old.assigned_by;
    new.assigned_at := old.assigned_at;
  end if;
  return new;
end;
$$;

create trigger tasks_set_assigned
  before insert or update on public.tasks
  for each row execute function public.tasks_set_assigned();

-- Whoever created a task can always see it (a direct task they gave someone).
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
            or (public.is_active_user() and t.created_by = auth.uid())
            or public.is_project_member(t.project_id)
            or public.has_subtask_on(t.id)
            or (t.parent_task_id is not null and public.can_read_task(t.parent_task_id))));
$$;

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    deleted_at is null
    and (public.can_read_dept(department_id)
         or public.is_on_task(id)
         or public.is_project_member(project_id)
         or (public.is_active_user() and (owner_id = auth.uid() or created_by = auth.uid()))
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
        -- No team, no project: for yourself (private) or for anyone (direct).
        or (department_id is null and project_id is null and meeting_id is null and public.is_active_user())))));

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.can_edit_task(id))
  with check (
    deleted_at is null
    and (public.is_dept_member(department_id)
         or public.is_on_task(id)
         or (public.is_active_user() and created_by = auth.uid())
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

notify pgrst, 'reload schema';
