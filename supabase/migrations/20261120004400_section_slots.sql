-- Edit layout: add a slot at the end of a carousel, tile grid or icon row, or
-- take any slot out (the ones after it move up one, with their bookings).
-- Same people as the rest of the layout: Commercial, the teams picked in
-- Admin > Placements, and Admins. A slot with a current or upcoming booking
-- can't be taken out. Safe to run twice.

-- Bookings may move up a slot only inside remove_placement_slot.
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

  -- No one signed in (a system job), or a slot being taken out of a section
  -- (remove_placement_slot moves the bookings after it up one).
  if auth.uid() is null or current_setting('highfy.slot_shift', true) = 'on' then
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

/** One more slot at the end. New category icons are called "Category N" until renamed. */
create or replace function public.add_placement_slot(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.placement_sections;
begin
  if not public.can_edit_placement_layout() then
    raise exception 'Only Commercial can change the homepage layout' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.placement_sections where key = p_key for update;
  if not found then raise exception 'Section not found'; end if;
  if s.kind not in ('carousel', 'tiles', 'icons') then raise exception 'This section has one slot'; end if;
  if s.slots >= 30 then raise exception 'A section can have at most 30 slots'; end if;
  update public.placement_sections
     set slots = s.slots + 1,
         labels = case when s.kind = 'icons' or cardinality(s.labels) > 0
                       then (s.labels || array_fill(''::text, array[greatest(0, s.slots - cardinality(s.labels))]))
                            || case when s.kind = 'icons' then 'Category ' || (s.slots + 1) else '' end
                       else s.labels end
   where key = p_key;
end;
$$;

/** Take slot p_position out; the slots after it move up one, with their bookings. */
create or replace function public.remove_placement_slot(p_key text, p_position integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.placement_sections;
  n integer;
begin
  if not public.can_edit_placement_layout() then
    raise exception 'Only Commercial can change the homepage layout' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.placement_sections where key = p_key for update;
  if not found then raise exception 'Section not found'; end if;
  if s.kind not in ('carousel', 'tiles', 'icons') or s.slots < 2 then raise exception 'This section needs at least one slot'; end if;
  if p_position < 1 or p_position > s.slots then raise exception 'Slot not found'; end if;
  if exists (select 1 from public.placements p where p.section_key = p_key and p.position = p_position and p.stage <> 'ended') then
    raise exception 'That slot has a booking. Cancel or move it first.';
  end if;

  -- Move the later slots up one, lowest first so two bookings never share a slot.
  perform set_config('highfy.slot_shift', 'on', true);
  for n in p_position + 1 .. s.slots loop
    update public.placements set position = n - 1 where section_key = p_key and position = n;
  end loop;
  perform set_config('highfy.slot_shift', 'off', true);

  update public.placement_sections
     set slots = s.slots - 1,
         labels = case when cardinality(s.labels) >= p_position
                       then s.labels[1:p_position - 1] || s.labels[p_position + 1:]
                       else s.labels end
   where key = p_key;
end;
$$;

revoke execute on function public.add_placement_slot(text), public.remove_placement_slot(text, integer) from public, anon;
grant execute on function public.add_placement_slot(text), public.remove_placement_slot(text, integer) to authenticated;

notify pgrst, 'reload schema';
