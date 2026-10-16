-- Computed field for the API: GET /tasks?select=*,overdue&overdue=is.true
-- Keeps the PKT "overdue" rule in one place (public.is_overdue).
create or replace function public.overdue(t public.tasks)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_overdue(t.due_date, t.due_time, t.status);
$$;

grant execute on function public.overdue(public.tasks) to authenticated;

-- Distinct tags the viewer can see, for the tag filter.
create or replace function public.visible_task_tags()
returns setof text
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct unnest(tags) as tag from public.tasks where deleted_at is null order by 1;
$$;

grant execute on function public.visible_task_tags() to authenticated;
