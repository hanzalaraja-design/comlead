-- More teams can be let into Placements (asked for by Omaima: Brand gets all of it).
--  * Design's own list can be opened to other teams too, like any tab.
--  * Paid social: other teams can see it and comment. Sending, planning,
--    approving and delivering stay with Commercial and Content.
--  * Editing the homepage layout: other teams besides Commercial.
-- Admins change all three in Admin > Placements.

alter table public.placement_settings
  add column if not exists paid_social_team_ids uuid[] not null default '{}',
  add column if not exists layout_team_ids uuid[] not null default '{}';

-- Brand, everywhere.
insert into public.placement_tab_teams (tab, department_id)
select t.tab, d.id
  from (values ('web'), ('social'), ('ads'), ('crm'), ('partnerships'), ('design')) as t(tab)
  join public.departments d on d.slug = 'brand' and not d.archived
on conflict do nothing;
update public.placement_settings s
   set paid_social_team_ids = (select array(select distinct unnest(s.paid_social_team_ids || array_agg(d.id))) from public.departments d where d.slug = 'brand' and not d.archived),
       layout_team_ids = (select array(select distinct unnest(s.layout_team_ids || array_agg(d.id))) from public.departments d where d.slug = 'brand' and not d.archived)
 where s.id = 1;

/** Is the signed-in person in one of these teams? */
create or replace function public.in_any_team(p_teams uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and exists (
    select 1 from public.department_members m where m.user_id = auth.uid() and m.department_id = any(coalesce(p_teams, '{}')));
$$;
revoke execute on function public.in_any_team(uuid[]) from public, anon;
grant execute on function public.in_any_team(uuid[]) to authenticated;

-- Design's list: the Design team, plus whoever the Admins let in.
create or replace function public.can_see_placement_tab(p_tab text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (public.is_active_user() and (
    public.in_placement_team('design')
    or (p_tab <> 'design' and public.in_placement_team('tech'))
    or exists (
      select 1 from public.placement_tab_teams tt
        join public.department_members m on m.department_id = tt.department_id and m.user_id = auth.uid()
       where tt.tab = p_tab)
    or exists (select 1 from public.placement_tab_people tp where tp.tab = p_tab and tp.user_id = auth.uid())));
$$;

-- Paid social: Commercial, Content, and the teams picked by an Admin.
create or replace function public.can_use_collabs()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.in_placement_team('commercial') or public.in_placement_team('content')
      or public.in_any_team((select paid_social_team_ids from public.placement_settings where id = 1));
$$;

-- Homepage layout: Commercial, and the teams picked by an Admin.
create or replace function public.can_edit_placement_layout()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.in_placement_team('commercial')
      or public.in_any_team((select layout_team_ids from public.placement_settings where id = 1));
$$;

notify pgrst, 'reload schema';
