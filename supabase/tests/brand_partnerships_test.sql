-- Brand partnerships: categories, tags, the shared list, terms (parts) and
-- comments. Rolled back at the end; a failed check raises "FAIL: ...".

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
  ('00000000-0000-4000-b400-000000000001', 'bptest.bilal@highfy.pk', '{"full_name":"Bilal Owner"}'),
  ('00000000-0000-4000-b400-000000000002', 'bptest.out@highfy.pk', '{"full_name":"Olivia Outside"}');
update public.profiles set status = 'active' where email like 'bptest.%';

-- Bilal starts a partnership (and so owns it).
select pg_temp.login('00000000-0000-4000-b400-000000000001');
set local role authenticated;
insert into public.projects (id, name, slug, kind, category, created_by)
values ('00000000-0000-4000-b500-000000000001', 'Zong', 'zong-bp-test', 'partnership', 'referral', auth.uid());
select pg_temp.denied($$update public.projects set category = 'beauty' where id = '00000000-0000-4000-b500-000000000001'$$, 'the old Beauty category is gone');
select pg_temp.ok((select count(*) from public.partnership_tags where category = 'referral') >= 2, 'Referral starts with its tags');
insert into public.project_tags (project_id, tag_id)
select '00000000-0000-4000-b500-000000000001', id from public.partnership_tags where name = 'Discount + commission';

insert into public.project_parts (id, project_id, kind, name, stage, starts_on, ends_on, fields)
values ('00000000-0000-4000-b600-000000000001', '00000000-0000-4000-b500-000000000001', 'term', 'Nov to Dec 2026', 'live', '2026-11-01', '2026-12-31',
        '[{"label":"Discount","value":"15% off"}]');
insert into public.project_parts (project_id, kind, name, stage, renewed_from)
values ('00000000-0000-4000-b500-000000000001', 'term', '2027', 'in_talks', '00000000-0000-4000-b600-000000000001');
select pg_temp.denied($$insert into public.project_parts (project_id, kind, name, stage) values ('00000000-0000-4000-b500-000000000001', 'term', 'Bad', 'idea')$$,
  'a term only takes term stages');
update public.project_parts set stage = 'agreed' where name = '2027';
insert into public.project_comments (project_id, body) values ('00000000-0000-4000-b500-000000000001', 'Zong wants 20%');
select pg_temp.ok((select count(*) from public.activity_log where entity_type = 'term' and new_value ->> 'project_id' = '00000000-0000-4000-b500-000000000001') >= 3,
  'term changes are in the history');
reset role;

-- Olivia isn't in it.
select pg_temp.login('00000000-0000-4000-b400-000000000002');
set local role authenticated;
select pg_temp.ok((select count(*) from public.projects where id = '00000000-0000-4000-b500-000000000001') = 0, 'Olivia cannot open the partnership');
select pg_temp.ok((select count(*) from public.partnership_directory() where slug = 'zong-bp-test' and not can_open and owner = 'Bilal Owner' and category = 'referral') = 1,
  'but she sees it in the list, with its owner and category');
select pg_temp.ok((select count(*) from public.project_tags where project_id = '00000000-0000-4000-b500-000000000001') = 1, 'and its tags');
select pg_temp.ok((select count(*) from public.project_parts) = 0, 'not its terms');
select pg_temp.ok((select count(*) from public.project_comments) = 0, 'not its comments');
select pg_temp.ok((select count(*) from public.activity_log where new_value ->> 'project_id' = '00000000-0000-4000-b500-000000000001') = 0, 'not its history');
select pg_temp.denied($$insert into public.project_parts (project_id, kind, name) values ('00000000-0000-4000-b500-000000000001', 'term', 'Sneaky')$$, 'she cannot add a term');
select pg_temp.denied($$update public.project_parts set name = 'x'$$, 'she cannot edit a term');
select pg_temp.denied($$delete from public.project_tags where project_id = '00000000-0000-4000-b500-000000000001'$$, 'she cannot change its tags');
select pg_temp.denied($$insert into public.project_comments (project_id, body) values ('00000000-0000-4000-b500-000000000001', 'hi')$$, 'she cannot comment');
insert into public.partnership_tags (category, name, color) values ('associations', 'Trade body', 'teal');
select pg_temp.ok((select count(*) from public.partnership_tags where name = 'Trade body') = 1, 'anyone can create a tag');
select pg_temp.denied($$insert into public.partnership_tags (category, name) values ('associations', 'trade body ')$$, 'no duplicate tag names in a category');
reset role;

-- Bilal adds Olivia by hand: now she sees and edits the terms.
insert into public.project_members (project_id, user_id, role) values ('00000000-0000-4000-b500-000000000001', '00000000-0000-4000-b400-000000000002', 'member');
select pg_temp.login('00000000-0000-4000-b400-000000000002');
set local role authenticated;
select pg_temp.ok((select count(*) from public.project_parts) = 2, 'once in it, she sees both terms');
select pg_temp.ok((select count(*) from public.notifications where kind = 'comment') = 0, 'no notification for an older comment');
update public.project_parts set fields = '[{"label":"Discount","value":"20% off"}]' where name = '2027';
select pg_temp.ok((select fields -> 0 ->> 'value' from public.project_parts where name = '2027') = '20% off', 'and can edit them');
insert into public.project_comments (project_id, body) values ('00000000-0000-4000-b500-000000000001', 'Draft sent');
reset role;

select pg_temp.login('00000000-0000-4000-b400-000000000001');
set local role authenticated;
select pg_temp.ok((select count(*) from public.notifications where kind = 'comment' and title like 'Olivia Outside commented on Zong') = 1, 'Bilal hears about her comment');
reset role;

select 'ALL BRAND PARTNERSHIP TESTS PASSED' as result;
rollback;
