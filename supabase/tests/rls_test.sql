-- Highfy Tasks: access rule tests.
--
-- Creates throwaway users and data inside a transaction, checks what each
-- role can and cannot do, then ROLLS BACK so nothing is left behind.
-- Any failed check raises "FAIL: ..." and aborts.
--
-- Run against Supabase:  npm run db:test
-- Run on local Postgres: npm run db:test:local

begin;

-- ---------------------------------------------------------------------------
-- Test helpers (temporary, vanish at end of session)
-- ---------------------------------------------------------------------------

create function pg_temp.login(p_uid uuid, p_email text) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'email', p_email, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.ok(p_cond boolean, p_label text) returns void
language plpgsql as $$
begin
  if coalesce(p_cond, false) then
    raise notice 'ok   - %', p_label;
  else
    raise exception 'FAIL: %', p_label;
  end if;
end;
$$;

-- Expect the statement to be blocked (permission error) or to touch 0 rows.
create function pg_temp.denied(p_sql text, p_label text) returns void
language plpgsql as $$
declare
  n bigint;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception
    when insufficient_privilege or check_violation or foreign_key_violation then
      raise notice 'ok   - % (blocked)', p_label;
      return;
  end;
  if n = 0 then
    raise notice 'ok   - % (0 rows)', p_label;
  else
    raise exception 'FAIL: % (% rows affected)', p_label, n;
  end if;
end;
$$;

-- Expect the statement to succeed and touch at least one row.
create function pg_temp.allowed(p_sql text, p_label text) returns void
language plpgsql as $$
declare
  n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  if n > 0 then
    raise notice 'ok   - %', p_label;
  else
    raise exception 'FAIL: % (0 rows)', p_label;
  end if;
exception
  when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise exception 'FAIL: % (error: %)', p_label, sqlerrm;
end;
$$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

-- Departments may already be seeded; make sure the two we use exist.
insert into public.departments (name, slug, sort_order) values
  ('Marketing', 'marketing', 4), ('Content', 'content', 5)
on conflict (slug) do nothing;

-- People. Profiles are created by the auth trigger.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-a000-000000000001', 'rlstest.admin@highfy.pk',   '{"full_name":"Test Admin"}'),
  ('00000000-0000-4000-a000-000000000002', 'rlstest.mlead@highfy.pk',   '{"full_name":"Marketing Lead"}'),
  ('00000000-0000-4000-a000-000000000003', 'rlstest.mmember@highfy.pk', '{"full_name":"Marketing Member"}'),
  ('00000000-0000-4000-a000-000000000004', 'rlstest.cmember@highfy.pk', '{"full_name":"Content Member"}'),
  ('00000000-0000-4000-a000-000000000005', 'rlstest.pending@highfy.pk', '{"full_name":"Pending Person"}'),
  ('00000000-0000-4000-a000-000000000006', 'rlstest.mmember2@highfy.pk','{"full_name":"Marketing Member 2"}');

select pg_temp.ok(
  (select count(*) from public.profiles where email like 'rlstest.%' and status = 'pending') = 6,
  'first login creates a pending profile');

update public.profiles set status = 'active'
 where email like 'rlstest.%' and email <> 'rlstest.pending@highfy.pk';
update public.profiles set is_admin = true where email = 'rlstest.admin@highfy.pk';

-- Non-Highfy accounts are rejected by the database itself.
do $$
begin
  begin
    insert into auth.users (id, email) values ('00000000-0000-4000-a000-0000000000ff', 'someone@gmail.com');
    raise exception 'FAIL: non-highfy account was created';
  exception when check_violation then
    raise notice 'ok   - non-highfy account rejected at sign-up';
  end;
end $$;

insert into public.department_members (department_id, user_id, role)
select d.id, u.id::uuid, u.role::public.dept_role
  from (values
    ('marketing', '00000000-0000-4000-a000-000000000002', 'lead'),
    ('marketing', '00000000-0000-4000-a000-000000000003', 'member'),
    ('marketing', '00000000-0000-4000-a000-000000000006', 'member'),
    ('content',   '00000000-0000-4000-a000-000000000004', 'member')) as u(slug, id, role)
  join public.departments d on d.slug = u.slug;

insert into public.meetings (id, department_id, title, meeting_date, minutes)
select ('00000000-0000-4000-b000-00000000000' || x.n)::uuid, d.id, x.title, public.pkt_today(), '<p>Secret minutes</p>'
  from (values ('1', 'marketing', 'Marketing weekly'), ('2', 'content', 'Content weekly')) as x(n, slug, title)
  join public.departments d on d.slug = x.slug;

-- T1: Marketing, owned by Marketing Member
-- T2: Content,   owned by Content Member
-- T3: Marketing, owned by Marketing Lead (Marketing Member not involved)
-- T4: Marketing, owned by Marketing Member 2, Marketing Member is a collaborator
insert into public.tasks (id, title, department_id, owner_id)
select x.id::uuid, x.title, d.id, x.owner::uuid
  from (values
    ('00000000-0000-4000-c000-000000000001', 'T1 marketing task', 'marketing', '00000000-0000-4000-a000-000000000003'),
    ('00000000-0000-4000-c000-000000000002', 'T2 content task',   'content',   '00000000-0000-4000-a000-000000000004'),
    ('00000000-0000-4000-c000-000000000003', 'T3 lead task',      'marketing', '00000000-0000-4000-a000-000000000002'),
    ('00000000-0000-4000-c000-000000000004', 'T4 shared task',    'marketing', '00000000-0000-4000-a000-000000000006')) as x(id, title, slug, owner)
  join public.departments d on d.slug = x.slug;

insert into public.task_collaborators (task_id, user_id)
values ('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-a000-000000000003');

insert into public.task_comments (task_id, author_id, body)
values ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-a000-000000000004', 'Content-only comment');

insert into storage.objects (bucket_id, name, owner_id)
values ('task-attachments', '00000000-0000-4000-c000-000000000002/brief.pdf', '00000000-0000-4000-a000-000000000004');

-- Activity entries made by the Content Member (as themselves).
select pg_temp.login('00000000-0000-4000-a000-000000000004', 'rlstest.cmember@highfy.pk');
set local role authenticated;
update public.tasks set status = 'in_progress' where id = '00000000-0000-4000-c000-000000000002';
reset role;

-- ---------------------------------------------------------------------------
-- Anonymous: nothing
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '', true);
set local role anon;
select pg_temp.denied('select * from public.tasks', 'anon cannot read tasks');
select pg_temp.denied('select * from public.profiles', 'anon cannot read profiles');
select pg_temp.denied('select * from public.activity_log', 'anon cannot read activity');
reset role;

-- ---------------------------------------------------------------------------
-- Pending user: own profile only
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-a000-000000000005', 'rlstest.pending@highfy.pk');
set local role authenticated;
select pg_temp.ok((select count(*) from public.profiles) = 1, 'pending user sees only own profile');
select pg_temp.denied('select * from public.departments', 'pending user sees no departments');
select pg_temp.denied('select * from public.tasks', 'pending user sees no tasks');
select pg_temp.denied('select * from public.meetings', 'pending user sees no meetings');
select pg_temp.denied($$insert into public.tasks (title, department_id, created_by)
  select 'x', id, auth.uid() from public.departments where slug = 'marketing'$$, 'pending user cannot create tasks');
reset role;

-- ---------------------------------------------------------------------------
-- Valid session but non-Highfy email claim: nothing
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-a000-000000000003', 'rlstest.mmember@gmail.com');
set local role authenticated;
select pg_temp.denied('select * from public.tasks', 'non-highfy email claim sees no tasks');
select pg_temp.denied('select * from public.departments', 'non-highfy email claim sees no departments');
reset role;

-- ---------------------------------------------------------------------------
-- Marketing Member
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-a000-000000000003', 'rlstest.mmember@highfy.pk');
set local role authenticated;

-- Reading
select pg_temp.ok((select array_agg(slug order by slug) from public.departments) = '{marketing}',
  'member sees only their own department');
select pg_temp.denied($$select * from public.tasks where id = '00000000-0000-4000-c000-000000000002'$$,
  'member cannot read another department''s task');
select pg_temp.ok((select count(*) from public.tasks where id in (
    '00000000-0000-4000-c000-000000000001', '00000000-0000-4000-c000-000000000003',
    '00000000-0000-4000-c000-000000000004')) = 3,
  'member reads all tasks in own department');
select pg_temp.denied($$select * from public.meetings where id = '00000000-0000-4000-b000-000000000002'$$,
  'member cannot read another department''s meeting');
select pg_temp.denied($$select * from public.meetings where search @@ websearch_to_tsquery('english', 'secret') and department_id <> (select id from public.departments where slug = 'marketing')$$,
  'member full-text search cannot reach other departments');
select pg_temp.denied($$select * from public.task_comments where task_id = '00000000-0000-4000-c000-000000000002'$$,
  'member cannot read another department''s comments');
select pg_temp.denied($$select * from storage.objects where bucket_id = 'task-attachments' and name like '00000000-0000-4000-c000-000000000002/%'$$,
  'member cannot read another department''s attachments');
select pg_temp.denied($$select * from public.department_members m join public.departments d on d.id = m.department_id where d.slug = 'content'$$,
  'member cannot see another department''s members');
select pg_temp.denied($$select * from public.activity_log where actor_id <> auth.uid()$$,
  'member sees only their own activity');
select pg_temp.ok((select count(*) from public.dashboard_department_stats()) = 1,
  'dashboard functions only count visible departments');

-- Writing tasks
select pg_temp.denied($$insert into public.tasks (title, department_id, created_by)
  select 'sneaky', id, auth.uid() from public.departments where slug = 'content'$$,
  'member cannot create a task in another department');
select pg_temp.allowed($$insert into public.tasks (id, title, department_id, created_by, owner_id)
  select '00000000-0000-4000-c000-000000000005', 'T5 my own', id, auth.uid(), auth.uid() from public.departments where slug = 'marketing'$$,
  'member can create a task in own department');
select pg_temp.allowed($$update public.tasks set status = 'done' where id = '00000000-0000-4000-c000-000000000001'$$,
  'member can update a task they own');
select pg_temp.allowed($$update public.tasks set status = 'in_progress' where id = '00000000-0000-4000-c000-000000000004'$$,
  'member can update a task they collaborate on');
select pg_temp.denied($$update public.tasks set status = 'done' where id = '00000000-0000-4000-c000-000000000003'$$,
  'member cannot update a task they are not on');
select pg_temp.denied($$update public.tasks set owner_id = auth.uid() where id = '00000000-0000-4000-c000-000000000004'$$,
  'member cannot reassign a task someone else owns');
select pg_temp.denied($$update public.tasks set department_id = (select id from public.departments where slug = 'content') where id = '00000000-0000-4000-c000-000000000001'$$,
  'member cannot move a task to another department');
select pg_temp.denied($$update public.tasks set deleted_at = now() where id = '00000000-0000-4000-c000-000000000001'$$,
  'member cannot bypass delete_task()');
select pg_temp.denied($$select public.delete_task('00000000-0000-4000-c000-000000000003')$$,
  'member cannot delete a task they did not create');
select pg_temp.ok(public.delete_task('00000000-0000-4000-c000-000000000005'),
  'member can delete a task they created and own');
select pg_temp.ok((select count(*) from public.tasks where id = '00000000-0000-4000-c000-000000000005') = 0,
  'deleted task disappears');
select pg_temp.allowed($$insert into public.task_comments (task_id, author_id, body)
  values ('00000000-0000-4000-c000-000000000003', auth.uid(), 'hello')$$,
  'member can comment on a department task');
select pg_temp.denied($$insert into public.task_comments (task_id, author_id, body)
  values ('00000000-0000-4000-c000-000000000002', auth.uid(), 'hello')$$,
  'member cannot comment on another department''s task');
select pg_temp.denied($$insert into storage.objects (bucket_id, name, owner_id)
  values ('task-attachments', '00000000-0000-4000-c000-000000000002/x.pdf', auth.uid()::text)$$,
  'member cannot upload to another department''s task');

-- Writing other things
select pg_temp.allowed($$insert into public.meetings (department_id, meeting_date, created_by)
  select id, current_date, auth.uid() from public.departments where slug = 'marketing'$$,
  'member can start a meeting in own department');
select pg_temp.denied($$insert into public.meetings (department_id, meeting_date, created_by)
  select id, current_date, auth.uid() from public.departments where slug = 'content'$$,
  'member cannot start a meeting in another department');
select pg_temp.denied($$update public.meetings set minutes = 'x' where id = '00000000-0000-4000-b000-000000000001'$$,
  'member who is not an attendee cannot edit minutes');
select pg_temp.denied($$update public.departments set meeting_weekday = 2 where slug = 'marketing'$$,
  'member cannot change the meeting schedule');
select pg_temp.denied($$update public.profiles set is_admin = true where id = auth.uid()$$,
  'member cannot make themselves admin');
select pg_temp.denied($$insert into public.department_members (department_id, user_id)
  select id, auth.uid() from public.departments where slug = 'content'$$,
  'member cannot join another department');
select pg_temp.denied($$update public.activity_log set action = 'x'$$, 'member cannot edit activity');
select pg_temp.denied($$delete from public.activity_log$$, 'member cannot delete activity');
select pg_temp.denied($$insert into public.activity_log (action, entity_type) values ('fake', 'task')$$,
  'member cannot forge activity');
do $$
begin
  begin
    perform public.log_activity('fake', 'task', null, null, null);
    raise exception 'FAIL: member called log_activity';
  exception when insufficient_privilege then
    raise notice 'ok   - member cannot call log_activity()';
  end;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Content Member: mirror check
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-a000-000000000004', 'rlstest.cmember@highfy.pk');
set local role authenticated;
select pg_temp.ok((select count(*) from public.tasks where title like 'T_ %') = 1,
  'content member sees only content tasks');
select pg_temp.ok((select count(*) from storage.objects where name like '00000000-0000-4000-c000-000000000002/%') = 1,
  'content member can read own department attachments');
select pg_temp.ok((select count(*) from public.activity_log where action = 'task.status_changed') >= 1,
  'member sees their own activity');
reset role;

-- ---------------------------------------------------------------------------
-- Marketing Lead
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-a000-000000000002', 'rlstest.mlead@highfy.pk');
set local role authenticated;
select pg_temp.ok((select count(*) from public.tasks where id = '00000000-0000-4000-c000-000000000002') = 1,
  'lead can read another department''s task');
select pg_temp.ok((select count(*) from public.meetings where id = '00000000-0000-4000-b000-000000000002') = 1,
  'lead can read another department''s meeting');
select pg_temp.denied($$update public.tasks set status = 'done' where id = '00000000-0000-4000-c000-000000000002'$$,
  'lead cannot edit another department''s task');
select pg_temp.denied($$insert into public.tasks (title, department_id, created_by)
  select 'x', id, auth.uid() from public.departments where slug = 'content'$$,
  'lead cannot create tasks in another department');
select pg_temp.denied($$update public.meetings set minutes = 'x' where id = '00000000-0000-4000-b000-000000000002'$$,
  'lead cannot edit another department''s minutes');
select pg_temp.denied($$insert into public.task_comments (task_id, author_id, body)
  values ('00000000-0000-4000-c000-000000000002', auth.uid(), 'hi')$$,
  'lead cannot comment on another department''s task');
select pg_temp.allowed($$update public.tasks set owner_id = '00000000-0000-4000-a000-000000000003' where id = '00000000-0000-4000-c000-000000000004'$$,
  'lead can reassign a task in own department');
select pg_temp.allowed($$insert into public.meetings (department_id, meeting_date, created_by)
  select id, current_date, auth.uid() from public.departments where slug = 'marketing'$$,
  'lead can create a meeting in own department');
select pg_temp.denied($$insert into public.meetings (department_id, meeting_date, created_by)
  select id, current_date, auth.uid() from public.departments where slug = 'content'$$,
  'lead cannot create a meeting in another department');
select pg_temp.allowed($$update public.departments set meeting_weekday = 2, meeting_time = '11:00' where slug = 'marketing'$$,
  'lead can set own department''s meeting schedule');
select pg_temp.denied($$update public.departments set name = 'Renamed' where slug = 'marketing'$$,
  'lead cannot rename a department');
select pg_temp.denied($$update public.departments set meeting_weekday = 3 where slug = 'content'$$,
  'lead cannot change another department''s schedule');
select pg_temp.allowed($$insert into public.department_members (department_id, user_id)
  select id, '00000000-0000-4000-a000-000000000004' from public.departments where slug = 'marketing'$$,
  'lead can add a member to own department');
select pg_temp.denied($$insert into public.department_members (department_id, user_id, role)
  select id, '00000000-0000-4000-a000-000000000006', 'lead' from public.departments where slug = 'content'$$,
  'lead cannot add people to another department');
select pg_temp.denied($$update public.department_members set role = 'lead' where user_id = '00000000-0000-4000-a000-000000000003'$$,
  'lead cannot promote someone to lead');
select pg_temp.ok((select count(*) from public.activity_log where actor_id = '00000000-0000-4000-a000-000000000003') >= 1,
  'lead sees activity in own department');
select pg_temp.denied($$select * from public.activity_log where department_id = (select id from public.departments where slug = 'content')$$,
  'lead cannot see another department''s activity');
reset role;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-a000-000000000001', 'rlstest.admin@highfy.pk');
set local role authenticated;
select pg_temp.ok((select count(*) from public.tasks where title like 'T_ %') = 4, 'admin sees every task');
select pg_temp.ok((select count(*) from public.meetings where id::text like '00000000-0000-4000-b000-%') = 2, 'admin sees every meeting');
select pg_temp.ok((select count(*) from public.activity_log where actor_id in (
  '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000004')) >= 2, 'admin sees all activity');
select pg_temp.allowed($$update public.profiles set status = 'active' where email = 'rlstest.pending@highfy.pk'$$,
  'admin can approve a pending user');
select pg_temp.allowed($$update public.departments set name = 'Content & Copy' where slug = 'content'$$,
  'admin can rename a department');
select pg_temp.ok(public.delete_task('00000000-0000-4000-c000-000000000002'), 'admin can delete any task');
select pg_temp.denied($$delete from public.activity_log$$, 'even admin cannot delete activity');
reset role;

-- ---------------------------------------------------------------------------
-- Activity log content
-- ---------------------------------------------------------------------------

select pg_temp.ok(exists (select 1 from public.activity_log
  where action = 'task.completed' and task_id = '00000000-0000-4000-c000-000000000001'
    and actor_id = '00000000-0000-4000-a000-000000000003'), 'completion is logged with the actor');
select pg_temp.ok(exists (select 1 from public.activity_log
  where action = 'task.reassigned' and task_id = '00000000-0000-4000-c000-000000000004'
    and old_value ->> 'owner_id' = '00000000-0000-4000-a000-000000000006'
    and new_value ->> 'owner_id' = '00000000-0000-4000-a000-000000000003'), 'reassignment logs old and new owner');
select pg_temp.ok(exists (select 1 from public.activity_log
  where action = 'task.deleted' and task_id = '00000000-0000-4000-c000-000000000002'), 'deletion is logged');
select pg_temp.ok(exists (select 1 from public.activity_log where action = 'comment.added'), 'comments are logged');
select pg_temp.ok(exists (select 1 from public.activity_log where action = 'meeting.created'), 'meetings are logged');
select pg_temp.ok(exists (select 1 from public.activity_log where action = 'membership.added'
  and subject_user_id = '00000000-0000-4000-a000-000000000004'), 'membership changes are logged');
do $$
begin
  begin
    update public.activity_log set action = 'tampered';
    raise exception 'FAIL: activity log was editable by the database owner';
  exception when insufficient_privilege then
    raise notice 'ok   - activity log is immutable even for the database owner';
  end;
end $$;

-- Meeting action items
insert into public.tasks (title, department_id, meeting_id, owner_id)
select 'Action item', department_id, id, '00000000-0000-4000-a000-000000000003'
  from public.meetings where id = '00000000-0000-4000-b000-000000000001';
select pg_temp.ok((select source from public.tasks where title = 'Action item') = 'meeting',
  'action items get Source = Meeting');
select pg_temp.ok(exists (select 1 from public.activity_log where action = 'meeting.action_item_added'),
  'action items are logged against the meeting');
select pg_temp.login('00000000-0000-4000-a000-000000000002', 'rlstest.mlead@highfy.pk');
set local role authenticated;
select pg_temp.denied($$insert into public.tasks (title, department_id, meeting_id, created_by)
  select 'x', (select id from public.departments where slug = 'marketing'), '00000000-0000-4000-b000-000000000002', auth.uid()$$,
  'action items must belong to the meeting''s department');
reset role;

-- ---------------------------------------------------------------------------
-- Meeting attendees write minutes
-- ---------------------------------------------------------------------------

insert into public.meeting_attendees (meeting_id, user_id) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000003'),  -- Marketing Member
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000005');  -- no department

select pg_temp.login('00000000-0000-4000-a000-000000000006', 'rlstest.mmember2@highfy.pk');
set local role authenticated;
select pg_temp.denied($$update public.meetings set minutes = 'x' where id = '00000000-0000-4000-b000-000000000001'$$,
  'department member who did not attend cannot edit minutes');
reset role;

select pg_temp.login('00000000-0000-4000-a000-000000000003', 'rlstest.mmember@highfy.pk');
set local role authenticated;
select pg_temp.allowed($$update public.meetings set minutes = '<p>Attendee notes</p>', decisions = array['Go'] where id = '00000000-0000-4000-b000-000000000001'$$,
  'attendee can write minutes');
select pg_temp.allowed($$insert into public.task_comments (task_id, author_id, body)
  select id, auth.uid(), 'from attendee' from public.tasks where title = 'Action item'$$,
  'attendee can comment on an action item');
select pg_temp.allowed($$insert into public.tasks (title, department_id, meeting_id, owner_id, created_by)
  select 'Attendee action item', department_id, id, '00000000-0000-4000-a000-000000000006', auth.uid()
    from public.meetings where id = '00000000-0000-4000-b000-000000000001'$$,
  'attendee can add action items');
select pg_temp.allowed($$update public.tasks set owner_id = '00000000-0000-4000-a000-000000000002' where title = 'Attendee action item'$$,
  'attendee can reassign an action item from their meeting');
select pg_temp.denied($$update public.tasks set owner_id = auth.uid() where id = '00000000-0000-4000-c000-000000000003'$$,
  'attendee still cannot reassign unrelated tasks');
select pg_temp.denied($$delete from public.meetings where id = '00000000-0000-4000-b000-000000000001'$$,
  'attendee cannot delete the meeting');
select pg_temp.denied($$update public.meetings set department_id = (select id from public.departments where slug = 'content') where id = '00000000-0000-4000-b000-000000000001'$$,
  'attendee cannot move the meeting to another department');
reset role;

select pg_temp.login('00000000-0000-4000-a000-000000000005', 'rlstest.pending@highfy.pk');
set local role authenticated;
select pg_temp.ok((select count(*) from public.meetings where id = '00000000-0000-4000-b000-000000000001') = 1,
  'attendee from outside the department can open the meeting');
select pg_temp.allowed($$update public.meetings set agenda = 'Guest agenda' where id = '00000000-0000-4000-b000-000000000001'$$,
  'attendee from outside the department can edit minutes');
select pg_temp.denied($$select * from public.meetings where id = '00000000-0000-4000-b000-000000000002'$$,
  'outside attendee still cannot see other meetings');
select pg_temp.denied($$select * from public.tasks where id = '00000000-0000-4000-c000-000000000001'$$,
  'outside attendee still cannot see the department''s other tasks');
reset role;

-- Start date
do $$
begin
  begin
    update public.tasks set start_date = due_date + 1 where due_date is not null and title = 'T1 marketing task';
    update public.tasks set start_date = '2026-01-10', due_date = '2026-01-05' where id = '00000000-0000-4000-c000-000000000001';
    raise exception 'FAIL: start date after due date was accepted';
  exception when check_violation then
    raise notice 'ok   - start date cannot be after due date';
  end;
end $$;
update public.tasks set start_date = '2026-01-01', due_date = '2026-01-05' where id = '00000000-0000-4000-c000-000000000001';
select pg_temp.ok(exists (select 1 from public.activity_log where action = 'task.edited'
  and task_id = '00000000-0000-4000-c000-000000000001' and new_value ? 'start_date'), 'start date changes are logged');

select 'ALL RLS TESTS PASSED' as result;

rollback;
