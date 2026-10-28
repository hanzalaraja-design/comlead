-- Domains: projects, campaigns and partnerships are the same kind of thing
-- (a folder of tasks shared across teams), told apart by `kind`.
--
--  * Partnerships are sorted into beauty and non-beauty brands.
--  * Owners are picked (project_members.role = 'lead'), several allowed.
--  * Unlocked, everyone in it can change it; locked, only its owners (and
--    Admins) can. Task owners can always update their own tasks inside it.

alter table public.projects drop constraint if exists projects_kind_check;
alter table public.projects add constraint projects_kind_check check (kind in ('project', 'campaign', 'partnership'));

alter table public.projects
  add column category text check (category in ('beauty', 'non_beauty')),
  add column locked boolean not null default false;

-- 11.11 is a campaign.
update public.projects set kind = 'campaign' where kind = 'project' and name ~* '11[.]11';

-- Whoever started a project owns it, unless it already has owners.
insert into public.project_members (project_id, user_id, role)
select p.id, p.created_by, 'lead'
  from public.projects p
 where p.created_by is not null
   and not exists (select 1 from public.project_members m where m.project_id = p.id and m.role = 'lead')
on conflict (project_id, user_id) do update set role = 'lead';

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_project_id is not null and (
    public.is_admin()
    or (public.is_active_user() and exists (
          select 1 from public.project_members m
           where m.project_id = p_project_id and m.user_id = auth.uid() and m.role = 'lead')));
$$;

-- Change its details, teams and people: owners always; everyone in it while unlocked.
create or replace function public.can_manage_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_project_owner(p_project_id)
      or (public.is_project_member(p_project_id)
          and exists (select 1 from public.projects p where p.id = p_project_id and not p.locked));
$$;

-- The person who just started it can make themselves its first owner.
create or replace function public.can_claim_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and exists (
    select 1 from public.projects p
     where p.id = p_project_id
       and p.created_by = auth.uid()
       and not exists (select 1 from public.project_members m where m.project_id = p.id and m.role = 'lead'));
$$;

grant execute on function public.is_project_owner(uuid), public.can_claim_project(uuid) to authenticated;

-- Only owners lock and unlock.
create or replace function public.projects_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.locked is distinct from old.locked
     and not public.is_project_owner(old.id) then
    raise exception 'Only its owners can lock or unlock it'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_guard on public.projects;
create trigger projects_guard
  before update on public.projects
  for each row execute function public.projects_guard();

-- People: owners pick owners; anyone who can change it adds or removes members.
drop policy project_members_insert on public.project_members;
create policy project_members_insert on public.project_members
  for insert to authenticated
  with check (
    public.is_project_owner(project_id)
    or (role = 'lead' and user_id = auth.uid() and public.can_claim_project(project_id))
    or (role = 'member' and public.can_manage_project(project_id)));

drop policy project_members_update on public.project_members;
create policy project_members_update on public.project_members
  for update to authenticated
  using (public.is_project_owner(project_id));

drop policy project_members_delete on public.project_members;
create policy project_members_delete on public.project_members
  for delete to authenticated
  using (
    public.is_project_owner(project_id)
    or (role = 'member' and public.can_manage_project(project_id)));

-- Deleting a task inside a project: its owners (not every member).
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
            or public.is_project_owner(t.project_id)
            or (t.parent_task_id is not null and public.can_edit_task(t.parent_task_id))
            or (public.is_active_user() and t.created_by = auth.uid()
                and (t.owner_id is null or t.owner_id = auth.uid()))));
$$;

notify pgrst, 'reload schema';
