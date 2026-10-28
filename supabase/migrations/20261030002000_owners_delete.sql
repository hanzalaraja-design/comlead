-- Deleting is for owners.
--
--  * A task: its owner (or, with no owner, whoever made it). A subtask: its
--    owner or the main task's owner.
--  * A project, campaign or partnership: its owners. Its tasks and meetings
--    are kept; they just stop being linked to it.
--  * A meeting: whoever set it up, or the team's admin.
-- Admins can still delete anything, so nothing gets stuck.

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
       and (public.is_admin()
            or (public.is_active_user()
                and (t.owner_id = auth.uid()
                     or (t.owner_id is null and t.created_by = auth.uid())
                     or (t.parent_task_id is not null and exists (
                           select 1 from public.tasks p
                            where p.id = t.parent_task_id and p.owner_id = auth.uid()))))));
$$;

create or replace function public.delete_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_project_owner(p_project_id) then
    raise exception 'Only its owners can delete it'
      using errcode = 'insufficient_privilege';
  end if;
  -- Tasks and meetings stay; the links to it go with it.
  delete from public.projects where id = p_project_id;
end;
$$;

revoke all on function public.delete_project(uuid) from public, anon;
grant execute on function public.delete_project(uuid) to authenticated;

drop policy if exists meetings_delete on public.meetings;
create policy meetings_delete on public.meetings
  for delete to authenticated
  using (public.is_dept_lead(department_id)
         or (public.is_active_user() and created_by = auth.uid()));

notify pgrst, 'reload schema';
