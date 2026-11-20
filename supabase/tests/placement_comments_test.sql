-- Placements: the booking link, comments and history. Rolled back at the end.

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
  ('00000000-0000-4000-bb00-000000000001', 'pltest.booker@highfy.pk', '{"full_name":"Bo Booker"}'),
  ('00000000-0000-4000-bb00-000000000002', 'pltest.other@highfy.pk', '{"full_name":"Ola Other"}'),
  ('00000000-0000-4000-bb00-000000000003', 'pltest.pending@highfy.pk', '{"full_name":"Pat Pending"}');
update public.profiles set status = 'active' where email in ('pltest.booker@highfy.pk', 'pltest.other@highfy.pk');

select pg_temp.login('00000000-0000-4000-bb00-000000000001');
set local role authenticated;
insert into public.placements (id, section_key, position, brand, starts_on, created_by, link)
values ('00000000-0000-4000-bc00-000000000001', 'hero', 6, 'Luxe Skin', public.pkt_today(), auth.uid(), 'https://highfy.pk/collections/luxe');
select pg_temp.ok((select link from public.placements where id = '00000000-0000-4000-bc00-000000000001') = 'https://highfy.pk/collections/luxe', 'a booking keeps its link');
select pg_temp.denied($$update public.placements set link = 'javascript:alert(1)' where id = '00000000-0000-4000-bc00-000000000001'$$, 'only web links are allowed');
update public.placements set ends_on = public.pkt_today() + 7 where id = '00000000-0000-4000-bc00-000000000001';
reset role;

select pg_temp.login('00000000-0000-4000-bb00-000000000002');
set local role authenticated;
insert into public.placement_comments (placement_id, body) values ('00000000-0000-4000-bc00-000000000001', 'Can we use the pink banner?');
select pg_temp.ok((select count(*) from public.activity_log where entity_type = 'placement' and entity_id = '00000000-0000-4000-bc00-000000000001') >= 3,
  'anyone who sees the booking sees its history (booked, dates, comment)');
select pg_temp.denied($$delete from public.placement_comments where author_id <> auth.uid()$$, 'nobody removes someone else''s comment');
reset role;

select pg_temp.login('00000000-0000-4000-bb00-000000000001');
set local role authenticated;
select pg_temp.ok((select count(*) from public.notifications where title = 'Ola Other commented on Luxe Skin') = 1, 'whoever booked it is told about the comment');
select pg_temp.ok((select count(*) from public.placement_comments where placement_id = '00000000-0000-4000-bc00-000000000001') = 1, 'and sees it');
reset role;

select pg_temp.login('00000000-0000-4000-bb00-000000000003');
set local role authenticated;
select pg_temp.ok((select count(*) from public.placement_comments) = 0, 'someone not approved yet sees no comments');
select pg_temp.denied($$insert into public.placement_comments (placement_id, body) values ('00000000-0000-4000-bc00-000000000001', 'hi')$$, 'nor adds one');
reset role;

select 'ALL PLACEMENT COMMENT TESTS PASSED' as result;
rollback;
