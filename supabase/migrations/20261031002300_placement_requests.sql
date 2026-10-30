-- Placements, round 2.
--
--  1. App / Website: a booking shows on the website, the app, or both, and
--     Tech makes it live on each. Anyone can ask for a slot.
--  2. Creative requests: Social, Ads, CRM and Partnerships ask Design for
--     what they need, optionally linked to a campaign, project or partnership.
--     Design takes them, sends them for review, and the asker approves and
--     marks them live.

-- ---------------------------------------------------------------------------
-- Who's in which placement team (for real; Admins aren't in a team)
-- ---------------------------------------------------------------------------

create or replace function public.in_placement_team(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and exists (
    select 1
      from public.placement_settings s
      cross join lateral (values
        ('commercial', s.commercial_department_id),
        ('design', s.design_department_id),
        ('tech', s.tech_department_id)) as r(role, department_id)
      join public.department_members m on m.department_id = r.department_id and m.user_id = auth.uid()
     where r.role = p_role);
$$;

-- Everyone can book a slot now; Design and Tech are still their teams.
create or replace function public.placement_roles()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_admin() then array['commercial', 'design', 'tech']
    when not public.is_active_user() then '{}'::text[]
    else array['commercial']
         || case when public.in_placement_team('design') then array['design'] else '{}'::text[] end
         || case when public.in_placement_team('tech') then array['tech'] else '{}'::text[] end
  end;
$$;

grant execute on function public.in_placement_team(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. App / Website
-- ---------------------------------------------------------------------------

alter table public.placements add column if not exists shows_on text[] not null default '{web}';
alter table public.placements add column if not exists live_on text[] not null default '{}';
alter table public.placements drop constraint if exists placements_shows_on_check;
alter table public.placements add constraint placements_shows_on_check
  check (cardinality(shows_on) between 1 and 2 and shows_on <@ array['web', 'app']);
alter table public.placements drop constraint if exists placements_live_on_check;
alter table public.placements add constraint placements_live_on_check check (live_on <@ array['web', 'app']);

-- Already live: live on the website.
update public.placements set live_on = '{web}' where stage = 'live' and live_on = '{}';

-- Who may change a booking: whoever made it, the Commercial team, or an Admin.
create or replace function public.can_edit_placement(p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or (public.is_active_user() and p_created_by = auth.uid())
      or public.in_placement_team('commercial');
$$;

grant execute on function public.can_edit_placement(uuid) to authenticated;

drop policy if exists placements_delete on public.placements;
create policy placements_delete on public.placements
  for delete to authenticated
  using (public.can_edit_placement(created_by) and stage in ('booked', 'ready'));

create or replace function public.placements_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  -- Live once it's live everywhere it shows.
  if new.live_on is distinct from old.live_on and new.stage = 'ready' and new.shows_on <@ new.live_on then
    new.stage := 'live';
  end if;
  if new.stage = 'live' and old.stage is distinct from 'live' then
    new.live_at := now();
    new.live_on := new.shows_on;
  end if;
  if new.stage = 'ended' and old.stage is distinct from 'ended' then new.ended_at := now(); end if;

  if auth.uid() is null then
    return new;
  end if;

  if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'created_by and created_at cannot be changed' using errcode = 'insufficient_privilege';
  end if;

  if (new.section_key, new.position, new.brand, new.starts_on, new.ends_on, new.comms, new.products, new.notes, new.inspo_paths, new.shows_on)
     is distinct from
     (old.section_key, old.position, old.brand, old.starts_on, old.ends_on, old.comms, old.products, old.notes, old.inspo_paths, old.shows_on)
     and not public.can_edit_placement(old.created_by) then
    raise exception 'Only whoever booked it (or Commercial) can change a booking' using errcode = 'insufficient_privilege';
  end if;

  if new.artwork_path is distinct from old.artwork_path and not public.has_placement_role('design') then
    raise exception 'Only Design can upload the banner' using errcode = 'insufficient_privilege';
  end if;

  if new.live_on is distinct from old.live_on and not public.has_placement_role('tech') then
    raise exception 'Only Tech can make a banner live' using errcode = 'insufficient_privilege';
  end if;

  if new.stage is distinct from old.stage then
    if new.stage = 'ready' and not public.has_placement_role('design') then
      raise exception 'Only Design can send a banner to Tech' using errcode = 'insufficient_privilege';
    elsif new.stage in ('live', 'ended') and not public.has_placement_role('tech') then
      raise exception 'Only Tech can put a banner live or take it down' using errcode = 'insufficient_privilege';
    elsif new.stage = 'booked' then
      raise exception 'A booking cannot go back to booked' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Creative requests
-- ---------------------------------------------------------------------------

create table if not exists public.creative_requests (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('social', 'ads', 'crm', 'partnerships')),
  title text not null check (length(trim(title)) between 1 and 200),
  formats text check (length(formats) <= 500),
  brief text check (length(brief) <= 5000),
  -- A campaign, project or partnership (they're all projects underneath).
  project_id uuid references public.projects (id) on delete set null,
  needed_by date,
  live_from date,
  live_to date,
  -- requested → in_design → in_review → approved → live; cancelled any time before live.
  status text not null default 'requested'
    check (status in ('requested', 'in_design', 'in_review', 'approved', 'live', 'cancelled')),
  -- The asker sent it back with a note; cleared when it goes for review again.
  change_note text check (length(change_note) <= 2000),
  ref_paths text[] not null default '{}',
  art_paths text[] not null default '{}',
  version int not null default 0,
  requested_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  designer_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  live_at timestamptz,
  constraint creative_requests_dates check (live_to is null or live_from is null or live_to >= live_from)
);
create index if not exists creative_requests_channel_idx on public.creative_requests (channel, status);
create index if not exists creative_requests_designer_idx on public.creative_requests (designer_id, status);
create index if not exists creative_requests_asker_idx on public.creative_requests (requested_by, status);

alter table public.creative_requests enable row level security;
revoke all on public.creative_requests from anon, authenticated;
grant select, insert, update on public.creative_requests to authenticated;

drop policy if exists creative_requests_select on public.creative_requests;
create policy creative_requests_select on public.creative_requests
  for select to authenticated using (public.is_active_user());

drop policy if exists creative_requests_insert on public.creative_requests;
create policy creative_requests_insert on public.creative_requests
  for insert to authenticated
  with check (public.is_active_user() and requested_by = auth.uid() and status = 'requested' and designer_id is null and art_paths = '{}');

drop policy if exists creative_requests_update on public.creative_requests;
create policy creative_requests_update on public.creative_requests
  for update to authenticated
  using (public.is_admin() or requested_by = auth.uid() or public.in_placement_team('design'))
  with check (public.is_admin() or requested_by = auth.uid() or public.in_placement_team('design'));

-- Each side moves only its own steps.
create or replace function public.creative_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_asker boolean := public.is_admin() or auth.uid() = old.requested_by;
  v_design boolean := public.is_admin() or public.in_placement_team('design');
begin
  new.updated_at := now();
  if new.status = 'live' and old.status is distinct from 'live' then new.live_at := now(); end if;
  if new.status = 'in_review' and old.status is distinct from 'in_review' then
    new.version := old.version + 1;
    new.change_note := null;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if new.requested_by is distinct from old.requested_by or new.created_at is distinct from old.created_at or new.channel is distinct from old.channel then
    raise exception 'That can''t be changed' using errcode = 'insufficient_privilege';
  end if;

  if (new.title, new.formats, new.brief, new.project_id, new.needed_by, new.live_from, new.live_to, new.ref_paths)
     is distinct from (old.title, old.formats, old.brief, old.project_id, old.needed_by, old.live_from, old.live_to, old.ref_paths)
     and not v_asker then
    raise exception 'Only whoever asked can change the request' using errcode = 'insufficient_privilege';
  end if;

  if (new.designer_id is distinct from old.designer_id or new.art_paths is distinct from old.art_paths) and not v_design then
    raise exception 'Only Design can do that' using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'in_review' and not v_design then
      raise exception 'Only Design can send it for review' using errcode = 'insufficient_privilege';
    elsif new.status = 'in_design' and old.status = 'requested' and not v_design then
      raise exception 'Only Design can start it' using errcode = 'insufficient_privilege';
    elsif new.status = 'in_design' and old.status = 'in_review' and not v_asker then
      raise exception 'Only whoever asked can ask for changes' using errcode = 'insufficient_privilege';
    elsif new.status in ('approved', 'live', 'cancelled') and not v_asker then
      raise exception 'Only whoever asked can do that' using errcode = 'insufficient_privilege';
    elsif new.status = 'requested' and not v_design and not v_asker then
      raise exception 'Not allowed' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists creative_requests_guard on public.creative_requests;
create trigger creative_requests_guard
  before update on public.creative_requests
  for each row execute function public.creative_requests_guard();

-- ---------------------------------------------------------------------------
-- Files: references from the asker, artwork from Design, under requests/<id>/
-- ---------------------------------------------------------------------------

drop policy if exists placement_files_select on storage.objects;
create policy placement_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'placement-files' and public.is_active_user());

drop policy if exists placement_files_insert on storage.objects;
create policy placement_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'placement-files' and public.is_active_user()
              and ((name like '%/inspo/%' and name not like 'requests/%')
                or (name like 'requests/%/refs/%')
                or ((name like '%/artwork/%' or name like 'requests/%/art/%') and public.has_placement_role('design'))));

drop policy if exists placement_files_delete on storage.objects;
create policy placement_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'placement-files' and public.is_active_user()
         and ((name like '%/inspo/%' or name like 'requests/%/refs/%')
           or ((name like '%/artwork/%' or name like 'requests/%/art/%') and public.has_placement_role('design'))));

-- ---------------------------------------------------------------------------
-- The badge in the menu: what's waiting on you
-- ---------------------------------------------------------------------------

create or replace function public.placement_todo_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    -- Bookings you made that end soon with nothing after them.
    (select count(*) from public.placements p
      where public.is_active_user() and p.created_by = auth.uid()
        and p.stage = 'live' and p.ends_on between public.pkt_today() and public.pkt_today() + 3
        and not exists (select 1 from public.placements n
                         where n.section_key = p.section_key and n.position = p.position
                           and n.stage <> 'ended' and n.starts_on > p.ends_on))
  + (select count(*) from public.placements p
      where public.in_placement_team('design')
        and (p.stage = 'booked' or (p.changed_from is not null and p.stage <> 'ended')))
  + (select count(*) from public.placements p
      where public.in_placement_team('tech')
        and (p.stage = 'ready' or (p.stage = 'live' and p.ends_on <= public.pkt_today())))
    -- Designers: their late, due today, or sent back.
  + (select count(*) from public.creative_requests r
      where r.designer_id = auth.uid() and r.status = 'in_design'
        and (r.change_note is not null or r.needed_by <= public.pkt_today()))
    -- Design team: new requests nobody has taken.
  + (select count(*) from public.creative_requests r
      where public.in_placement_team('design') and r.status = 'requested')
    -- Askers: waiting for your approval.
  + (select count(*) from public.creative_requests r
      where r.requested_by = auth.uid() and r.status = 'in_review')
  )::integer;
$$;

notify pgrst, 'reload schema';
