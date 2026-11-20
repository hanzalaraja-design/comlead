-- Meetings linked to projects: linking, moving action items, series, and
-- where each action item goes. Rolled back at the end.

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

insert into public.departments (id, name, slug, sort_order) values ('00000000-0000-4000-c000-0000000000aa', 'Commercial ML', 'commercial-ml', 90);
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-bd00-000000000001', 'mltest.bilal@highfy.pk', '{"full_name":"Bilal Test"}'),
  ('00000000-0000-4000-bd00-000000000002', 'mltest.guest@highfy.pk', '{"full_name":"Gina Guest"}'),
  ('00000000-0000-4000-bd00-000000000003', 'mltest.out@highfy.pk', '{"full_name":"Omar Outside"}');
update public.profiles set status = 'active' where email like 'mltest.%';
insert into public.department_members (department_id, user_id, role)
select id, '00000000-0000-4000-bd00-000000000001', 'member' from public.departments where slug = 'commercial-ml';

-- Two projects Bilal owns, and a weekly series with two meetings Bilal and Gina attend.
insert into public.projects (id, name, slug, kind, created_by) values
  ('00000000-0000-4000-be00-000000000001', 'Zong ML', 'zong-ml', 'partnership', '00000000-0000-4000-bd00-000000000001'),
  ('00000000-0000-4000-be00-000000000002', 'Sale ML', 'sale-ml', 'campaign', '00000000-0000-4000-bd00-000000000001');
insert into public.meeting_series (id, title, department_id, start_date, meeting_time, created_by)
select '00000000-0000-4000-bf00-000000000001', 'Zong weekly', id, public.pkt_today(), '11:00', '00000000-0000-4000-bd00-000000000001'
  from public.departments where slug = 'commercial-ml';
insert into public.meetings (id, department_id, series_id, title, meeting_date, created_by)
select x.id, d.id, '00000000-0000-4000-bf00-000000000001', 'Zong weekly', x.day, '00000000-0000-4000-bd00-000000000001'
  from public.departments d,
       (values ('00000000-0000-4000-c100-000000000001'::uuid, public.pkt_today()),
               ('00000000-0000-4000-c100-000000000002'::uuid, public.pkt_today() + 7)) x(id, day)
 where d.slug = 'commercial-ml';
insert into public.meeting_attendees (meeting_id, user_id) values
  ('00000000-0000-4000-c100-000000000001', '00000000-0000-4000-bd00-000000000001'),
  ('00000000-0000-4000-c100-000000000001', '00000000-0000-4000-bd00-000000000002');

-- An action item from before the meeting was linked.
insert into public.tasks (id, title, department_id, meeting_id, owner_id, created_by)
select '00000000-0000-4000-c200-000000000001', 'Send draft', d.id, '00000000-0000-4000-c100-000000000001',
       '00000000-0000-4000-bd00-000000000001', '00000000-0000-4000-bd00-000000000001'
  from public.departments d where d.slug = 'commercial-ml';

select pg_temp.login('00000000-0000-4000-bd00-000000000003');
set local role authenticated;
select pg_temp.denied($$select public.link_meeting('00000000-0000-4000-c100-000000000001', '00000000-0000-4000-be00-000000000001', true, true)$$,
  'someone outside the meeting cannot link it');
reset role;

select pg_temp.login('00000000-0000-4000-bd00-000000000001');
set local role authenticated;
select public.link_meeting('00000000-0000-4000-c100-000000000001', '00000000-0000-4000-be00-000000000001', true, true);
select pg_temp.ok((select project_id from public.tasks where id = '00000000-0000-4000-c200-000000000001') = '00000000-0000-4000-be00-000000000001',
  'linking with "move" brings existing action items into the project');
select pg_temp.ok(exists (select 1 from public.meeting_projects where meeting_id = '00000000-0000-4000-c100-000000000002'),
  'linking the series links the next meeting too');
reset role;

-- A meeting added to the series later is linked as well.
insert into public.meetings (id, department_id, series_id, title, meeting_date, created_by)
select '00000000-0000-4000-c100-000000000003', d.id, '00000000-0000-4000-bf00-000000000001', 'Zong weekly', public.pkt_today() + 14, '00000000-0000-4000-bd00-000000000001'
  from public.departments d where d.slug = 'commercial-ml';
select pg_temp.ok(exists (select 1 from public.meeting_projects where meeting_id = '00000000-0000-4000-c100-000000000003'),
  'a new meeting in a linked series is linked');

-- Gina is at the meeting but not in the project; her action item still lands in it.
select pg_temp.login('00000000-0000-4000-bd00-000000000002');
set local role authenticated;
insert into public.tasks (id, title, department_id, meeting_id, owner_id, created_by)
values ('00000000-0000-4000-c200-000000000002', 'Legal review', '00000000-0000-4000-c000-0000000000aa', '00000000-0000-4000-c100-000000000001', auth.uid(), auth.uid());
reset role;
select pg_temp.ok((select project_id from public.tasks where id = '00000000-0000-4000-c200-000000000002') = '00000000-0000-4000-be00-000000000001',
  'an action item from someone not in the project still lands in it');

-- The guard still holds for people moving tasks themselves (and the exception doesn't linger).
select pg_temp.login('00000000-0000-4000-bd00-000000000002');
set local role authenticated;
select pg_temp.denied($$update public.tasks set project_id = '00000000-0000-4000-be00-000000000002' where id = '00000000-0000-4000-c200-000000000002'$$,
  'Gina still cannot move a task into a project she isn''t in');
reset role;
select pg_temp.login('00000000-0000-4000-bd00-000000000003');
set local role authenticated;
select pg_temp.denied($$select public.set_action_item_project('00000000-0000-4000-c200-000000000002', null)$$,
  'someone outside the meeting cannot move its action items');
reset role;

-- Linked to a second project: pick where an item goes.
select pg_temp.login('00000000-0000-4000-bd00-000000000001');
set local role authenticated;
select public.link_meeting('00000000-0000-4000-c100-000000000001', '00000000-0000-4000-be00-000000000002');
select public.set_action_item_project('00000000-0000-4000-c200-000000000002', '00000000-0000-4000-be00-000000000002');
select pg_temp.ok((select project_id from public.tasks where id = '00000000-0000-4000-c200-000000000002') = '00000000-0000-4000-be00-000000000002',
  'an action item can go to another linked project');
select pg_temp.denied($$select public.set_action_item_project('00000000-0000-4000-c200-000000000002', gen_random_uuid())$$,
  'but not to a project the meeting isn''t linked to');
select public.unlink_meeting('00000000-0000-4000-c100-000000000001', '00000000-0000-4000-be00-000000000002');
select pg_temp.ok((select project_id from public.tasks where id = '00000000-0000-4000-c200-000000000002') = '00000000-0000-4000-be00-000000000001',
  'unlinked: its items go back to the project still linked');
select public.unlink_meeting('00000000-0000-4000-c100-000000000001', '00000000-0000-4000-be00-000000000001', true);
select pg_temp.ok((select project_id from public.tasks where id = '00000000-0000-4000-c200-000000000001') is null,
  'nothing linked: items stay only in the meeting');
select pg_temp.ok(not exists (select 1 from public.meeting_projects where meeting_id = '00000000-0000-4000-c100-000000000002'),
  'unlinking the series unlinks future meetings');
reset role;

select 'ALL MEETING LINK TESTS PASSED' as result;
rollback;
