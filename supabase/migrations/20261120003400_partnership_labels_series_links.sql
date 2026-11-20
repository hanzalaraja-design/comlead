-- 1. A brand partnership can be in more than one category, picked together
--    with its tags in one list (like a Notion multi-select). Anyone in the
--    partnership can set them.
-- 2. A meeting can be linked to projects, campaigns and partnerships when it's
--    set up (one-off or recurring).
-- Who can see or open things doesn't change.

-- ---------------------------------------------------------------------------
-- 1. Several categories
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists categories text[] not null default '{}'
  check (categories <@ array['associations', 'referral', 'fintech']::text[]);
update public.projects set categories = array[category] where category is not null and categories = '{}';

-- Keep the old single category (the first one) in step, for anything that still reads it.
create or replace function public.projects_categories_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.categories = '{}' and new.category is not null then
      new.categories := array[new.category];
    end if;
    new.category := new.categories[1];
  elsif new.categories is distinct from old.categories then
    new.category := new.categories[1];
  elsif new.category is distinct from old.category then
    new.categories := case when new.category is null then '{}'::text[] else array[new.category] end;
  end if;
  return new;
end;
$$;
create trigger projects_categories_sync before insert or update on public.projects
  for each row execute function public.projects_categories_sync();

/** Set a partnership's categories and tags in one go. Anyone in it can. */
create or replace function public.set_partnership_labels(p_project uuid, p_categories text[], p_tags uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_project_member(p_project) then
    raise exception 'Only the people in this partnership can change its categories and tags' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.projects where id = p_project and kind = 'partnership') then
    raise exception 'Not a brand partnership' using errcode = 'check_violation';
  end if;
  update public.projects
     set categories = (select coalesce(array_agg(distinct c order by c), '{}') from unnest(coalesce(p_categories, '{}')) c)
   where id = p_project;
  delete from public.project_tags where project_id = p_project and not (tag_id = any (coalesce(p_tags, '{}')));
  insert into public.project_tags (project_id, tag_id)
  select p_project, t from unnest(coalesce(p_tags, '{}')) t
   where exists (select 1 from public.partnership_tags pt where pt.id = t)
  on conflict do nothing;
end;
$$;

drop function if exists public.partnership_directory();
create function public.partnership_directory()
returns table (id uuid, name text, slug text, category text, categories text[], archived boolean, locked boolean, owner text, can_open boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.slug, p.category, p.categories, p.archived, p.locked,
         coalesce((select string_agg(public.person_label(m.user_id), ', ' order by m.added_at)
                     from public.project_members m where m.project_id = p.id and m.role = 'lead'),
                  public.person_label(p.created_by)),
         public.is_project_member(p.id) or p.created_by = auth.uid()
    from public.projects p
   where p.kind = 'partnership' and public.is_active_user()
   order by p.archived, p.name;
$$;

-- ---------------------------------------------------------------------------
-- 2. Link a meeting (and its whole series) when it's set up
-- ---------------------------------------------------------------------------

/**
 * Make a meeting's links exactly these projects. For a recurring meeting this
 * covers every meeting from today on; past ones keep their links. Whoever can
 * manage the meeting can; adding needs being in that project, as before.
 */
create or replace function public.set_series_projects(p_series uuid, p_projects uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_project uuid;
begin
  if not public.can_manage_series(p_series) then
    raise exception 'Only whoever set the meeting up, or a team admin, can change what it''s linked to' using errcode = 'insufficient_privilege';
  end if;
  foreach v_project in array coalesce(p_projects, '{}') loop
    if not exists (select 1 from public.meeting_series_projects where series_id = p_series and project_id = v_project)
       and not public.is_project_member(v_project) then
      raise exception 'You can only link projects you''re in' using errcode = 'insufficient_privilege';
    end if;
  end loop;

  -- Removed: from the series and from today's and future meetings.
  delete from public.meeting_projects mp using public.meetings m, public.meeting_series_projects sp
   where mp.meeting_id = m.id and m.series_id = p_series and m.meeting_date >= v_today
     and sp.series_id = p_series and sp.project_id = mp.project_id
     and not (mp.project_id = any (coalesce(p_projects, '{}')));
  delete from public.meeting_series_projects where series_id = p_series and not (project_id = any (coalesce(p_projects, '{}')));

  -- Added: to the series (new meetings pick it up) and to meetings already made from today on.
  insert into public.meeting_series_projects (series_id, project_id)
  select p_series, p from unnest(coalesce(p_projects, '{}')) p on conflict do nothing;
  insert into public.meeting_projects (meeting_id, project_id)
  select m.id, p from public.meetings m cross join unnest(coalesce(p_projects, '{}')) p
   where m.series_id = p_series and m.meeting_date >= v_today
  on conflict do nothing;
end;
$$;

revoke execute on function public.set_partnership_labels(uuid, text[], uuid[]), public.set_series_projects(uuid, uuid[]),
  public.partnership_directory() from public, anon;
grant execute on function public.set_partnership_labels(uuid, text[], uuid[]), public.set_series_projects(uuid, uuid[]),
  public.partnership_directory() to authenticated;

notify pgrst, 'reload schema';
