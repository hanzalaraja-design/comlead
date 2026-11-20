-- Placements, round 3.
--
--  1. Who sees which tab. Design, Tech and Admins see every tab (Design's own
--     list stays Design's). Everyone else sees the tabs of their teams, plus
--     anything they asked for themselves. Anyone else can ask for access; the
--     lead of the team that owns the tab (or an Admin) gives it.
--  2. Commercial (and Admins) can move, add and hide homepage sections.
--     Hiding keeps a section's bookings and history; an Admin brings it back.

-- ---------------------------------------------------------------------------
-- 1. Tabs, and who sees them
-- ---------------------------------------------------------------------------

create table public.placement_tabs (
  key text primary key check (key in ('web', 'social', 'ads', 'crm', 'partnerships', 'design')),
  id uuid not null unique default gen_random_uuid(),
  label text not null,
  -- Its lead gives access when someone asks.
  owner_department_id uuid references public.departments (id) on delete set null,
  sort int not null default 0
);

create table public.placement_tab_teams (
  tab text not null references public.placement_tabs (key) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  primary key (tab, department_id)
);

create table public.placement_tab_people (
  tab text not null references public.placement_tabs (key) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  given_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tab, user_id)
);

insert into public.placement_tabs (key, label, owner_department_id, sort)
select t.key, t.label,
       case when t.key = 'design' then (select design_department_id from public.placement_settings where id = 1)
            else (select id from public.departments where slug = t.owner and not archived limit 1) end,
       t.sort
  from (values
    ('web', 'App / Website', 'commercial', 10),
    ('social', 'Social', 'marketing', 20),
    ('ads', 'Ads', 'marketing', 30),
    ('crm', 'CRM', 'marketing', 40),
    ('partnerships', 'Partnerships', 'brand', 50),
    ('design', 'Design', null, 60)) as t(key, label, owner, sort)
on conflict (key) do nothing;

-- The table agreed with Omaima. Design and Tech see everything anyway.
insert into public.placement_tab_teams (tab, department_id)
select t.tab, d.id
  from (values
    ('web', 'commercial'), ('web', 'marketing'), ('web', 'brand'),
    ('social', 'marketing'), ('social', 'content'), ('social', 'brand'),
    ('ads', 'marketing'),
    ('crm', 'marketing'), ('crm', 'brand'),
    ('partnerships', 'brand')) as t(tab, slug)
  join public.departments d on d.slug = t.slug and not d.archived
on conflict do nothing;

alter table public.placement_tabs enable row level security;
alter table public.placement_tab_teams enable row level security;
alter table public.placement_tab_people enable row level security;
revoke all on public.placement_tabs, public.placement_tab_teams, public.placement_tab_people from anon, authenticated;
grant select on public.placement_tabs, public.placement_tab_teams, public.placement_tab_people to authenticated;
grant insert, update, delete on public.placement_tab_teams to authenticated;
grant update (owner_department_id) on public.placement_tabs to authenticated;
grant delete on public.placement_tab_people to authenticated;

-- Names only, so everyone can see who to ask. Admins change who sees what.
create policy placement_tabs_select on public.placement_tabs for select to authenticated using (public.is_active_user());
create policy placement_tabs_admin on public.placement_tabs for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy placement_tab_teams_select on public.placement_tab_teams for select to authenticated using (public.is_active_user());
create policy placement_tab_teams_admin_insert on public.placement_tab_teams for insert to authenticated with check (public.is_admin());
create policy placement_tab_teams_admin_delete on public.placement_tab_teams for delete to authenticated using (public.is_admin());
create policy placement_tab_people_select on public.placement_tab_people for select to authenticated using (public.is_active_user());
-- People get in by asking (decide_access below); an Admin or the tab's lead can take them off.
create policy placement_tab_people_delete on public.placement_tab_people for delete to authenticated
  using (public.is_admin() or exists (
    select 1 from public.placement_tabs t
      join public.department_members m on m.department_id = t.owner_department_id and m.user_id = auth.uid() and m.role = 'lead'
     where t.key = tab));

/** Can the signed-in person see this Placements tab? */
create or replace function public.can_see_placement_tab(p_tab text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (public.is_active_user() and (
    case when p_tab = 'design' then public.in_placement_team('design')
         else public.in_placement_team('design') or public.in_placement_team('tech') end
    or exists (
      select 1 from public.placement_tab_teams tt
        join public.department_members m on m.department_id = tt.department_id and m.user_id = auth.uid()
       where tt.tab = p_tab)
    or exists (select 1 from public.placement_tab_people tp where tp.tab = p_tab and tp.user_id = auth.uid())));
$$;
revoke execute on function public.can_see_placement_tab(text) from public, anon;
grant execute on function public.can_see_placement_tab(text) to authenticated;

/** Every tab the signed-in person can see, in order. */
create or replace function public.my_placement_tabs()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.key order by t.sort), '{}') from public.placement_tabs t where public.can_see_placement_tab(t.key);
$$;
revoke execute on function public.my_placement_tabs() from public, anon;
grant execute on function public.my_placement_tabs() to authenticated;

-- Bookings: the App / Website tab, plus your own.
drop policy if exists placements_select on public.placements;
create policy placements_select on public.placements
  for select to authenticated
  using (public.can_see_placement_tab('web') or (public.is_active_user() and created_by = auth.uid()));
drop policy if exists placements_update on public.placements;
create policy placements_update on public.placements
  for update to authenticated
  using (public.can_use_placements() and (public.can_see_placement_tab('web') or created_by = auth.uid()))
  with check (public.can_use_placements() and (public.can_see_placement_tab('web') or created_by = auth.uid()));

-- Design requests: their tab, plus the ones you asked for or are designing.
drop policy if exists creative_requests_select on public.creative_requests;
create policy creative_requests_select on public.creative_requests
  for select to authenticated
  using (public.is_active_user() and (requested_by = auth.uid() or designer_id = auth.uid() or public.can_see_placement_tab(channel)));

-- Their comments follow the request.
drop policy if exists creative_request_comments_select on public.creative_request_comments;
create policy creative_request_comments_select on public.creative_request_comments
  for select to authenticated
  using (exists (select 1 from public.creative_requests r where r.id = request_id));
drop policy if exists creative_request_comments_insert on public.creative_request_comments;
create policy creative_request_comments_insert on public.creative_request_comments
  for insert to authenticated
  with check (public.is_active_user() and author_id = auth.uid() and exists (select 1 from public.creative_requests r where r.id = request_id));

-- ---------------------------------------------------------------------------
-- Asking for a tab: the same "Request access" as tasks and projects
-- ---------------------------------------------------------------------------

alter table public.access_requests drop constraint if exists access_requests_item_type_check;
alter table public.access_requests add constraint access_requests_item_type_check
  check (item_type in ('task', 'project', 'placement_tab'));

create or replace function public.can_decide_access(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (public.is_active_user() and case p_type
    when 'task' then exists (
      select 1 from public.tasks t
       where t.id = p_id and t.deleted_at is null
         and (t.owner_id = auth.uid() or (t.owner_id is null and t.created_by = auth.uid())))
    when 'project' then public.can_manage_project(p_id)
    when 'placement_tab' then exists (
      select 1 from public.placement_tabs pt
        join public.department_members m on m.department_id = pt.owner_department_id and m.user_id = auth.uid() and m.role = 'lead'
       where pt.id = p_id)
    else false end);
$$;

create or replace function public.access_deciders(p_type text, p_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(t.owner_id, t.created_by) from public.tasks t
   where p_type = 'task' and t.id = p_id and coalesce(t.owner_id, t.created_by) is not null
  union
  select m.user_id from public.project_members m where p_type = 'project' and m.project_id = p_id and m.role = 'lead'
  union
  select p.created_by from public.projects p where p_type = 'project' and p.id = p_id and p.created_by is not null
  union
  select m.user_id from public.placement_tabs pt
    join public.department_members m on m.department_id = pt.owner_department_id and m.role = 'lead'
    join public.profiles pr on pr.id = m.user_id and pr.status = 'active'
   where p_type = 'placement_tab' and pt.id = p_id;
$$;
revoke execute on function public.access_deciders(text, uuid) from public, anon, authenticated;

create or replace function public.access_info(p_type text, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v jsonb;
begin
  if not public.is_active_user() then return null; end if;
  if p_type = 'task' then
    if p_key !~* '^[0-9a-f-]{36}$' then return null; end if;
    select jsonb_build_object(
             'id', t.id,
             'title', t.title,
             'locked', t.locked,
             'owner', public.person_label(coalesce(t.owner_id, t.created_by)),
             'teams', coalesce((
               select jsonb_agg(distinct d.name)
                 from public.departments d
                where d.id = t.department_id
                   or d.id in (select tt.department_id from public.task_teams tt where tt.task_id = t.id)), '[]'::jsonb),
             'people', coalesce((
               select jsonb_agg(public.person_label(c.user_id))
                 from public.task_collaborators c where c.task_id = t.id), '[]'::jsonb),
             'project', (select p.name from public.projects p where p.id = t.project_id),
             'can_read', public.can_read_task(t.id)),
           t.id
      into v, v_id
      from public.tasks t
     where t.id = p_key::uuid and t.deleted_at is null;
  elsif p_type = 'project' then
    select jsonb_build_object(
             'id', p.id,
             'title', p.name,
             'kind', p.kind,
             'slug', p.slug,
             'locked', p.locked,
             'owner', coalesce((
               select string_agg(public.person_label(m.user_id), ', ')
                 from public.project_members m where m.project_id = p.id and m.role = 'lead'),
               public.person_label(p.created_by)),
             'teams', coalesce((
               select jsonb_agg(distinct d.name)
                 from public.departments d
                where d.id = p.department_id
                   or d.id in (select pt.department_id from public.project_teams pt where pt.project_id = p.id)), '[]'::jsonb),
             'people', coalesce((
               select jsonb_agg(public.person_label(m.user_id))
                 from public.project_members m where m.project_id = p.id and m.role = 'member'), '[]'::jsonb),
             'can_read', public.is_project_member(p.id) or p.created_by = auth.uid()),
           p.id
      into v, v_id
      from public.projects p
     where p.slug = p_key;
  elsif p_type = 'placement_tab' then
    select jsonb_build_object(
             'id', pt.id,
             'title', 'Placements · ' || pt.label,
             'kind', 'placement_tab',
             'slug', pt.key,
             'owner', (
               select string_agg(public.person_label(m.user_id), ', ')
                 from public.department_members m
                 join public.profiles pr on pr.id = m.user_id and pr.status = 'active'
                where m.department_id = pt.owner_department_id and m.role = 'lead'),
             'teams', coalesce((
               select jsonb_agg(d.name order by d.sort_order)
                 from public.departments d
                where d.id in (select tt.department_id from public.placement_tab_teams tt where tt.tab = pt.key)
                   or d.id in (select s.design_department_id from public.placement_settings s where s.id = 1)
                   or (pt.key <> 'design' and d.id in (select s.tech_department_id from public.placement_settings s where s.id = 1))), '[]'::jsonb),
             'people', coalesce((
               select jsonb_agg(public.person_label(tp.user_id))
                 from public.placement_tab_people tp where tp.tab = pt.key), '[]'::jsonb),
             'can_read', public.can_see_placement_tab(pt.key)),
           pt.id
      into v, v_id
      from public.placement_tabs pt
     where pt.key = p_key;
  else
    return null;
  end if;
  if v is null then return null; end if;
  return v || jsonb_build_object(
    'type', p_type,
    'asked', exists (
      select 1 from public.access_requests r
       where r.item_type = p_type and r.item_id = v_id and r.requested_by = auth.uid() and r.status = 'pending'));
end;
$$;

create or replace function public.decide_access(p_request uuid, p_give boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.access_requests;
  v_title text;
  v_href text;
begin
  select * into r from public.access_requests where id = p_request for update;
  if not found or not public.can_decide_access(r.item_type, r.item_id) then
    raise exception 'Only the owner can give access to this' using errcode = 'insufficient_privilege';
  end if;
  if r.status <> 'pending' then return; end if;

  if r.item_type = 'task' then
    select title, '/tasks/' || id into v_title, v_href from public.tasks where id = r.item_id;
    if p_give then
      insert into public.task_collaborators (task_id, user_id) values (r.item_id, r.requested_by) on conflict do nothing;
    end if;
  elsif r.item_type = 'placement_tab' then
    select 'Placements · ' || label, '/placements?tab=' || key into v_title, v_href from public.placement_tabs where id = r.item_id;
    if p_give then
      insert into public.placement_tab_people (tab, user_id, given_by)
      select key, r.requested_by, auth.uid() from public.placement_tabs where id = r.item_id
      on conflict do nothing;
    end if;
  else
    select name, '/' || kind || 's/' || slug into v_title, v_href from public.projects where id = r.item_id;
    if p_give then
      insert into public.project_members (project_id, user_id, role) values (r.item_id, r.requested_by, 'member') on conflict do nothing;
    end if;
  end if;

  update public.access_requests
     set status = case when p_give then 'given' else 'declined' end, decided_by = auth.uid(), decided_at = now()
   where id = r.id;

  perform public.notify(r.requested_by, 'access', auth.uid(),
    case when p_give then coalesce(public.person_label(auth.uid()), 'Someone') || ' gave you access to ' || v_title
         else coalesce(public.person_label(auth.uid()), 'Someone') || ' declined your request for ' || v_title end,
    null, case when p_give then v_href else '/notifications' end, case when r.item_type = 'task' then r.item_id end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Homepage sections: Commercial moves, adds and hides them
-- ---------------------------------------------------------------------------

-- Where new bookings in a section show by default.
alter table public.placement_sections add column if not exists shows_on text[] not null default '{web,app}';
alter table public.placement_sections drop constraint if exists placement_sections_shows_on_check;
alter table public.placement_sections add constraint placement_sections_shows_on_check
  check (cardinality(shows_on) between 1 and 2 and shows_on <@ array['web', 'app']);

create or replace function public.can_edit_placement_layout()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.in_placement_team('commercial');
$$;

/** Add a section at the bottom of the homepage. Returns its key. */
create or replace function public.add_placement_section(p_name text, p_kind text, p_slots integer, p_shows_on text[], p_size_hint text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if not public.can_edit_placement_layout() then
    raise exception 'Only Commercial can change the homepage layout' using errcode = 'insufficient_privilege';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'Give the section a name'; end if;
  v_key := left(trim(both '_' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '_', 'g')), 40);
  if v_key = '' then v_key := 'section'; end if;
  v_key := v_key || '_' || substr(md5(random()::text), 1, 6);
  insert into public.placement_sections (key, surface, name, kind, slots, labels, size_hint, sort, shows_on)
  values (v_key, 'web', trim(p_name), p_kind, p_slots, '{}', nullif(left(trim(coalesce(p_size_hint, '')), 80), ''),
          coalesce((select max(sort) from public.placement_sections where surface = 'web'), 0) + 10,
          coalesce(p_shows_on, '{web,app}'));
  return v_key;
end;
$$;

/** Put the shown sections in this order (keys from top to bottom). */
create or replace function public.order_placement_sections(p_keys text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_edit_placement_layout() then
    raise exception 'Only Commercial can change the homepage layout' using errcode = 'insufficient_privilege';
  end if;
  update public.placement_sections s
     set sort = k.n * 10
    from unnest(p_keys) with ordinality as k(key, n)
   where s.key = k.key and s.surface = 'web';
end;
$$;

/** Hide a section (its bookings and history stay), or bring it back. */
create or replace function public.hide_placement_section(p_key text, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_edit_placement_layout() then
    raise exception 'Only Commercial can change the homepage layout' using errcode = 'insufficient_privilege';
  end if;
  update public.placement_sections set archived = p_hidden where key = p_key;
  if not found then raise exception 'Section not found'; end if;
end;
$$;

revoke execute on function public.can_edit_placement_layout(), public.add_placement_section(text, text, integer, text[], text),
  public.order_placement_sections(text[]), public.hide_placement_section(text, boolean) from public, anon;
grant execute on function public.can_edit_placement_layout(), public.add_placement_section(text, text, integer, text[], text),
  public.order_placement_sections(text[]), public.hide_placement_section(text, boolean) to authenticated;

notify pgrst, 'reload schema';
