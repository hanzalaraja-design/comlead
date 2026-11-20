-- Who sees which Placements tab, asking for a tab, and Commercial editing
-- homepage sections. Rolled back at the end.

begin;

create function pg_temp.login(p_uid uuid) returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated',
    'email', (select email from auth.users where id = p_uid))::text, true);
$$;
create function pg_temp.ok(p_cond boolean, p_label text) returns void
language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'ok   - %', p_label;
  else raise exception 'FAIL: %', p_label; end if;
end;
$$;
create function pg_temp.denied(p_sql text, p_label text) returns void
language plpgsql as $$
declare n bigint;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    raise notice 'ok   - % (blocked: %)', p_label, sqlerrm;
    return;
  end;
  if n = 0 then raise notice 'ok   - % (0 rows)', p_label;
  else raise exception 'FAIL: % (% rows)', p_label, n; end if;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- In a fresh test database the teams are made after the migrations, so set
-- up the agreed table here too (the live database already has it).
insert into public.placement_tab_teams (tab, department_id)
select t.tab, d.id
  from (values ('web', 'commercial'), ('web', 'marketing'), ('web', 'brand'),
    ('social', 'marketing'), ('social', 'content'), ('social', 'brand'),
    ('ads', 'marketing'), ('crm', 'marketing'), ('crm', 'brand'), ('partnerships', 'brand')) as t(tab, slug)
  join public.departments d on d.slug = t.slug
on conflict do nothing;
update public.placement_tabs t set owner_department_id = d.id
  from (values ('web', 'commercial'), ('social', 'marketing'), ('ads', 'marketing'), ('crm', 'marketing'), ('partnerships', 'brand')) as o(tab, slug)
  join public.departments d on d.slug = o.slug
 where t.key = o.tab and t.owner_department_id is null;

insert into public.departments (id, name, slug, sort_order) values
  ('00000000-0000-4000-e300-0000000000d1', 'Design T', 'design-t', 93),
  ('00000000-0000-4000-e300-0000000000d2', 'Tech T', 'tech-t', 94);
update public.placement_settings
   set design_department_id = '00000000-0000-4000-e300-0000000000d1',
       tech_department_id = '00000000-0000-4000-e300-0000000000d2',
       commercial_department_id = (select id from public.departments where slug = 'commercial')
 where id = 1;
update public.placement_tabs set owner_department_id = '00000000-0000-4000-e300-0000000000d1' where key = 'design';

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-e400-000000000001', 'pttest.mkt@highfy.pk', '{"full_name":"Mia Marketing"}'),
  ('00000000-0000-4000-e400-000000000002', 'pttest.ops@highfy.pk', '{"full_name":"Oscar Ops"}'),
  ('00000000-0000-4000-e400-000000000003', 'pttest.design@highfy.pk', '{"full_name":"Dee Design"}'),
  ('00000000-0000-4000-e400-000000000004', 'pttest.tech@highfy.pk', '{"full_name":"Tom Tech"}'),
  ('00000000-0000-4000-e400-000000000005', 'pttest.brandlead@highfy.pk', '{"full_name":"Bea Brandlead"}'),
  ('00000000-0000-4000-e400-000000000006', 'pttest.comm@highfy.pk', '{"full_name":"Cal Commercial"}'),
  ('00000000-0000-4000-e400-000000000007', 'pttest.content@highfy.pk', '{"full_name":"Cora Content"}');
update public.profiles set status = 'active' where email like 'pttest.%';
insert into public.department_members (department_id, user_id, role) values
  ((select id from public.departments where slug = 'marketing'), '00000000-0000-4000-e400-000000000001', 'member'),
  ((select id from public.departments where slug = 'ops'), '00000000-0000-4000-e400-000000000002', 'member'),
  ('00000000-0000-4000-e300-0000000000d1', '00000000-0000-4000-e400-000000000003', 'member'),
  ('00000000-0000-4000-e300-0000000000d2', '00000000-0000-4000-e400-000000000004', 'member'),
  ((select id from public.departments where slug = 'brand'), '00000000-0000-4000-e400-000000000005', 'lead'),
  ((select id from public.departments where slug = 'commercial'), '00000000-0000-4000-e400-000000000006', 'member'),
  ((select id from public.departments where slug = 'content'), '00000000-0000-4000-e400-000000000007', 'member');

-- One booking by Commercial, one by Ops; one request per channel, one by Ops.
insert into public.placements (id, section_key, position, brand, starts_on, created_by) values
  ('00000000-0000-4000-e500-000000000001', 'hero', 1, 'Luxe', '2026-11-20', '00000000-0000-4000-e400-000000000006'),
  ('00000000-0000-4000-e500-000000000002', 'hero', 2, 'OpsBrand', '2026-11-20', '00000000-0000-4000-e400-000000000002');
insert into public.creative_requests (id, channel, title, requested_by) values
  ('00000000-0000-4000-e600-000000000001', 'ads', 'Ads banner', '00000000-0000-4000-e400-000000000001'),
  ('00000000-0000-4000-e600-000000000002', 'partnerships', 'Zong creative', '00000000-0000-4000-e400-000000000005'),
  ('00000000-0000-4000-e600-000000000003', 'crm', 'Ops push', '00000000-0000-4000-e400-000000000002');
insert into public.creative_request_comments (request_id, author_id, body) values
  ('00000000-0000-4000-e600-000000000002', '00000000-0000-4000-e400-000000000005', 'Brand only');

-- Marketing: App / Website, Social, Ads, CRM; not Partnerships or Design.
select pg_temp.login('00000000-0000-4000-e400-000000000001');
set local role authenticated;
select pg_temp.ok(public.can_see_placement_tab('web') and public.can_see_placement_tab('ads') and public.can_see_placement_tab('crm') and public.can_see_placement_tab('social'), 'Marketing sees App / Website, Social, Ads and CRM');
select pg_temp.ok(not public.can_see_placement_tab('partnerships') and not public.can_see_placement_tab('design'), 'but not Partnerships or Design');
select pg_temp.ok(public.my_placement_tabs() = array['web', 'social', 'ads', 'crm'], 'and the page gets that list in one go');
select pg_temp.ok((select count(*) from public.placements where id::text like '00000000-0000-4000-e500%') = 2, 'Marketing sees the homepage bookings');
select pg_temp.ok((select count(*) from public.creative_requests where id::text like '00000000-0000-4000-e600%') = 2, 'Marketing sees Ads and CRM requests, not Partnerships');
select pg_temp.ok((select count(*) from public.creative_request_comments where request_id = '00000000-0000-4000-e600-000000000002') = 0, 'nor their comments');
reset role;

-- Ops: nothing, except what they made.
select pg_temp.login('00000000-0000-4000-e400-000000000002');
set local role authenticated;
select pg_temp.ok(not public.can_see_placement_tab('web') and not public.can_see_placement_tab('crm'), 'Ops sees no tabs');
select pg_temp.ok((select array_agg(brand) from public.placements where id::text like '00000000-0000-4000-e500%') = array['OpsBrand'], 'Ops sees only their own booking');
select pg_temp.ok((select array_agg(title) from public.creative_requests where id::text like '00000000-0000-4000-e600%') = array['Ops push'], 'and only their own request');
select pg_temp.denied($$update public.placements set notes = 'x' where id = '00000000-0000-4000-e500-000000000001'$$, 'Ops cannot change someone else''s booking');
select pg_temp.ok((public.access_info('placement_tab', 'partnerships') ->> 'owner') = 'Bea Brandlead', 'the lock screen names the Brand lead');
select public.request_access('placement_tab', 'partnerships', 'Helping with Zong');
select pg_temp.denied($$select public.decide_access((select id from public.access_requests where requested_by = auth.uid() and item_type = 'placement_tab'), true)$$, 'Ops cannot give themselves access');
reset role;
select pg_temp.ok((select count(*) from public.notifications where user_id = '00000000-0000-4000-e400-000000000005' and kind = 'access') = 1, 'the Brand lead is asked');

-- The Brand lead gives access.
select pg_temp.login('00000000-0000-4000-e400-000000000005');
set local role authenticated;
select pg_temp.ok((select count(*) from public.access_requests where item_type = 'placement_tab') = 1, 'the Brand lead sees the request');
select public.decide_access((select id from public.access_requests where item_type = 'placement_tab'), true);
reset role;
select pg_temp.login('00000000-0000-4000-e400-000000000002');
set local role authenticated;
select pg_temp.ok(public.can_see_placement_tab('partnerships'), 'Ops now sees Partnerships');
select pg_temp.ok((select count(*) from public.creative_requests where channel = 'partnerships') >= 1, 'and its requests');
select pg_temp.ok(not public.can_see_placement_tab('web'), 'but still not App / Website');
reset role;

-- Design and Tech see everything; Design's list is Design's.
select pg_temp.login('00000000-0000-4000-e400-000000000003');
set local role authenticated;
select pg_temp.ok(public.can_see_placement_tab('partnerships') and public.can_see_placement_tab('design'), 'Design sees every tab and its own list');
reset role;
select pg_temp.login('00000000-0000-4000-e400-000000000004');
set local role authenticated;
select pg_temp.ok(public.can_see_placement_tab('partnerships') and public.can_see_placement_tab('web') and not public.can_see_placement_tab('design'), 'Tech sees every tab except Design''s list');
select pg_temp.denied($$select public.add_placement_section('Tech section', 'banner', 1, '{web}')$$, 'Tech cannot add sections');
reset role;

-- Content: Social only.
select pg_temp.login('00000000-0000-4000-e400-000000000007');
set local role authenticated;
select pg_temp.ok(public.can_see_placement_tab('social') and not public.can_see_placement_tab('web'), 'Content sees Social, not App / Website');
reset role;

-- Commercial edits the layout.
select pg_temp.login('00000000-0000-4000-e400-000000000006');
set local role authenticated;
select pg_temp.ok(public.can_edit_placement_layout(), 'Commercial can edit the layout');
select public.add_placement_section('Glow Rewards', 'tiles', 6, '{app}', '600 x 600');
select pg_temp.ok((select kind = 'tiles' and slots = 6 and shows_on = '{app}' and sort > (select max(sort) from public.placement_sections where key <> s.key) from public.placement_sections s where name = 'Glow Rewards'), 'a new section goes to the bottom');
select public.order_placement_sections(array[(select key from public.placement_sections where name = 'Glow Rewards'), 'announcement']);
select pg_temp.ok((select key from public.placement_sections where not archived and surface = 'web' order by sort limit 1) = (select key from public.placement_sections where name = 'Glow Rewards'), 'and can be moved to the top');
select public.hide_placement_section('hero', true);
select pg_temp.ok((select archived from public.placement_sections where key = 'hero'), 'hiding a section works');
select pg_temp.ok((select count(*) from public.placements where section_key = 'hero') = 2, 'its bookings stay');
select pg_temp.denied($$update public.placement_sections set slots = 2 where key = 'badge'$$, 'Commercial cannot change sections directly');
reset role;

select pg_temp.login('00000000-0000-4000-e400-000000000001');
set local role authenticated;
select pg_temp.ok(not public.can_edit_placement_layout(), 'Marketing cannot edit the layout');
select pg_temp.denied($$select public.hide_placement_section('badge', true)$$, 'nor hide a section');
select pg_temp.denied($$insert into public.placement_tab_people (tab, user_id) values ('partnerships', auth.uid())$$, 'nobody can give themselves a tab');
reset role;

set local role anon;
select pg_temp.denied($$select public.can_see_placement_tab('web')$$, 'signed-out visitors get nothing');
reset role;

rollback;
