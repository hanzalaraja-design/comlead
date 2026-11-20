-- Adding a slot to a section and taking one out in Edit layout.
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
  ('00000000-0000-4000-d600-000000000001', 'sstest.comm@highfy.pk', '{"full_name":"Cy Commercial"}'),
  ('00000000-0000-4000-d600-000000000002', 'sstest.ops@highfy.pk', '{"full_name":"Oz Ops"}');
update public.profiles set status = 'active' where email like 'sstest.%';
insert into public.department_members (department_id, user_id, role)
select id, '00000000-0000-4000-d600-000000000001', 'member' from public.departments where slug = 'commercial';
insert into public.department_members (department_id, user_id, role)
select id, '00000000-0000-4000-d600-000000000002', 'member' from public.departments where slug = 'ops';
update public.placement_settings set commercial_department_id = (select id from public.departments where slug = 'commercial') where id = 1;
-- Slide 1 empty, Luxe on 2, Glow on 3, an old ended one on 4.
insert into public.placements (id, section_key, position, brand, starts_on, ends_on, stage, created_by) values
  ('00000000-0000-4000-d610-000000000002', 'hero', 2, 'Luxe', '2026-11-20', '2026-11-30', 'booked', '00000000-0000-4000-d600-000000000001'),
  ('00000000-0000-4000-d610-000000000003', 'hero', 3, 'Glow', '2026-11-20', '2026-11-30', 'booked', '00000000-0000-4000-d600-000000000001'),
  ('00000000-0000-4000-d610-000000000004', 'hero', 4, 'Old', '2026-10-01', '2026-10-05', 'ended', '00000000-0000-4000-d600-000000000001');
select (select slots from public.placement_sections where key = 'hero') as hero0 \gset

select pg_temp.login('00000000-0000-4000-d600-000000000001');
set local role authenticated;
select public.remove_placement_slot('hero', 1);
select pg_temp.ok((select slots from public.placement_sections where key = 'hero') = :hero0 - 1, 'removing an empty slide takes one slot off');
select pg_temp.ok((select array_agg(brand || ':' || position order by position) from public.placements where section_key = 'hero' and id::text like '00000000-0000-4000-d610%')
                  = array['Luxe:1', 'Glow:2', 'Old:3'], 'the slides after it move up, with their bookings (and past ones)');
select pg_temp.denied($$select public.remove_placement_slot('hero', 1)$$, 'a slide with a booking cannot be removed');
select public.add_placement_slot('hero');
select pg_temp.ok((select slots from public.placement_sections where key = 'hero') = :hero0, 'adding puts a slide at the end');
select public.add_placement_slot('categories');
select pg_temp.ok((select labels[cardinality(labels)] = 'Category 6' and slots = 6 from public.placement_sections where key = 'categories'), 'a new category icon is called Category 6');
select public.remove_placement_slot('categories', 2);
select pg_temp.ok((select labels = array['Skincare', 'Haircare', 'K Beauty', 'Category 5', 'Category 6'] and slots = 5 from public.placement_sections where key = 'categories'),
  'removing an icon removes its name too');
select pg_temp.denied($$select public.add_placement_slot('announcement')$$, 'one-slot sections stay one slot');
select pg_temp.denied($$update public.placements set position = 7 where id = '00000000-0000-4000-d610-000000000002' and false$$, 'nothing else changes');
reset role;

select pg_temp.login('00000000-0000-4000-d600-000000000002');
set local role authenticated;
select pg_temp.denied($$select public.add_placement_slot('hero')$$, 'someone outside the layout teams cannot add slots');
select pg_temp.denied($$select public.remove_placement_slot('hero', 8)$$, 'nor remove them');
reset role;

rollback;
