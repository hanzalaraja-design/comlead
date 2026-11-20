-- Linking a homepage booking to a partnership adds a done task to it.
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

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-d700-000000000001', 'bltest.booker@highfy.pk', '{"full_name":"Bo Booker"}'),
  ('00000000-0000-4000-d700-000000000002', 'bltest.out@highfy.pk', '{"full_name":"Oli Outside"}');
update public.profiles set status = 'active' where email like 'bltest.%';
insert into public.department_members (department_id, user_id, role)
select id, '00000000-0000-4000-d700-000000000001', 'member' from public.departments where slug = 'commercial';
update public.placement_settings set commercial_department_id = (select id from public.departments where slug = 'commercial') where id = 1;
insert into public.projects (id, name, slug, kind, created_by) values
  ('00000000-0000-4000-d800-000000000001', 'Yeylo', 'yeylo-test', 'partnership', '00000000-0000-4000-d700-000000000001');
insert into public.project_members (project_id, user_id, role) values ('00000000-0000-4000-d800-000000000001', '00000000-0000-4000-d700-000000000001', 'lead');

select pg_temp.login('00000000-0000-4000-d700-000000000001');
set local role authenticated;
insert into public.placements (id, section_key, position, brand, starts_on, ends_on, shows_on, created_by, project_id)
values ('00000000-0000-4000-d900-000000000001', 'hero', 2, 'Yeylo', '2026-11-24', '2026-11-30', '{web,app}', auth.uid(), '00000000-0000-4000-d800-000000000001');
select pg_temp.ok((select count(*) from public.tasks where project_id = '00000000-0000-4000-d800-000000000001'
                    and title = 'Book homepage placement for Yeylo: Hero carousel, slide 2 (Website + App)' and status = 'done') = 1,
  'booking linked to Yeylo adds a done task to it');
select pg_temp.ok((select owner_id = auth.uid() and due_date = '2026-11-24' and description like '%/placements?open=00000000-0000-4000-d900-000000000001%'
                     from public.tasks where project_id = '00000000-0000-4000-d800-000000000001'), 'owned by the booker, dated the start, linking to the booking');
update public.placements set project_id = null where id = '00000000-0000-4000-d900-000000000001';
update public.placements set project_id = '00000000-0000-4000-d800-000000000001' where id = '00000000-0000-4000-d900-000000000001';
select pg_temp.ok((select count(*) from public.tasks where project_id = '00000000-0000-4000-d800-000000000001') = 1, 'linking again does not add a second task');
insert into public.placements (id, section_key, position, brand, starts_on, created_by)
values ('00000000-0000-4000-d900-000000000002', 'hero', 3, 'Glow', '2026-11-24', auth.uid());
select pg_temp.ok((select count(*) from public.tasks where title like '%Glow%') = 0, 'a booking with no link adds no task');
reset role;

-- Someone not in Yeylo cannot link to it.
select pg_temp.login('00000000-0000-4000-d700-000000000002');
set local role authenticated;
select pg_temp.denied($$insert into public.placements (section_key, position, brand, starts_on, created_by, project_id)
  values ('hero', 4, 'Sneaky', '2026-11-24', auth.uid(), '00000000-0000-4000-d800-000000000001')$$, 'you can only link to something you are in');
reset role;

rollback;
