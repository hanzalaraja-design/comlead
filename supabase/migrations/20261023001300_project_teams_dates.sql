-- Projects: several teams instead of one, and a start / end date instead of
-- one launch date. projects.department_id and launch_date are kept (unused)
-- so the app keeps working between running this and deploying.

create table public.project_teams (
  project_id uuid not null references public.projects (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  primary key (project_id, department_id)
);
create index project_teams_department_idx on public.project_teams (department_id);

insert into public.project_teams (project_id, department_id)
select id, department_id from public.projects where department_id is not null
on conflict do nothing;

alter table public.projects add column start_date date, add column end_date date;
update public.projects set start_date = launch_date where launch_date is not null and start_date is null;
alter table public.projects add constraint projects_dates_check check (end_date is null or start_date is null or end_date >= start_date);

-- Everyone in any of the project's teams is in it.
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
      or exists (select 1 from public.project_teams t
                   join public.department_members d on d.department_id = t.department_id
                  where t.project_id = p_project_id and d.user_id = auth.uid())
      or exists (select 1 from public.projects p
                   join public.department_members d on d.department_id = p.department_id
                  where p.id = p_project_id and d.user_id = auth.uid()))));
$$;

-- The admins of any of its teams can manage it.
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
      or exists (select 1 from public.project_teams t
                  where t.project_id = p_project_id and public.is_dept_lead(t.department_id))
      or exists (select 1 from public.project_members m
                  where m.project_id = p_project_id and m.user_id = auth.uid() and m.role = 'lead'))));
$$;

-- Any team can be brought into a project, not just your own.
drop policy projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());

drop policy projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (public.can_manage_project(id));

alter table public.project_teams enable row level security;
grant select, insert, delete on public.project_teams to authenticated;

create policy project_teams_select on public.project_teams
  for select to authenticated
  using (public.is_project_member(project_id));

create policy project_teams_insert on public.project_teams
  for insert to authenticated
  with check (public.can_manage_project(project_id));

create policy project_teams_delete on public.project_teams
  for delete to authenticated
  using (public.can_manage_project(project_id));

-- Every team's name, so any team can be brought into a project
-- (the departments table only shows the teams you're in).
create or replace function public.team_directory()
returns table (id uuid, name text, slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.name, d.slug
    from public.departments d
   where public.is_active_user() and not d.archived and d.kind = 'department'
   order by d.sort_order, d.name;
$$;

-- Everyone in each project you can see: named people, its teams and whoever started it.
create or replace function public.project_people()
returns table (project_id uuid, user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, x.user_id
    from public.projects p
    cross join lateral (
      select m.user_id from public.project_members m where m.project_id = p.id
      union
      select d.user_id from public.project_teams t join public.department_members d on d.department_id = t.department_id where t.project_id = p.id
      union
      select p.created_by where p.created_by is not null
    ) x
   where public.is_project_member(p.id);
$$;

revoke execute on function public.team_directory(), public.project_people() from public, anon;
grant execute on function public.team_directory(), public.project_people() to authenticated;

notify pgrst, 'reload schema';
