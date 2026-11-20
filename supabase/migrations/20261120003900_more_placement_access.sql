-- More teams can be let into Placements (asked for by Omaima: Brand gets all of it).
--  * Design's own list can be opened to other teams too, like any tab.
--  * Paid social: other teams can ask for content just like Commercial
--    (send and edit the brief, approve or ask for changes, see everything).
--    Planning and delivering stay with Content.
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

-- Paid social: who asks for content. Commercial, and the teams picked by an Admin.
create or replace function public.is_collab_asker()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.in_placement_team('commercial')
      or public.in_any_team((select paid_social_team_ids from public.placement_settings where id = 1));
$$;
revoke execute on function public.is_collab_asker() from public, anon;
grant execute on function public.is_collab_asker() to authenticated;

-- Everyone who asks, plus Content who plans and delivers.
create or replace function public.can_use_collabs()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_collab_asker() or public.in_placement_team('content');
$$;

-- The asking steps: the same as before, for every team that asks.
create or replace function public.collab_save_request(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.collab_requests;
  v_id uuid;
begin
  if not public.is_collab_asker() then
    raise exception 'Only Commercial (and the teams picked to ask) can ask for content.' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.collab_requests (brand, promote, goals, go_live, budget, audience, key_message, link, refs, project_id, notes)
    values (p ->> 'brand', p ->> 'promote', array(select jsonb_array_elements_text(p -> 'goals')), (p ->> 'go_live')::date,
            p ->> 'budget', p ->> 'audience', p ->> 'key_message', nullif(p ->> 'link', ''), nullif(p ->> 'refs', ''),
            nullif(p ->> 'project_id', '')::uuid, nullif(p ->> 'notes', ''))
    returning id into v_id;
    perform public.collab_notify_team('content', 'collab',
      coalesce(public.person_label(auth.uid()), 'Someone') || ' needs content: ' || (p ->> 'brand'),
      (p ->> 'promote') || ' · live by ' || to_char((p ->> 'go_live')::date, 'DD Mon'), '/collabs/' || v_id);
    return v_id;
  end if;
  select * into r from public.collab_requests where id = p_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status not in ('requested', 'changes') then
    raise exception 'The plan has been sent, so the brief can''t change now. Add a comment instead.' using errcode = '42501';
  end if;
  update public.collab_requests set
    brand = p ->> 'brand', promote = p ->> 'promote', goals = array(select jsonb_array_elements_text(p -> 'goals')),
    go_live = (p ->> 'go_live')::date, budget = p ->> 'budget', audience = p ->> 'audience', key_message = p ->> 'key_message',
    link = nullif(p ->> 'link', ''), refs = nullif(p ->> 'refs', ''), project_id = nullif(p ->> 'project_id', '')::uuid,
    notes = nullif(p ->> 'notes', ''), updated_at = now()
  where id = p_id;
  return p_id;
end;
$$;
grant execute on function public.collab_save_request(uuid, jsonb) to authenticated;

create or replace function public.collab_ask_changes(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.collab_requests;
begin
  if not public.is_collab_asker() then
    raise exception 'Only Commercial (and the teams picked to ask) can do that.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Say what should change.'; end if;
  select * into r from public.collab_requests where id = p_id for update;
  if r.status <> 'planned' then raise exception 'There''s no plan waiting for approval.'; end if;
  update public.collab_requests set status = 'changes', change_note = trim(p_note), updated_at = now() where id = p_id;
  perform public.notify(r.planned_by, 'collab', auth.uid(),
    coalesce(public.person_label(auth.uid()), 'Commercial') || ' asked for changes: ' || r.brand, trim(p_note), '/collabs/' || p_id, null);
end;
$$;
grant execute on function public.collab_ask_changes(uuid, text) to authenticated;

create or replace function public.collab_approve(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.collab_requests;
  it public.collab_items;
  v_dept uuid;
  v_task uuid;
begin
  if not public.is_collab_asker() then
    raise exception 'Only Commercial (and the teams picked to ask) can approve a plan.' using errcode = '42501';
  end if;
  select * into r from public.collab_requests where id = p_id for update;
  if r.status <> 'planned' then raise exception 'There''s no plan waiting for approval.'; end if;
  select content_department_id into v_dept from public.placement_settings where id = 1;

  for it in select * from public.collab_items where request_id = p_id and not is_addon order by sort loop
    insert into public.tasks (title, description, owner_id, due_date, department_id, project_id, created_by, source)
    values (
      it.name || case when it.qty > 1 then ' ×' || it.qty else '' end || ': ' || r.brand,
      '<p>' || replace(replace(replace(coalesce(it.idea, r.promote), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>'
        || '<p>Brand collab. Mark it live with the post link on <a href="/collabs/' || p_id || '">the request</a>.</p>',
      coalesce(it.owner_id, r.planned_by), it.due_date, v_dept, r.project_id, auth.uid(), 'manual')
    returning id into v_task;
    update public.collab_items set task_id = v_task where id = it.id;
  end loop;

  update public.collab_requests set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = p_id;
  perform public.notify(r.planned_by, 'collab', auth.uid(),
    coalesce(public.person_label(auth.uid()), 'Commercial') || ' approved the plan for ' || r.brand,
    'Rs ' || to_char(r.total, 'FM999,999,999') || ' · the pieces are in everyone''s Tasks', '/collabs/' || p_id, null);
end;
$$;
grant execute on function public.collab_approve(uuid) to authenticated;

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
