-- Journeys: a project split into separate journeys (First order, Road to
-- Highfy Fam, Highfy Fam, …), each with its own stage, fields, description,
-- tasks and comments. Uses the project parts added for partnership terms.
--
--  * projects.has_journeys turns it on (set for the Journeys project).
--  * A task can belong to one part of its project (a journey, or a term).
--    Tasks with none are the project's "Other tasks".
--  * Stages: Idea, Drafting, Design (the builder), Review (the reviewer),
--    then Approved / Live on Mergn (whoever puts it live). The three people
--    are set per project in journey_people; moving a journey on tells the
--    next person.
-- Nothing changes about who can see or edit the project or its tasks.

alter table public.projects
  add column if not exists has_journeys boolean not null default false,
  add column if not exists journey_people jsonb not null default '{}'::jsonb;

alter table public.tasks add column if not exists part_id uuid references public.project_parts (id) on delete set null;
create index if not exists tasks_part_idx on public.tasks (part_id) where part_id is not null;

-- A task's part must be a part of the task's own project.
create or replace function public.tasks_part_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.part_id is not null and not exists (
       select 1 from public.project_parts pp where pp.id = new.part_id and pp.project_id = new.project_id) then
    if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
      new.part_id := null; -- moved to another project: it leaves the journey
    else
      raise exception 'That journey is in another project' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger tasks_part_check before insert or update of part_id, project_id on public.tasks
  for each row execute function public.tasks_part_check();

-- The Journeys project, and who does what in it (matched by email or name;
-- an Admin can change these later).
update public.projects p
   set has_journeys = true,
       journey_people = jsonb_strip_nulls(jsonb_build_object(
         'build', (select id from public.profiles where lower(email) = 'omaima@highfy.pk' limit 1),
         'review', (select id from public.profiles where full_name ilike 'hanzala%' and status = 'active' order by created_at limit 1),
         'live', (select id from public.profiles where lower(email) = 'mehriyar@highfy.pk' limit 1)))
 where p.slug = 'journeys';

-- Tell the next person when a journey moves on.
create or replace function public.notify_journey_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.projects;
  v_to uuid;
  v_title text;
  v_href text;
begin
  if new.kind <> 'journey' or new.stage is not distinct from old.stage then return null; end if;
  select * into p from public.projects where id = new.project_id;
  v_href := '/' || p.kind || 's/' || p.slug || '?journey=' || new.id;
  if new.stage = 'review' then
    v_to := (p.journey_people ->> 'review')::uuid;
    v_title := new.name || ' is ready for your review';
  elsif new.stage = 'approved' then
    v_to := (p.journey_people ->> 'live')::uuid;
    v_title := new.name || ' is approved: put it live on Mergn';
  elsif old.stage = 'review' and new.stage in ('idea', 'drafting', 'design') then
    v_to := (p.journey_people ->> 'build')::uuid;
    v_title := new.name || ' was sent back to you';
  elsif new.stage = 'live' then
    v_to := (p.journey_people ->> 'build')::uuid;
    v_title := new.name || ' is live on Mergn';
  end if;
  if v_to is not null then
    perform public.notify(v_to, 'project_task', auth.uid(), v_title, null, v_href, null);
  end if;
  return null;
end;
$$;
create trigger project_parts_journey_notify after update of stage on public.project_parts
  for each row execute function public.notify_journey_stage();

-- Seed the three journeys the Journeys project already works on (only if it has none yet).
insert into public.project_parts (project_id, kind, name, stage, sort, fields, created_by)
select p.id, 'journey', j.name, 'drafting', j.sort,
       jsonb_build_array(jsonb_build_object('label', 'Who enters', 'value', j.who),
                         jsonb_build_object('label', 'Goal', 'value', ''),
                         jsonb_build_object('label', 'Leaves when', 'value', ''),
                         jsonb_build_object('label', 'Offer', 'value', '')),
       p.created_by
  from public.projects p
 cross join (values ('First order', 10, 'Signed up, no order yet'),
                    ('Road to Highfy Fam', 20, 'Ordered once or twice'),
                    ('Highfy Fam', 30, 'Loyalty members')) j(name, sort, who)
 where p.slug = 'journeys'
   and not exists (select 1 from public.project_parts x where x.project_id = p.id and x.kind = 'journey');

notify pgrst, 'reload schema';
