-- A task in a project, campaign or partnership (with no team) can be linked
-- to a meeting. Before, the database only allowed meeting links on team tasks,
-- so linking such a task said "Some values aren't valid". Personal tasks (no
-- team, no project) still can't be meeting items.

alter table public.tasks drop constraint if exists tasks_personal_shape;
alter table public.tasks add constraint tasks_personal_shape
  check (department_id is not null or (sub_team_id is null and (meeting_id is null or project_id is not null)));

notify pgrst, 'reload schema';
