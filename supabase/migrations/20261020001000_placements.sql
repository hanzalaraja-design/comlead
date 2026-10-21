-- Homepage placements on highfy.pk.
--
-- Commercial books a brand into a slot for some dates, Design uploads the
-- banner, Tech puts it live and takes it down. Who counts as Commercial,
-- Design and Tech is set once by an Admin (placement_settings).

-- ---------------------------------------------------------------------------
-- Which teams do which job
-- ---------------------------------------------------------------------------

create table public.placement_settings (
  id smallint primary key default 1 check (id = 1),
  commercial_department_id uuid references public.departments (id) on delete set null,
  design_department_id uuid references public.departments (id) on delete set null,
  tech_department_id uuid references public.departments (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.placement_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The homepage, section by section
-- ---------------------------------------------------------------------------

create table public.placement_sections (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  surface text not null default 'web' check (surface in ('web', 'app')),
  name text not null check (length(trim(name)) > 0),
  kind text not null check (kind in ('banner', 'text', 'icons', 'carousel', 'tiles', 'badge')),
  slots int not null check (slots between 1 and 30),
  labels text[] not null default '{}',
  size_hint text,
  sort int not null default 0,
  archived boolean not null default false
);

insert into public.placement_sections (key, name, kind, slots, labels, sort) values
  ('announcement', 'Announcement bar', 'banner', 1, '{}', 10),
  ('offer_strip', 'Offer strip', 'text', 1, '{}', 20),
  ('categories', 'Category icons', 'icons', 5, '{Skincare,Makeup,Haircare,"K Beauty","Category 5"}', 30),
  ('hero', 'Hero carousel', 'carousel', 8, '{}', 40),
  ('must_haves', 'Must-Haves', 'carousel', 10, '{}', 50),
  ('imported_header', 'Shop Imported header', 'banner', 1, '{}', 60),
  ('imported', 'Shop Imported', 'carousel', 10, '{}', 70),
  ('korean', 'Korean Beauty tiles', 'tiles', 9, '{}', 80),
  ('local', 'Shop Local', 'carousel', 10, '{}', 90),
  ('premium', 'Highfy Premium', 'carousel', 6, '{}', 100),
  ('badge', 'Product badge', 'badge', 1, '{}', 110)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

-- booked: waiting for Design. ready: artwork uploaded, waiting for Tech.
-- live: on the site. ended: taken down.
create type public.placement_stage as enum ('booked', 'ready', 'live', 'ended');

create table public.placements (
  id uuid primary key default gen_random_uuid(),
  section_key text not null references public.placement_sections (key) on update cascade,
  position int not null check (position >= 1),
  brand text not null check (length(trim(brand)) > 0),
  starts_on date not null,
  ends_on date, -- null: ongoing
  comms text,
  products text, -- category icons: which products to show
  notes text,
  inspo_paths text[] not null default '{}',
  artwork_path text,
  stage public.placement_stage not null default 'booked',
  -- Set when Commercial changes the comms or products after the banner was made.
  changed_from jsonb,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  live_at timestamptz,
  ended_at timestamptz,
  constraint placements_dates check (ends_on is null or ends_on >= starts_on)
);

create index placements_slot_idx on public.placements (section_key, position, starts_on);
create index placements_stage_idx on public.placements (stage) where stage <> 'ended';

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- The jobs the signed-in person can do. Admin can do all of them.
create or replace function public.placement_roles()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_admin() then array['commercial', 'design', 'tech'] else
    coalesce((
      select array_agg(r.role order by r.role)
        from public.placement_settings s
        cross join lateral (values
          ('commercial', s.commercial_department_id),
          ('design', s.design_department_id),
          ('tech', s.tech_department_id)) as r(role, department_id)
       where r.department_id is not null
         and public.is_active_user()
         and exists (select 1 from public.department_members m
                      where m.department_id = r.department_id and m.user_id = auth.uid())
    ), '{}') end;
$$;

create or replace function public.has_placement_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_role = any(public.placement_roles());
$$;

create or replace function public.can_use_placements()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select cardinality(public.placement_roles()) > 0;
$$;

grant execute on function public.placement_roles(), public.has_placement_role(text), public.can_use_placements() to authenticated;

alter table public.placement_settings enable row level security;
alter table public.placement_sections enable row level security;
alter table public.placements enable row level security;

create policy placement_settings_select on public.placement_settings
  for select to authenticated using (public.can_use_placements());
create policy placement_settings_update on public.placement_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy placement_sections_select on public.placement_sections
  for select to authenticated using (public.can_use_placements());
create policy placement_sections_admin on public.placement_sections
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy placements_select on public.placements
  for select to authenticated using (public.can_use_placements());
create policy placements_insert on public.placements
  for insert to authenticated
  with check (public.has_placement_role('commercial') and created_by = auth.uid() and stage = 'booked');
create policy placements_update on public.placements
  for update to authenticated
  using (public.can_use_placements()) with check (public.can_use_placements());
-- A banner that's on the site is ended, not deleted, so Tech knows to take it down.
create policy placements_delete on public.placements
  for delete to authenticated
  using (public.has_placement_role('commercial') and stage in ('booked', 'ready'));

-- Each team changes only its own part.
create or replace function public.placements_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.stage = 'live' and old.stage is distinct from 'live' then new.live_at := now(); end if;
  if new.stage = 'ended' and old.stage is distinct from 'ended' then new.ended_at := now(); end if;

  if auth.uid() is null then
    return new;
  end if;

  if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'created_by and created_at cannot be changed' using errcode = 'insufficient_privilege';
  end if;

  if (new.section_key, new.position, new.brand, new.starts_on, new.ends_on, new.comms, new.products, new.notes, new.inspo_paths)
     is distinct from
     (old.section_key, old.position, old.brand, old.starts_on, old.ends_on, old.comms, old.products, old.notes, old.inspo_paths)
     and not public.has_placement_role('commercial') then
    raise exception 'Only Commercial can change a booking' using errcode = 'insufficient_privilege';
  end if;

  if new.artwork_path is distinct from old.artwork_path and not public.has_placement_role('design') then
    raise exception 'Only Design can upload the banner' using errcode = 'insufficient_privilege';
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

create trigger placements_guard
  before update on public.placements
  for each row execute function public.placements_guard();

-- One brand per slot at a time.
create or replace function public.placements_no_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand text;
begin
  if new.stage = 'ended' then
    return new;
  end if;
  select p.brand into v_brand
    from public.placements p
   where p.section_key = new.section_key
     and p.position = new.position
     and p.id <> new.id
     and p.stage <> 'ended'
     and p.starts_on <= coalesce(new.ends_on, 'infinity'::date)
     and coalesce(p.ends_on, 'infinity'::date) >= new.starts_on
   limit 1;
  if v_brand is not null then
    raise exception 'This slot already has % on some of those dates', v_brand using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger placements_no_overlap
  before insert or update of section_key, position, starts_on, ends_on, stage on public.placements
  for each row execute function public.placements_no_overlap();

-- What's waiting on the signed-in person, for the badge in the menu. Counts
-- only the teams they're actually in, so an Admin outside them sees none.
create or replace function public.placement_todo_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select r.role
      from public.placement_settings s
      cross join lateral (values
        ('commercial', s.commercial_department_id),
        ('design', s.design_department_id),
        ('tech', s.tech_department_id)) as r(role, department_id)
     where r.department_id is not null
       and public.is_active_user()
       and exists (select 1 from public.department_members m
                    where m.department_id = r.department_id and m.user_id = auth.uid())
  )
  select (
    (select count(*) from public.placements p
      where 'commercial' in (select role from mine)
        and p.stage = 'live' and p.ends_on between public.pkt_today() and public.pkt_today() + 3
        and not exists (select 1 from public.placements n
                         where n.section_key = p.section_key and n.position = p.position
                           and n.stage <> 'ended' and n.starts_on > p.ends_on))
  + (select count(*) from public.placements p
      where 'design' in (select role from mine)
        and (p.stage = 'booked' or (p.changed_from is not null and p.stage <> 'ended')))
  + (select count(*) from public.placements p
      where 'tech' in (select role from mine)
        and (p.stage = 'ready' or (p.stage = 'live' and p.ends_on <= public.pkt_today())))
  )::integer;
$$;

grant execute on function public.placement_todo_count() to authenticated;

-- ---------------------------------------------------------------------------
-- Files: inspo from Commercial and banners from Design, under "<placement id>/"
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('placement-files', 'placement-files', false, 20971520) -- 20 MB
on conflict (id) do nothing;

create policy placement_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'placement-files' and public.can_use_placements());

create policy placement_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'placement-files'
              and ((name like '%/inspo/%' and public.has_placement_role('commercial'))
                or (name like '%/artwork/%' and public.has_placement_role('design'))));

create policy placement_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'placement-files'
         and ((name like '%/inspo/%' and public.has_placement_role('commercial'))
           or (name like '%/artwork/%' and public.has_placement_role('design'))));
