-- Tasks in several teams, meetings linked to projects/campaigns/partnerships,
-- and a lock on a task so only its owner can change it.

-- ---------------------------------------------------------------------------
-- 1. More teams on a task: it shows in each team's list.
-- ---------------------------------------------------------------------------

create table public.task_teams (
  task_id uuid not null references public.tasks (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  primary key (task_id, department_id)
);
create index task_teams_department_idx on public.task_teams (department_id);

create or replace function public.in_task_team(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and exists (
    select 1 from public.task_teams tt
      join public.department_members m on m.department_id = tt.department_id
     where tt.task_id = p_task_id and m.user_id = auth.uid());
$$;

-- Admins of any of its extra teams count as its team admins.
create or replace function public.leads_task_team(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and exists (
    select 1 from public.task_teams tt
      join public.department_members m on m.department_id = tt.department_id
     where tt.task_id = p_task_id and m.user_id = auth.uid() and m.role = 'lead');
$$;

grant execute on function public.in_task_team(uuid), public.leads_task_team(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Lock: only the owner (and Admins) can change a locked task.
-- ---------------------------------------------------------------------------

alter table public.tasks add column locked boolean not null default false;

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
            or public.in_task_team(t.id)
            or public.is_on_task(t.id)
            or (public.is_active_user() and t.created_by = auth.uid())
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
       and (not t.locked or public.is_admin() or (public.is_active_user() and t.owner_id = auth.uid()))
       and (public.is_dept_lead(t.department_id)
            or public.leads_task_team(t.id)
            or (public.is_active_user() and t.created_by = auth.uid())
            or public.is_on_task(t.id)
            or (t.meeting_id is not null and public.can_edit_meeting(t.meeting_id))
            or public.is_project_member(t.project_id)
            or (t.parent_task_id is not null and public.can_edit_task(t.parent_task_id))));
$$;

-- Comment and attach: members of its extra teams too.
create or replace function public.can_contribute_task(p_task_id uuid)
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
       and (public.is_dept_member(t.department_id)
            or public.in_task_team(t.id)
            or public.is_on_task(t.id)
            or public.is_project_member(t.project_id)));
$$;

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    deleted_at is null
    and (public.can_read_dept(department_id)
         or public.in_task_team(id)
         or public.is_on_task(id)
         or public.is_project_member(project_id)
         or (public.is_active_user() and (owner_id = auth.uid() or created_by = auth.uid()))
         or public.has_subtask_on(id)
         or (parent_task_id is not null and public.can_read_task(parent_task_id))));

-- Only the owner (or an Admin) locks and unlocks.
create or replace function public.tasks_lock_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.locked is distinct from old.locked
     and not (public.is_admin() or old.owner_id = auth.uid()) then
    raise exception 'Only the task''s owner can lock or unlock it'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger tasks_lock_guard
  before update on public.tasks
  for each row execute function public.tasks_lock_guard();

alter table public.task_teams enable row level security;
grant select, insert, delete on public.task_teams to authenticated;

create policy task_teams_select on public.task_teams
  for select to authenticated
  using (public.can_read_task(task_id));

create policy task_teams_insert on public.task_teams
  for insert to authenticated
  with check (public.can_edit_task(task_id));

create policy task_teams_delete on public.task_teams
  for delete to authenticated
  using (public.can_edit_task(task_id));

-- ---------------------------------------------------------------------------
-- 3. Meetings linked to projects, campaigns and partnerships.
-- ---------------------------------------------------------------------------

create table public.meeting_projects (
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  primary key (meeting_id, project_id)
);
create index meeting_projects_project_idx on public.meeting_projects (project_id);

alter table public.meeting_projects enable row level security;
grant select, insert, delete on public.meeting_projects to authenticated;

-- Seen by anyone who can see the meeting (the meetings policy decides) or is in the project.
create policy meeting_projects_select on public.meeting_projects
  for select to authenticated
  using (
    public.is_project_member(project_id)
    or exists (select 1 from public.meetings m where m.id = meeting_id));

create policy meeting_projects_insert on public.meeting_projects
  for insert to authenticated
  with check (public.can_edit_meeting(meeting_id) and public.is_project_member(project_id));

create policy meeting_projects_delete on public.meeting_projects
  for delete to authenticated
  using (public.can_edit_meeting(meeting_id));

-- Action items from a linked meeting land in its project too (when you're in it).
create or replace function public.tasks_from_linked_meeting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_project uuid;
begin
  if new.meeting_id is not null and new.project_id is null and new.parent_task_id is null then
    select mp.project_id into v_project
      from public.meeting_projects mp
     where mp.meeting_id = new.meeting_id
       and public.is_project_member(mp.project_id)
     order by mp.project_id
     limit 1;
    new.project_id := v_project;
  end if;
  return new;
end;
$$;

create trigger tasks_from_linked_meeting
  before insert on public.tasks
  for each row execute function public.tasks_from_linked_meeting();

notify pgrst, 'reload schema';
