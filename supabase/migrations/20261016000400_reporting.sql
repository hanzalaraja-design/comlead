-- Highfy Tasks: reporting helpers for the CEO dashboard.
-- All SECURITY INVOKER, so RLS still decides which rows are counted.

-- Overdue = due date (and time, if set) has passed and the task is not
-- Done or Cancelled. A task due today with no time becomes overdue tomorrow.
create or replace function public.is_overdue(p_due_date date, p_due_time time, p_status public.task_status)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status not in ('done', 'cancelled')
     and p_due_date is not null
     and (p_due_date < public.pkt_today()
          or (p_due_date = public.pkt_today()
              and p_due_time is not null
              and p_due_time < (now() at time zone 'Asia/Karachi')::time));
$$;

create or replace function public.dashboard_department_stats()
returns table (
  department_id uuid,
  name text,
  slug text,
  open_count bigint,
  overdue_count bigint,
  blocked_count bigint,
  completed_this_week bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.id, d.name, d.slug,
         count(t.id) filter (where t.status in ('todo', 'in_progress', 'blocked')),
         count(t.id) filter (where public.is_overdue(t.due_date, t.due_time, t.status)),
         count(t.id) filter (where t.status = 'blocked'),
         count(t.id) filter (where t.status = 'done' and t.completed_at >= public.pkt_week_start())
    from public.departments d
    left join public.tasks t on t.department_id = d.id and t.deleted_at is null
   where not d.archived
   group by d.id, d.name, d.slug, d.sort_order
   order by d.sort_order, d.name;
$$;

create or replace function public.dashboard_person_stats()
returns table (
  user_id uuid,
  full_name text,
  email text,
  open_count bigint,
  overdue_count bigint,
  completed_this_week bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.full_name, p.email,
         count(t.id) filter (where t.status in ('todo', 'in_progress', 'blocked')),
         count(t.id) filter (where public.is_overdue(t.due_date, t.due_time, t.status)),
         count(t.id) filter (where t.status = 'done' and t.completed_at >= public.pkt_week_start())
    from public.profiles p
    left join public.tasks t on t.owner_id = p.id and t.deleted_at is null
   where p.status = 'active'
   group by p.id, p.full_name, p.email
   order by count(t.id) filter (where public.is_overdue(t.due_date, t.due_time, t.status)) desc,
            coalesce(p.full_name, p.email);
$$;

-- One row per department for the current PKT week (Mon–Sun).
-- state: 'held' | 'no_minutes' | 'missing' | 'upcoming' | 'no_schedule'
create or replace function public.dashboard_meetings_this_week()
returns table (
  department_id uuid,
  name text,
  slug text,
  meeting_weekday smallint,
  meeting_time time,
  meeting_id uuid,
  meeting_date date,
  state text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with wk as (
    select (public.pkt_week_start() at time zone 'Asia/Karachi')::date as monday,
           public.pkt_today() as today
  ),
  latest as (
    select distinct on (m.department_id)
           m.department_id, m.id, m.meeting_date,
           nullif(trim(regexp_replace(coalesce(m.minutes, ''), '<[^>]+>', '', 'g')), '') is not null as has_minutes
      from public.meetings m, wk
     where m.meeting_date between wk.monday and wk.monday + 6
     order by m.department_id, m.meeting_date desc, m.created_at desc
  )
  select d.id, d.name, d.slug, d.meeting_weekday, d.meeting_time, l.id, l.meeting_date,
         case
           when l.id is not null and l.has_minutes then 'held'
           when l.id is not null then 'no_minutes'
           when d.meeting_weekday is null then 'no_schedule'
           when wk.monday + (d.meeting_weekday - 1) < wk.today then 'missing'
           else 'upcoming'
         end
    from public.departments d
    cross join wk
    left join latest l on l.department_id = d.id
   where not d.archived
   order by d.sort_order, d.name;
$$;

grant execute on function
  public.is_overdue(date, time, public.task_status),
  public.dashboard_department_stats(),
  public.dashboard_person_stats(),
  public.dashboard_meetings_this_week()
  to authenticated;
