-- Placements: a link on each booking (where the banner goes), comments on a
-- booking, and its history (activity). Who can see or change a booking
-- doesn't change: comments and history follow whoever can see the booking.

alter table public.placements
  add column if not exists link text check (link is null or (length(link) <= 500 and link ~* '^https?://'));

-- ---------------------------------------------------------------------------
-- Comments on a booking
-- ---------------------------------------------------------------------------

create table public.placement_comments (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.placements (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index placement_comments_placement_idx on public.placement_comments (placement_id, created_at);

alter table public.placement_comments enable row level security;
revoke all on public.placement_comments from anon;
grant select, insert, delete on public.placement_comments to authenticated;

-- Whoever can see the booking (the placements rules decide) sees and adds comments.
create policy placement_comments_select on public.placement_comments for select to authenticated
  using (exists (select 1 from public.placements p where p.id = placement_id));
create policy placement_comments_insert on public.placement_comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_active_user() and exists (select 1 from public.placements p where p.id = placement_id));
create policy placement_comments_delete on public.placement_comments for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- Whoever booked it, and everyone else who commented, hears about a new comment.
create or replace function public.notify_placement_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.placements;
  v_who uuid;
begin
  select * into p from public.placements where id = new.placement_id;
  for v_who in
    select p.created_by
    union select c.author_id from public.placement_comments c where c.placement_id = new.placement_id
  loop
    perform public.notify(v_who, 'my_requests', new.author_id,
      coalesce(public.person_label(new.author_id), 'Someone') || ' commented on ' || p.brand,
      left(new.body, 200), '/placements?open=' || p.id, null);
  end loop;
  return null;
end;
$$;
create trigger placement_comments_notify after insert on public.placement_comments
  for each row execute function public.notify_placement_comment();

-- ---------------------------------------------------------------------------
-- History: bookings, changes, stages and comments go in the activity log.
-- ---------------------------------------------------------------------------

create or replace function public.log_placement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placements := coalesce(new, old);
  v_action text;
  v_old jsonb;
  v_new jsonb := jsonb_build_object('placement_id', r.id);
begin
  if tg_op = 'INSERT' then
    v_action := 'placement.booked';
    v_new := v_new || jsonb_build_object('starts_on', r.starts_on, 'ends_on', r.ends_on);
  elsif tg_op = 'DELETE' then
    v_action := 'placement.cancelled';
  elsif new.stage is distinct from old.stage then
    v_action := 'placement.stage_changed';
    v_old := jsonb_build_object('stage', old.stage);
    v_new := v_new || jsonb_build_object('stage', new.stage);
  elsif new.live_on is distinct from old.live_on then
    v_action := 'placement.live_on';
    v_new := v_new || jsonb_build_object('live_on', new.live_on);
  elsif new.starts_on is distinct from old.starts_on or new.ends_on is distinct from old.ends_on then
    v_action := 'placement.dates_changed';
    v_old := jsonb_build_object('starts_on', old.starts_on, 'ends_on', old.ends_on);
    v_new := v_new || jsonb_build_object('starts_on', new.starts_on, 'ends_on', new.ends_on);
  elsif new.artwork_path is distinct from old.artwork_path then
    v_action := 'placement.artwork';
  elsif new.comms is distinct from old.comms or new.products is distinct from old.products or new.brand is distinct from old.brand
        or new.link is distinct from old.link or new.notes is distinct from old.notes then
    v_action := 'placement.edited';
  else
    return null;
  end if;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, entity_label, old_value, new_value)
  values (auth.uid(), v_action, 'placement', r.id, r.brand, v_old, v_new);
  return null;
end;
$$;
create trigger placements_log after insert or update or delete on public.placements
  for each row execute function public.log_placement();

create or replace function public.log_placement_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activity_log (actor_id, action, entity_type, entity_id, entity_label, new_value)
  values (new.author_id, 'placement.commented', 'placement', new.placement_id,
          (select brand from public.placements where id = new.placement_id),
          jsonb_build_object('placement_id', new.placement_id, 'body', left(new.body, 200)));
  return null;
end;
$$;
create trigger placement_comments_log after insert on public.placement_comments
  for each row execute function public.log_placement_comment();

-- A booking's history: for whoever can see the booking.
create policy activity_log_select_placement on public.activity_log
  for select to authenticated
  using (entity_type = 'placement' and exists (select 1 from public.placements p where p.id = entity_id));

notify pgrst, 'reload schema';
