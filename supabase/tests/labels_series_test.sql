-- Several categories with tags in one picker, and linking a meeting series
-- when it's set up. Rolled back at the end.

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

insert into public.departments (id, name, slug, sort_order) values ('00000000-0000-4000-c300-0000000000aa', 'Labels team', 'labels-team', 91);
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-c400-000000000001', 'lstest.owner@highfy.pk', '{"full_name":"Lia Owner"}'),
  ('00000000-0000-4000-c400-000000000002', 'lstest.member@highfy.pk', '{"full_name":"Max Member"}'),
  ('00000000-0000-4000-c400-000000000003', 'lstest.out@highfy.pk', '{"full_name":"Nia Outside"}');
update public.profiles set status = 'active' where email like 'lstest.%';
insert into public.department_members (department_id, user_id, role) values ('00000000-0000-4000-c300-0000000000aa', '00000000-0000-4000-c400-000000000001', 'member');
insert into public.projects (id, name, slug, kind, category, created_by) values
  ('00000000-0000-4000-c500-000000000001', 'EFU Life', 'efu-life-test', 'partnership', 'referral', '00000000-0000-4000-c400-000000000001');
insert into public.project_members (project_id, user_id, role) values ('00000000-0000-4000-c500-000000000001', '00000000-0000-4000-c400-000000000002', 'member');
select pg_temp.ok((select categories from public.projects where id = '00000000-0000-4000-c500-000000000001') = array['referral'], 'an old single category carries over');

-- Max (a member, not an owner) sets two categories and two tags at once.
select pg_temp.login('00000000-0000-4000-c400-000000000002');
set local role authenticated;
select public.set_partnership_labels('00000000-0000-4000-c500-000000000001', array['referral', 'fintech'],
  array(select id from public.partnership_tags where name in ('Discount only', 'BNPL')));
select pg_temp.ok((select categories from public.projects where id = '00000000-0000-4000-c500-000000000001') = array['fintech', 'referral'], 'a member can set several categories');
select pg_temp.ok((select count(*) from public.project_tags where project_id = '00000000-0000-4000-c500-000000000001') = 2, 'and its tags in the same go');
select pg_temp.ok((select categories from public.partnership_directory() where slug = 'efu-life-test') = array['fintech', 'referral'], 'the list shows both categories');
select pg_temp.denied($$select public.set_partnership_labels('00000000-0000-4000-c500-000000000001', array['beauty'], '{}')$$, 'only the three categories are allowed');
reset role;

select pg_temp.login('00000000-0000-4000-c400-000000000003');
set local role authenticated;
select pg_temp.denied($$select public.set_partnership_labels('00000000-0000-4000-c500-000000000001', array['associations'], '{}')$$, 'someone outside it cannot change them');
reset role;

-- A weekly meeting linked to the partnership when it's set up.
insert into public.meeting_series (id, title, department_id, start_date, meeting_time, created_by)
values ('00000000-0000-4000-c600-000000000001', 'EFU weekly', '00000000-0000-4000-c300-0000000000aa', public.pkt_today(), '10:00', '00000000-0000-4000-c400-000000000001');
insert into public.meetings (id, department_id, series_id, title, meeting_date, created_by) values
  ('00000000-0000-4000-c700-000000000001', '00000000-0000-4000-c300-0000000000aa', '00000000-0000-4000-c600-000000000001', 'EFU weekly', public.pkt_today() - 7, '00000000-0000-4000-c400-000000000001'),
  ('00000000-0000-4000-c700-000000000002', '00000000-0000-4000-c300-0000000000aa', '00000000-0000-4000-c600-000000000001', 'EFU weekly', public.pkt_today() + 7, '00000000-0000-4000-c400-000000000001');

select pg_temp.login('00000000-0000-4000-c400-000000000003');
set local role authenticated;
select pg_temp.denied($$select public.set_series_projects('00000000-0000-4000-c600-000000000001', array['00000000-0000-4000-c500-000000000001'::uuid])$$,
  'someone who didn''t set the meeting up cannot link it');
reset role;

select pg_temp.login('00000000-0000-4000-c400-000000000001');
set local role authenticated;
select public.set_series_projects('00000000-0000-4000-c600-000000000001', array['00000000-0000-4000-c500-000000000001'::uuid]);
select pg_temp.ok(exists (select 1 from public.meeting_projects where meeting_id = '00000000-0000-4000-c700-000000000002'), 'the next meeting is linked');
select pg_temp.ok(not exists (select 1 from public.meeting_projects where meeting_id = '00000000-0000-4000-c700-000000000001'), 'a past meeting is left as it was');
reset role;
insert into public.meetings (id, department_id, series_id, title, meeting_date, created_by)
values ('00000000-0000-4000-c700-000000000003', '00000000-0000-4000-c300-0000000000aa', '00000000-0000-4000-c600-000000000001', 'EFU weekly', public.pkt_today() + 14, '00000000-0000-4000-c400-000000000001');
select pg_temp.ok(exists (select 1 from public.meeting_projects where meeting_id = '00000000-0000-4000-c700-000000000003'), 'meetings made later are linked too');

select pg_temp.login('00000000-0000-4000-c400-000000000001');
set local role authenticated;
select public.set_series_projects('00000000-0000-4000-c600-000000000001', '{}');
select pg_temp.ok(not exists (select 1 from public.meeting_projects mp join public.meetings m on m.id = mp.meeting_id where m.series_id = '00000000-0000-4000-c600-000000000001'),
  'taking it off unlinks the future meetings');
reset role;

select 'ALL LABELS AND SERIES TESTS PASSED' as result;
rollback;
