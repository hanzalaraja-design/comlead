-- The partnerships list shows each one's current status and dates; tags can be renamed.
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
  ('00000000-0000-4000-d200-000000000001', 'pltest2.one@highfy.pk', '{"full_name":"Pia One"}'),
  ('00000000-0000-4000-d200-000000000002', 'pltest2.out@highfy.pk', '{"full_name":"Ozzy Out"}');
update public.profiles set status = 'active' where email like 'pltest2.%';
insert into public.projects (id, name, slug, kind, categories, created_by) values
  ('00000000-0000-4000-d210-000000000001', 'Zongy', 'zongy-pl', 'partnership', '{referral}', '00000000-0000-4000-d200-000000000001'),
  ('00000000-0000-4000-d210-000000000002', 'Newco', 'newco-pl', 'partnership', '{fintech}', '00000000-0000-4000-d200-000000000001');
insert into public.project_parts (project_id, kind, name, stage, starts_on, ends_on) values
  ('00000000-0000-4000-d210-000000000001', 'term', '2025', 'ended', '2025-01-01', '2025-12-31'),
  ('00000000-0000-4000-d210-000000000001', 'term', '2026', 'live', '2026-01-01', '2026-11-30'),
  ('00000000-0000-4000-d210-000000000001', 'term', '2027', 'in_talks', '2027-01-01', null);

select pg_temp.login('00000000-0000-4000-d200-000000000002');
set local role authenticated;
select pg_temp.ok((select term_stage = 'live' and term_starts = '2026-01-01' and term_ends = '2026-11-30' and not can_open
                     from public.partnership_directory() where slug = 'zongy-pl'), 'the list shows the live term, even to someone outside it');
select pg_temp.ok((select term_stage is null from public.partnership_directory() where slug = 'newco-pl'), 'no terms: no status yet');
update public.partnership_tags set name = 'BNPL plans', color = 'teal' where name = 'BNPL';
select pg_temp.ok(exists (select 1 from public.partnership_tags where name = 'BNPL plans' and color = 'teal'), 'anyone can rename or recolour a tag');
reset role;

rollback;
