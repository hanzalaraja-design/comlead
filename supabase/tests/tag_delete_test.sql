-- Deleting a partnership tag: anyone can, and it comes off every partnership.
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
  ('00000000-0000-4000-d500-0000000000a1', 'tdtest.one@highfy.pk', '{"full_name":"Tia One"}');
update public.profiles set status = 'active' where email like 'tdtest.%';
insert into public.projects (id, name, slug, kind, categories) values ('00000000-0000-4000-d500-0000000000b1', 'Zong', 'zong-td', 'partnership', '{fintech}');
insert into public.project_tags (project_id, tag_id) select '00000000-0000-4000-d500-0000000000b1', id from public.partnership_tags where name = 'BNPL';

select pg_temp.login('00000000-0000-4000-d500-0000000000a1');
set local role authenticated;
delete from public.partnership_tags where name = 'BNPL';
select pg_temp.ok(not exists (select 1 from public.partnership_tags where name = 'BNPL'), 'anyone can delete a tag');
reset role;
select pg_temp.ok(not exists (select 1 from public.project_tags where project_id = '00000000-0000-4000-d500-0000000000b1'), 'and it comes off the partnerships it was on');

set local role anon;
select pg_temp.denied($$delete from public.partnership_tags$$, 'signed-out visitors cannot delete tags');
reset role;

rollback;
