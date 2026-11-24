-- Follow-up meetings remember the meeting they follow.
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

insert into public.departments (id, name, slug, sort_order) values ('00000000-0000-4000-d300-0000000000fa', 'Follow team', 'follow-team', 96);
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-d300-000000000001', 'futest.one@highfy.pk', '{"full_name":"Fay One"}');
update public.profiles set status = 'active' where email like 'futest.%';
insert into public.department_members (department_id, user_id, role) values ('00000000-0000-4000-d300-0000000000fa', '00000000-0000-4000-d300-000000000001', 'member');
insert into public.meetings (id, department_id, title, meeting_date, created_by) values
  ('00000000-0000-4000-d310-000000000001', '00000000-0000-4000-d300-0000000000fa', 'Zong review', '2026-11-20', '00000000-0000-4000-d300-000000000001');

select pg_temp.login('00000000-0000-4000-d300-000000000001');
set local role authenticated;
insert into public.meeting_series (id, title, department_id, frequency, start_date, meeting_time, created_by, follow_up_of)
values ('00000000-0000-4000-d320-000000000001', 'Follow-up: Zong review', '00000000-0000-4000-d300-0000000000fa', 'once', '2026-11-27', '11:00',
        '00000000-0000-4000-d300-000000000001', '00000000-0000-4000-d310-000000000001');
select pg_temp.ok((select follow_up_of = '00000000-0000-4000-d310-000000000001' from public.meeting_series where id = '00000000-0000-4000-d320-000000000001'),
  'a follow-up remembers its main meeting');
select pg_temp.ok((select count(*) from public.meeting_series where follow_up_of = '00000000-0000-4000-d310-000000000001') = 1, 'and the main meeting finds its follow-ups');
select public.open_series_meeting('00000000-0000-4000-d320-000000000001', '2026-11-27');
select pg_temp.ok((select count(*) from public.meetings where series_id = '00000000-0000-4000-d320-000000000001') = 1, 'opening the follow-up makes its meeting');
reset role;

rollback;
