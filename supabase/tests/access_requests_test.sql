-- Request access: tests. Runs after the migrations and seed, inside a
-- transaction that is rolled back. Any failed check raises "FAIL: ...".

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

-- Expect an error (blocked) or no rows touched.
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

-- People: Owen owns things in Content; Xena (Marketing) and Yusuf (Marketing) ask.
insert into public.departments (name, slug, sort_order) values ('Marketing', 'marketing', 4), ('Content', 'content', 5)
on conflict (slug) do nothing;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-b100-000000000001', 'artest.owen@highfy.pk', '{"full_name":"Owen Owner"}'),
  ('00000000-0000-4000-b100-000000000002', 'artest.xena@highfy.pk', '{"full_name":"Xena Asker"}'),
  ('00000000-0000-4000-b100-000000000003', 'artest.yusuf@highfy.pk', '{"full_name":"Yusuf Asker"}');
update public.profiles set status = 'active' where email like 'artest.%';
insert into public.department_members (department_id, user_id, role)
select d.id, u.id, 'member'
  from (values ('content', '00000000-0000-4000-b100-000000000001'::uuid),
               ('marketing', '00000000-0000-4000-b100-000000000002'::uuid),
               ('marketing', '00000000-0000-4000-b100-000000000003'::uuid)) u(slug, id)
  join public.departments d on d.slug = u.slug;

insert into public.tasks (id, title, department_id, owner_id, created_by)
select '00000000-0000-4000-b200-000000000001', 'Content plan for December', id,
       '00000000-0000-4000-b100-000000000001', '00000000-0000-4000-b100-000000000001'
  from public.departments where slug = 'content';
insert into public.projects (id, name, slug, kind, created_by)
values ('00000000-0000-4000-b300-000000000001', 'Zong test', 'zong-test', 'project', '00000000-0000-4000-b100-000000000001');

-- ---------------------------------------------------------------------------
-- Xena asks for the task
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-b100-000000000002');
set local role authenticated;

select pg_temp.ok((select count(*) from public.tasks where id = '00000000-0000-4000-b200-000000000001') = 0, 'Xena cannot see the Content task');
select pg_temp.ok((public.access_info('task', '00000000-0000-4000-b200-000000000001') ->> 'title') = 'Content plan for December', 'the lock screen gets its name');
select pg_temp.ok((public.access_info('task', '00000000-0000-4000-b200-000000000001') ->> 'owner') = 'Owen Owner', 'the lock screen names the owner');
select pg_temp.ok(not (public.access_info('task', '00000000-0000-4000-b200-000000000001') ->> 'can_read')::boolean, 'it says Xena has no access');
select pg_temp.ok(public.access_info('task', '00000000-0000-4000-b200-0000000000ff') is null, 'nothing for a task that does not exist');

create temp table req as select public.request_access('task', '00000000-0000-4000-b200-000000000001', 'Writing the December posts') as id;
select pg_temp.ok((select id from req) = public.request_access('task', '00000000-0000-4000-b200-000000000001', 'again'), 'asking twice keeps one request');
select pg_temp.ok((public.access_info('task', '00000000-0000-4000-b200-000000000001') ->> 'asked')::boolean, 'it shows Xena already asked');
select pg_temp.ok((select count(*) from public.tasks where id = '00000000-0000-4000-b200-000000000001') = 0, 'asking alone gives no access');
select pg_temp.denied($$select public.decide_access((select id from req), true)$$, 'Xena cannot give herself access');
select pg_temp.denied($$insert into public.access_requests (item_type, item_id, status) values ('task', '00000000-0000-4000-b200-000000000001', 'given')$$, 'requests cannot be written directly');
select pg_temp.ok((select count(*) from public.access_requests where id = (select id from req)) = 1, 'Xena sees her own request');
reset role;

-- Yusuf can't see Xena's request
select pg_temp.login('00000000-0000-4000-b100-000000000003');
set local role authenticated;
select pg_temp.ok((select count(*) from public.access_requests) = 0, 'others do not see the request');
select pg_temp.denied($$select public.decide_access((select id from req), true)$$, 'someone else cannot give access');
reset role;

-- ---------------------------------------------------------------------------
-- Owen gives access
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-b100-000000000001');
set local role authenticated;
select pg_temp.ok((select count(*) from public.access_requests where id = (select id from req)) = 1, 'the owner sees the request');
select pg_temp.ok((select count(*) from public.notifications where kind = 'access' and href = '/access/' || (select id from req)) = 1, 'the owner is notified once');
select public.decide_access((select id from req), true);
select pg_temp.ok((select status from public.access_requests where id = (select id from req)) = 'given', 'the request is marked given');
reset role;

select pg_temp.login('00000000-0000-4000-b100-000000000002');
set local role authenticated;
select pg_temp.ok((select count(*) from public.tasks where id = '00000000-0000-4000-b200-000000000001') = 1, 'Xena can now see the task');
select pg_temp.ok((select count(*) from public.task_collaborators where task_id = '00000000-0000-4000-b200-000000000001' and user_id = auth.uid()) = 1, 'she was added as a collaborator');
select pg_temp.ok((select count(*) from public.notifications where kind = 'access' and title like 'Owen Owner gave you access%') = 1, 'Xena is told');
select pg_temp.ok((select count(*) from public.activity_log where task_id = '00000000-0000-4000-b200-000000000001' and actor_id <> auth.uid()) > 0, 'she can read the task''s history, including others'' changes');
select pg_temp.denied($$select public.request_access('task', '00000000-0000-4000-b200-000000000001')$$, 'no request for something you can already see');
reset role;

-- ---------------------------------------------------------------------------
-- Yusuf asks for the project; Owen declines
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-b100-000000000003');
set local role authenticated;
select pg_temp.ok((select count(*) from public.projects where slug = 'zong-test') = 0, 'Yusuf cannot see the project');
select pg_temp.ok((select count(*) from public.activity_log where task_id = '00000000-0000-4000-b200-000000000001') = 0, 'nor the history of a task he cannot see');
create temp table preq as select public.request_access('project', 'zong-test', null) as id;
reset role;

select pg_temp.login('00000000-0000-4000-b100-000000000001');
set local role authenticated;
select public.decide_access((select id from preq), false);
reset role;

select pg_temp.login('00000000-0000-4000-b100-000000000003');
set local role authenticated;
select pg_temp.ok((select count(*) from public.projects where slug = 'zong-test') = 0, 'declined: still no access');
select pg_temp.ok((select count(*) from public.notifications where title like 'Owen Owner declined%') = 1, 'Yusuf is told it was declined');
select pg_temp.ok(not (public.access_info('project', 'zong-test') ->> 'asked')::boolean, 'he can ask again');
create temp table preq2 as select public.request_access('project', 'zong-test', 'Please') as id;
reset role;

select pg_temp.login('00000000-0000-4000-b100-000000000001');
set local role authenticated;
select public.decide_access((select id from preq2), true);
reset role;

select pg_temp.login('00000000-0000-4000-b100-000000000003');
set local role authenticated;
select pg_temp.ok((select count(*) from public.projects where slug = 'zong-test') = 1, 'given: Yusuf sees the project');
select pg_temp.ok((select role from public.project_members where project_id = '00000000-0000-4000-b300-000000000001' and user_id = auth.uid()) = 'member', 'as a person on it, not an owner');
reset role;

select 'ALL ACCESS REQUEST TESTS PASSED' as result;
rollback;
