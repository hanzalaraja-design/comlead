-- Journeys: tasks in a journey, and the hand-over notifications.
-- Rolled back at the end; a failed check raises "FAIL: ...".

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

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-b700-000000000001', 'jtest.builder@highfy.pk', '{"full_name":"Bea Builder"}'),
  ('00000000-0000-4000-b700-000000000002', 'jtest.reviewer@highfy.pk', '{"full_name":"Rae Reviewer"}'),
  ('00000000-0000-4000-b700-000000000003', 'jtest.live@highfy.pk', '{"full_name":"Lee Live"}');
update public.profiles set status = 'active' where email like 'jtest.%';

insert into public.projects (id, name, slug, kind, created_by, has_journeys, journey_people)
values ('00000000-0000-4000-b800-000000000001', 'Journeys test', 'journeys-test', 'project', '00000000-0000-4000-b700-000000000001', true,
        '{"build":"00000000-0000-4000-b700-000000000001","review":"00000000-0000-4000-b700-000000000002","live":"00000000-0000-4000-b700-000000000003"}');
insert into public.projects (id, name, slug, kind, created_by)
values ('00000000-0000-4000-b800-000000000002', 'Elsewhere', 'elsewhere-test', 'project', '00000000-0000-4000-b700-000000000001');
insert into public.project_members (project_id, user_id, role) values
  ('00000000-0000-4000-b800-000000000001', '00000000-0000-4000-b700-000000000002', 'member'),
  ('00000000-0000-4000-b800-000000000001', '00000000-0000-4000-b700-000000000003', 'member');

select pg_temp.login('00000000-0000-4000-b700-000000000001');
set local role authenticated;
insert into public.project_parts (id, project_id, kind, name, stage)
values ('00000000-0000-4000-b900-000000000001', '00000000-0000-4000-b800-000000000001', 'journey', 'First order', 'design');
select pg_temp.denied($$insert into public.project_parts (project_id, kind, name, stage) values ('00000000-0000-4000-b800-000000000001', 'journey', 'Bad', 'in_talks')$$,
  'a journey only takes journey stages');
insert into public.tasks (id, title, project_id, part_id, owner_id, created_by)
values ('00000000-0000-4000-ba00-000000000001', 'Write the welcome email', '00000000-0000-4000-b800-000000000001', '00000000-0000-4000-b900-000000000001', auth.uid(), auth.uid());
select pg_temp.ok((select part_id from public.tasks where id = '00000000-0000-4000-ba00-000000000001') = '00000000-0000-4000-b900-000000000001', 'a task can be in a journey');
select pg_temp.denied($$insert into public.tasks (title, project_id, part_id, owner_id, created_by)
  values ('Wrong place', '00000000-0000-4000-b800-000000000002', '00000000-0000-4000-b900-000000000001', auth.uid(), auth.uid())$$,
  'a task cannot be in another project''s journey');
update public.tasks set project_id = '00000000-0000-4000-b800-000000000002' where id = '00000000-0000-4000-ba00-000000000001';
select pg_temp.ok((select part_id from public.tasks where id = '00000000-0000-4000-ba00-000000000001') is null, 'moved to another project, it leaves the journey');

update public.project_parts set stage = 'review' where id = '00000000-0000-4000-b900-000000000001';
reset role;

select pg_temp.login('00000000-0000-4000-b700-000000000002');
set local role authenticated;
select pg_temp.ok((select count(*) from public.notifications where title = 'First order is ready for your review') = 1, 'sent for review: the reviewer is told');
update public.project_parts set stage = 'approved' where id = '00000000-0000-4000-b900-000000000001';
reset role;

select pg_temp.login('00000000-0000-4000-b700-000000000003');
set local role authenticated;
select pg_temp.ok((select count(*) from public.notifications where title = 'First order is approved: put it live on Mergn') = 1, 'approved: whoever puts it live is told');
reset role;

select 'ALL JOURNEY TESTS PASSED' as result;
rollback;
