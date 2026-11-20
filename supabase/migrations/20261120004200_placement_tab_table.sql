-- Who sees which Placements tab, as Omaima set it on 20 Nov:
--   App / Website: Design, Commercial, SEO, Tech, Brand
--   Social:        Content, Marketing, Design, Brand
--   Ads, CRM:      Marketing, Content, Design, Brand
--   Partnerships:  Design, Brand
-- Tech no longer sees every tab automatically; it's listed where it belongs.
-- Design (and Admins) still see everything. Admins can change the teams in
-- Admin > Placements. Safe to run twice.

create or replace function public.can_see_placement_tab(p_tab text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (public.is_active_user() and (
    public.in_placement_team('design')
    or exists (
      select 1 from public.placement_tab_teams tt
        join public.department_members m on m.department_id = tt.department_id and m.user_id = auth.uid()
       where tt.tab = p_tab)
    or exists (select 1 from public.placement_tab_people tp where tp.tab = p_tab and tp.user_id = auth.uid())));
$$;

-- The table above. A team is found by its name or short name, or (Design,
-- Tech, Commercial, Content) by the team picked in Admin > Placements.
delete from public.placement_tab_teams where tab in ('web', 'social', 'ads', 'crm', 'partnerships');
insert into public.placement_tab_teams (tab, department_id)
select distinct t.tab, d.id
  from (values
    ('web', 'design'), ('web', 'commercial'), ('web', 'seo'), ('web', 'tech'), ('web', 'brand'),
    ('social', 'content'), ('social', 'marketing'), ('social', 'design'), ('social', 'brand'),
    ('ads', 'marketing'), ('ads', 'content'), ('ads', 'design'), ('ads', 'brand'),
    ('crm', 'marketing'), ('crm', 'content'), ('crm', 'design'), ('crm', 'brand'),
    ('partnerships', 'design'), ('partnerships', 'brand')) as t(tab, team)
  cross join public.placement_settings s
  join public.departments d
    on not d.archived
   and (d.slug = t.team or lower(d.name) = t.team
        or (t.team = 'design' and d.id = s.design_department_id)
        or (t.team = 'tech' and d.id = s.tech_department_id)
        or (t.team = 'commercial' and d.id = s.commercial_department_id)
        or (t.team = 'content' and d.id = s.content_department_id))
 where s.id = 1
on conflict do nothing;

-- The lock screen lists the tab's teams (and Design), no longer Tech everywhere.
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
                   or d.id in (select s.design_department_id from public.placement_settings s where s.id = 1)), '[]'::jsonb),
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

notify pgrst, 'reload schema';
