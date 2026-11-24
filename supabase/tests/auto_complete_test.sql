-- A task is marked done when its last open subtask is done.
-- Rolled back at the end.

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

insert into public.departments (id, name, slug, sort_order) values ('00000000-0000-4000-d400-0000000000aa', 'Auto team', 'auto-team', 95);
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-d400-000000000001', 'actest.owner@highfy.pk', '{"full_name":"Ola Owner"}'),
  ('00000000-0000-4000-d400-000000000002', 'actest.helper@highfy.pk', '{"full_name":"Hal Helper"}');
update public.profiles set status = 'active' where email like 'actest.%';
insert into public.department_members (department_id, user_id, role) values
  ('00000000-0000-4000-d400-0000000000aa', '00000000-0000-4000-d400-000000000001', 'member');
-- A locked main task owned by Ola, with three subtasks; Hal owns one.
insert into public.tasks (id, title, department_id, owner_id, created_by, locked) values
  ('00000000-0000-4000-d410-000000000001', 'Launch', '00000000-0000-4000-d400-0000000000aa', '00000000-0000-4000-d400-000000000001', '00000000-0000-4000-d400-000000000001', true);
insert into public.tasks (id, title, parent_task_id, owner_id, created_by) values
  ('00000000-0000-4000-d410-000000000002', 'Copy', '00000000-0000-4000-d410-000000000001', '00000000-0000-4000-d400-000000000001', '00000000-0000-4000-d400-000000000001'),
  ('00000000-0000-4000-d410-000000000003', 'Banner', '00000000-0000-4000-d410-000000000001', '00000000-0000-4000-d400-000000000002', '00000000-0000-4000-d400-000000000001'),
  ('00000000-0000-4000-d410-000000000004', 'Old idea', '00000000-0000-4000-d410-000000000001', '00000000-0000-4000-d400-000000000001', '00000000-0000-4000-d400-000000000001');

select pg_temp.login('00000000-0000-4000-d400-000000000001');
set local role authenticated;
update public.tasks set status = 'done' where id = '00000000-0000-4000-d410-000000000002';
select pg_temp.ok((select status::text from public.tasks where id = '00000000-0000-4000-d410-000000000001') <> 'done', 'one subtask done: the task stays open');
update public.tasks set status = 'cancelled' where id = '00000000-0000-4000-d410-000000000004';
select pg_temp.ok((select status::text from public.tasks where id = '00000000-0000-4000-d410-000000000001') <> 'done', 'a cancelled one does not finish it while another is open');
reset role;

-- Hal finishes the last one, though he can't change the locked main task himself.
select pg_temp.login('00000000-0000-4000-d400-000000000002');
set local role authenticated;
update public.tasks set status = 'done' where id = '00000000-0000-4000-d410-000000000003';
reset role;
select pg_temp.ok((select status::text = 'done' and completed_at is not null from public.tasks where id = '00000000-0000-4000-d410-000000000001'),
  'the last subtask done marks the main task done');
select pg_temp.ok(exists (select 1 from public.activity_log where task_id = '00000000-0000-4000-d410-000000000001' and action = 'task.completed'
                          and actor_id = '00000000-0000-4000-d400-000000000002'), 'recorded as finished by whoever finished the last subtask');

-- Reopening a subtask leaves the main task done.
select pg_temp.login('00000000-0000-4000-d400-000000000002');
set local role authenticated;
update public.tasks set status = 'todo' where id = '00000000-0000-4000-d410-000000000003';
reset role;
select pg_temp.ok((select status::text = 'done' from public.tasks where id = '00000000-0000-4000-d410-000000000001'), 'reopening a subtask leaves the main task done');

-- A task whose only subtask is cancelled is not finished.
insert into public.tasks (id, title, department_id, owner_id, created_by) values
  ('00000000-0000-4000-d410-000000000011', 'Solo', '00000000-0000-4000-d400-0000000000aa', '00000000-0000-4000-d400-000000000001', '00000000-0000-4000-d400-000000000001');
insert into public.tasks (id, title, parent_task_id, owner_id, created_by) values
  ('00000000-0000-4000-d410-000000000012', 'Maybe', '00000000-0000-4000-d410-000000000011', '00000000-0000-4000-d400-000000000001', '00000000-0000-4000-d400-000000000001');
select pg_temp.login('00000000-0000-4000-d400-000000000001');
set local role authenticated;
update public.tasks set status = 'cancelled' where id = '00000000-0000-4000-d410-000000000012';
reset role;
select pg_temp.ok((select status::text <> 'done' from public.tasks where id = '00000000-0000-4000-d410-000000000011'), 'all subtasks cancelled does not finish the task');

rollback;
