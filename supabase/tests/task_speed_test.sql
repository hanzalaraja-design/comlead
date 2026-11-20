-- Deadline-move counter on tasks and the one-check task history.
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

insert into public.departments (id, name, slug, sort_order) values ('00000000-0000-4000-d300-0000000000aa', 'Speed team', 'speed-team', 92);
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-d400-000000000001', 'sptest.member@highfy.pk', '{"full_name":"Sam Member"}'),
  ('00000000-0000-4000-d400-000000000002', 'sptest.out@highfy.pk', '{"full_name":"Oli Outside"}');
update public.profiles set status = 'active' where email like 'sptest.%';
insert into public.department_members (department_id, user_id, role) values ('00000000-0000-4000-d300-0000000000aa', '00000000-0000-4000-d400-000000000001', 'member');
insert into public.tasks (id, title, department_id, due_date, created_by) values
  ('00000000-0000-4000-d500-000000000001', 'Speed task', '00000000-0000-4000-d300-0000000000aa', '2026-11-17', '00000000-0000-4000-d400-000000000001');

select pg_temp.login('00000000-0000-4000-d400-000000000001');
set local role authenticated;
update public.tasks set due_date = '2026-11-19' where id = '00000000-0000-4000-d500-000000000001';
update public.tasks set due_date = '2026-11-18' where id = '00000000-0000-4000-d500-000000000001';
update public.tasks set due_date = '2026-11-21' where id = '00000000-0000-4000-d500-000000000001';
select pg_temp.ok((select due_moves = 2 and first_due_date = '2026-11-17' from public.tasks where id = '00000000-0000-4000-d500-000000000001'), 'pushing later counts, pulling earlier does not');
update public.tasks set due_moves = 0, first_due_date = null where id = '00000000-0000-4000-d500-000000000001';
select pg_temp.ok((select due_moves = 2 and first_due_date = '2026-11-17' from public.tasks where id = '00000000-0000-4000-d500-000000000001'), 'nobody can reset the count');
select pg_temp.ok((select count(*) from public.task_history('00000000-0000-4000-d500-000000000001')) >= 4, 'the team sees the task history');
select pg_temp.ok((select count(*) from public.task_history('00000000-0000-4000-d500-000000000001', 2)) = 2, 'the limit works');
reset role;

select pg_temp.login('00000000-0000-4000-d400-000000000002');
set local role authenticated;
select pg_temp.ok((select count(*) from public.task_history('00000000-0000-4000-d500-000000000001')) = 0, 'someone outside the team sees no history');
reset role;

set local role anon;
select pg_temp.denied($$select * from public.task_history('00000000-0000-4000-d500-000000000001')$$, 'signed-out visitors cannot call it');
reset role;

rollback;
