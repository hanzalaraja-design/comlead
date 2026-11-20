-- Record changes to tasks in a project, campaign or partnership even when they
-- have no team. Before, every task without a team was left out of the
-- activity log (to keep personal tasks private), so these tasks had no
-- history, no "Deadline extended" line and no +N.
-- Personal tasks (no team and no project) are still left out. A task's
-- history is only shown to people who can open the task.

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
  select
    auth.uid(), p_action, p_entity_type, p_entity_id, p_entity_label, p_department_id,
    p_task_id, p_meeting_id, p_subject_user_id, p_old, p_new
  where p_task_id is null
     or not exists (select 1 from public.tasks t where t.id = p_task_id and t.department_id is null and t.project_id is null);
$$;

revoke execute on function public.log_activity(text, text, uuid, text, uuid, uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
