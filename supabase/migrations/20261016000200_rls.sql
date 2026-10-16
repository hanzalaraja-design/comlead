-- Highfy Tasks: access rules
--
-- Admin   : everything.
-- Lead    : full control of the departments they lead; read-only on all
--           other departments' tasks and meetings.
-- Member  : only the departments they belong to. No access at all to other
--           departments' tasks or meetings.
--
-- Every rule first requires an active Highfy user (JWT email ends in
-- @highfy.pk and the profile is active). Pending users see only their own
-- profile.

-- ---------------------------------------------------------------------------
-- Helper functions
-- SECURITY DEFINER so they can read membership tables without tripping over
-- those tables' own policies (which would otherwise recurse).
-- ---------------------------------------------------------------------------

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(lower(auth.jwt() ->> 'email') like '%@highfy.pk', false)
     and exists (
       select 1 from public.profiles p
        where p.id = auth.uid()
          and p.status = 'active'
     );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user()
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin);
$$;

-- Member or lead of the department (or Admin).
create or replace function public.is_dept_member(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or (public.is_active_user() and exists (
            select 1 from public.department_members m
             where m.department_id = p_department_id
               and m.user_id = auth.uid()));
$$;

-- Lead of the department (or Admin).
create or replace function public.is_dept_lead(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or (public.is_active_user() and exists (
            select 1 from public.department_members m
             where m.department_id = p_department_id
               and m.user_id = auth.uid()
               and m.role = 'lead'));
$$;

-- Leads anywhere get read-only access to every department.
create or replace function public.is_any_lead()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and exists (
    select 1 from public.department_members m
     where m.user_id = auth.uid() and m.role = 'lead');
$$;

create or replace function public.can_read_dept(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_dept_member(p_department_id) or public.is_any_lead();
$$;

-- People directly on a task (owner or collaborator) can always see it,
-- even if it sits in a department they are not in.
create or replace function public.is_on_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and (
    exists (select 1 from public.tasks t where t.id = p_task_id and t.owner_id = auth.uid())
    or exists (select 1 from public.task_collaborators c where c.task_id = p_task_id and c.user_id = auth.uid()));
$$;

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
       and (public.can_read_dept(t.department_id) or public.is_on_task(t.id)));
$$;

-- Comment, attach files, or edit (subject to edit rules): department
-- members, plus the owner/collaborators.
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
       and (public.is_dept_member(t.department_id) or public.is_on_task(t.id)));
$$;

-- Edit a task: leads of its department, or its owner / collaborators /
-- creator.
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
            or public.is_on_task(t.id)));
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
            or (public.is_active_user() and t.created_by = auth.uid()
                and (t.owner_id is null or t.owner_id = auth.uid()))));
$$;

grant execute on function
  public.is_active_user(), public.is_admin(), public.is_dept_member(uuid),
  public.is_dept_lead(uuid), public.is_any_lead(), public.can_read_dept(uuid),
  public.is_on_task(uuid), public.can_read_task(uuid), public.can_contribute_task(uuid),
  public.can_edit_task(uuid), public.can_delete_task(uuid), public.pkt_today(),
  public.pkt_week_start()
  to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.sub_teams enable row level security;
alter table public.department_members enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_attendees enable row level security;
alter table public.tasks enable row level security;
alter table public.task_collaborators enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_attachments enable row level security;
alter table public.saved_views enable row level security;

-- Anonymous visitors get nothing.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- profiles
-- Active users can see the company directory (needed to pick owners and
-- attendees). Pending users see only themselves. Only Admin edits.
-- ---------------------------------------------------------------------------

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_active_user());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- departments / sub_teams
-- ---------------------------------------------------------------------------

create policy departments_select on public.departments
  for select to authenticated
  using (public.can_read_dept(id));

create policy departments_insert_admin on public.departments
  for insert to authenticated
  with check (public.is_admin());

-- Leads may update their department, but only the meeting schedule
-- (enforced by departments_guard below).
create policy departments_update on public.departments
  for update to authenticated
  using (public.is_dept_lead(id))
  with check (public.is_dept_lead(id));

create or replace function public.departments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_admin() and (
       new.name is distinct from old.name
    or new.slug is distinct from old.slug
    or new.archived is distinct from old.archived
    or new.sort_order is distinct from old.sort_order) then
    raise exception 'Only Admin can rename, archive or reorder departments'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger departments_guard
  before update on public.departments
  for each row execute function public.departments_guard();

create policy sub_teams_select on public.sub_teams
  for select to authenticated
  using (public.can_read_dept(department_id));

create policy sub_teams_insert_admin on public.sub_teams
  for insert to authenticated
  with check (public.is_admin());

create policy sub_teams_update_admin on public.sub_teams
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- department_members
-- Admin manages everything. Leads add/remove Members in their department
-- (not other Leads). Role changes are Admin only.
-- ---------------------------------------------------------------------------

create policy department_members_select on public.department_members
  for select to authenticated
  using (user_id = auth.uid() or public.can_read_dept(department_id));

create policy department_members_insert on public.department_members
  for insert to authenticated
  with check (public.is_admin() or (public.is_dept_lead(department_id) and role = 'member'));

create policy department_members_update_admin on public.department_members
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy department_members_delete on public.department_members
  for delete to authenticated
  using (public.is_admin() or (public.is_dept_lead(department_id) and role = 'member'));

-- ---------------------------------------------------------------------------
-- meetings / meeting_attendees
-- Read: anyone who can read the department. Write: Leads (and Admin).
-- ---------------------------------------------------------------------------

create policy meetings_select on public.meetings
  for select to authenticated
  using (public.can_read_dept(department_id));

create policy meetings_insert on public.meetings
  for insert to authenticated
  with check (public.is_dept_lead(department_id) and created_by = auth.uid());

create policy meetings_update on public.meetings
  for update to authenticated
  using (public.is_dept_lead(department_id))
  with check (public.is_dept_lead(department_id));

create policy meetings_delete on public.meetings
  for delete to authenticated
  using (public.is_dept_lead(department_id));

create or replace function public.meeting_department(p_meeting_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select department_id from public.meetings where id = p_meeting_id;
$$;

grant execute on function public.meeting_department(uuid) to authenticated;

create policy meeting_attendees_select on public.meeting_attendees
  for select to authenticated
  using (public.can_read_dept(public.meeting_department(meeting_id)));

create policy meeting_attendees_insert on public.meeting_attendees
  for insert to authenticated
  with check (public.is_dept_lead(public.meeting_department(meeting_id)));

create policy meeting_attendees_delete on public.meeting_attendees
  for delete to authenticated
  using (public.is_dept_lead(public.meeting_department(meeting_id)));

-- ---------------------------------------------------------------------------
-- tasks
-- Deletes are soft (deleted_at) and go through public.delete_task().
-- ---------------------------------------------------------------------------

create policy tasks_select on public.tasks
  for select to authenticated
  using (
    deleted_at is null
    and (public.can_read_dept(department_id) or public.is_on_task(id)));

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    public.is_dept_member(department_id)
    and created_by = auth.uid()
    and deleted_at is null
    -- Action items can only be attached to a meeting of the same department.
    and (meeting_id is null or public.meeting_department(meeting_id) = department_id));

create policy tasks_update on public.tasks
  for update to authenticated
  using (public.can_edit_task(id))
  with check (
    deleted_at is null
    and (public.is_dept_member(department_id) or public.is_on_task(id)));

-- Rules that RLS cannot express on its own:
--  * only Leads/Admin reassign a task someone else owns
--  * only Leads/Admin move a task to another department (and only into a
--    department they belong to, checked by the policy above)
--  * created_by / source / created_at never change
create or replace function public.tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_lead boolean := public.is_dept_lead(old.department_id);
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

  if not v_is_lead then
    if new.owner_id is distinct from old.owner_id
       and old.owner_id is not null
       and old.owner_id <> auth.uid() then
      raise exception 'Only a department Lead can reassign a task someone else owns'
        using errcode = 'insufficient_privilege';
    end if;

    if new.department_id is distinct from old.department_id then
      raise exception 'Only a department Lead can move a task to another department'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger tasks_guard
  before update on public.tasks
  for each row execute function public.tasks_guard();

-- Soft delete. Returns true if the task was deleted.
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
   where id = p_task_id and deleted_at is null;
  perform set_config('highfy.allow_soft_delete', 'off', true);

  return found;
end;
$$;

revoke execute on function public.delete_task(uuid) from public, anon;
grant execute on function public.delete_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- task_collaborators / comments / attachments
-- ---------------------------------------------------------------------------

create policy task_collaborators_select on public.task_collaborators
  for select to authenticated
  using (public.can_read_task(task_id));

create policy task_collaborators_insert on public.task_collaborators
  for insert to authenticated
  with check (public.can_edit_task(task_id));

create policy task_collaborators_delete on public.task_collaborators
  for delete to authenticated
  using (public.can_edit_task(task_id));

create policy task_comments_select on public.task_comments
  for select to authenticated
  using (public.can_read_task(task_id));

create policy task_comments_insert on public.task_comments
  for insert to authenticated
  with check (public.can_contribute_task(task_id) and author_id = auth.uid());

create policy task_comments_delete_own on public.task_comments
  for delete to authenticated
  using (author_id = auth.uid() and public.is_active_user());

create policy task_attachments_select on public.task_attachments
  for select to authenticated
  using (public.can_read_task(task_id));

create policy task_attachments_insert on public.task_attachments
  for insert to authenticated
  with check (public.can_contribute_task(task_id) and uploaded_by = auth.uid());

create policy task_attachments_delete on public.task_attachments
  for delete to authenticated
  using (
    public.can_read_task(task_id)
    and (uploaded_by = auth.uid() or public.can_delete_task(task_id)));

-- ---------------------------------------------------------------------------
-- saved_views: private to each user
-- ---------------------------------------------------------------------------

create policy saved_views_all_own on public.saved_views
  for all to authenticated
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid() and public.is_active_user());

-- ---------------------------------------------------------------------------
-- Storage: private bucket for task attachments, files under "<task_id>/"
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('task-attachments', 'task-attachments', false, 26214400) -- 25 MB
on conflict (id) do nothing;

-- Returns null instead of raising when the first folder is not a uuid.
create or replace function public.attachment_task_id(p_object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_object_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

grant execute on function public.attachment_task_id(text) to authenticated;

create policy task_attachments_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'task-attachments'
         and public.can_read_task(public.attachment_task_id(name)));

create policy task_attachments_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-attachments'
              and public.can_contribute_task(public.attachment_task_id(name)));

create policy task_attachments_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'task-attachments'
         and public.can_read_task(public.attachment_task_id(name))
         and (owner_id = auth.uid()::text or public.can_delete_task(public.attachment_task_id(name))));
