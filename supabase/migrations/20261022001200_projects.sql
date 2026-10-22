-- Projects: a folder of tasks that people from any team can share
-- ("My Zong App", the 11.11 campaign). A project can belong to a team (its
-- members are all in it) and/or list people by name.
--
-- Members see the project's tasks, add tasks and edit them. Whoever created
-- the project, the home team's admins, project leads and Admins manage it.
-- Project teams (departments of kind 'project') become projects.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  description text check (length(description) <= 2000),
  kind text not null default 'project' check (kind in ('project', 'campaign')),
  launch_date date,
  -- Home team: everyone in it is in the project.
  department_id uuid references public.departments (id) on delete set null,
  archived boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_department_idx on public.projects (department_id);

create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('lead', 'member')),
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

alter table public.tasks add column project_id uuid references public.projects (id) on delete set null;
create index tasks_project_idx on public.tasks (project_id, status) where project_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. Who's in, who manages
-- ---------------------------------------------------------------------------

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_project_id is not null and (
    public.is_admin()
    or (public.is_active_user() and (
      exists (select 1 from public.project_members m where m.project_id = p_project_id and m.user_id = auth.uid())
      or exists (select 1 from public.projects p
                  where p.id = p_project_id and p.created_by = auth.uid())
      or exists (select 1 from public.projects p
                   join public.department_members d on d.department_id = p.department_id
                  where p.id = p_project_id and d.user_id = auth.uid()))));
$$;

create or replace function public.can_manage_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_project_id is not null and (
    public.is_admin()
    or (public.is_active_user() and (
      exists (select 1 from public.projects p
               where p.id = p_project_id
                 and (p.created_by = auth.uid() or public.is_dept_lead(p.department_id)))
      or exists (select 1 from public.project_members m
                  where m.project_id = p_project_id and m.user_id = auth.uid() and m.role = 'lead'))));
$$;

grant execute on function public.is_project_member(uuid), public.can_manage_project(uuid) to authenticated;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
grant select, insert, update on public.projects to authenticated;
grant select, insert, update, delete on public.project_members to authenticated;

create policy projects_select on public.projects
  for select to authenticated
  using (public.is_project_member(id) or (created_by = auth.uid() and public.is_active_user()));

-- Anyone can start a project, for a team they're in or across teams.
create policy projects_insert on public.projects
  for insert to authenticated
  with check (
    public.is_active_user()
    and created_by = auth.uid()
    and (department_id is null or public.is_dept_member(department_id)));

create policy projects_update on public.projects
  for update to authenticated
  using (public.can_manage_project(id))
  with check (department_id is null or public.is_dept_member(department_id) or public.is_admin());

create policy project_members_select on public.project_members
  for select to authenticated
  using (public.is_project_member(project_id));

create policy project_members_insert on public.project_members
  for insert to authenticated
  with check (public.can_manage_project(project_id));

create policy project_members_update on public.project_members
  for update to authenticated
  using (public.can_manage_project(project_id));

create policy project_members_delete on public.project_members
  for delete to authenticated
  using (public.can_manage_project(project_id));

-- ---------------------------------------------------------------------------
-- 3. Tasks in projects
-- ---------------------------------------------------------------------------

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
            or public.is_project_member(t.project_id)));
$$;

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
            or public.is_on_task(t.id)
            or public.is_project_member(t.project_id)));
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
            or public.is_project_member(t.project_id)));
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
         or (department_id is null and owner_id = auth.uid() and public.is_active_user())));

drop policy tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and deleted_at is null
    -- Only into projects you're in.
    and (project_id is null or public.is_project_member(project_id))
    and (
      (public.is_dept_member(department_id)
       and (meeting_id is null or public.meeting_department(meeting_id) = department_id))
      or (meeting_id is not null
          and public.meeting_department(meeting_id) = department_id
          and public.can_edit_meeting(meeting_id))
      -- Project task with no team: for anyone.
      or (department_id is null and project_id is not null and meeting_id is null)
      -- Private task: mine, no team, no project.
      or (department_id is null and project_id is null and public.is_active_user() and owner_id = auth.uid())));

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.can_edit_task(id))
  with check (
    deleted_at is null
    and (public.is_dept_member(department_id)
         or public.is_on_task(id)
         or public.is_project_member(project_id)
         or (meeting_id is not null and public.can_edit_meeting(meeting_id))));

create or replace function public.tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_lead boolean := public.is_dept_lead(old.department_id);
  v_meeting_editor boolean := old.meeting_id is not null and public.can_edit_meeting(old.meeting_id);
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

  -- Project members share the work, so they can hand tasks to each other.
  if not v_is_lead and not v_meeting_editor and not v_in_project
     and new.owner_id is distinct from old.owner_id
     and old.owner_id is not null
     and old.owner_id <> auth.uid() then
    raise exception 'Only a department admin can reassign a task someone else owns'
      using errcode = 'insufficient_privilege';
  end if;

  -- Private tasks stay with their owner until moved into a team or project.
  if new.department_id is null and new.project_id is null and new.owner_id is distinct from auth.uid() then
    raise exception 'A personal task must belong to you'
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
     -- A project task can leave its team and stay in the project.
     and not (new.department_id is null and new.project_id is not null and v_in_project) then
    raise exception 'Only a department admin can move a task to another department'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Project teams become projects
-- Each keeps its team (meetings still hang off it); its tasks go in the project.
-- ---------------------------------------------------------------------------

insert into public.projects (name, slug, department_id, created_by)
select d.name, d.slug, d.id, null
  from public.departments d
 where d.kind = 'project' and not d.archived
on conflict (slug) do nothing;

update public.tasks t
   set project_id = p.id
  from public.projects p
 where p.department_id = t.department_id
   and t.project_id is null
   and exists (select 1 from public.departments d where d.id = p.department_id and d.kind = 'project');

notify pgrst, 'reload schema';
