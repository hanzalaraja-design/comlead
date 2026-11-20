-- Link a homepage booking to a project, campaign or partnership. Linking adds
-- a done task to it ("Book homepage placement for Yeylo: ..."), so the
-- booking shows in its Tasks. You can link only to something you're in.

alter table public.placements
  add column if not exists project_id uuid references public.projects (id) on delete set null;
create index if not exists placements_project_idx on public.placements (project_id) where project_id is not null;

-- Who may link: whoever can change the booking, and only to something they're in.
create or replace function public.placements_project_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or new.project_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.project_id is not distinct from old.project_id then return new; end if;
  if not (public.is_admin() or public.is_project_member(new.project_id)
          or exists (select 1 from public.projects p where p.id = new.project_id and p.created_by = auth.uid())) then
    raise exception 'You can only link a booking to a project, campaign or partnership you''re in' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and not public.can_edit_placement(old.created_by) then
    raise exception 'Only whoever booked it (or Commercial) can change a booking' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
drop trigger if exists placements_project_check on public.placements;
create trigger placements_project_check before insert or update of project_id on public.placements
  for each row execute function public.placements_project_check();

-- Once linked: a done task in it, saying what was booked.
create or replace function public.placements_project_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.placement_sections;
  v_slot text;
  v_where text;
  v_title text;
begin
  if new.project_id is null then return null; end if;
  if tg_op = 'UPDATE' and new.project_id is not distinct from old.project_id then return null; end if;
  -- Already has one for this booking (linked, unlinked, linked again).
  if exists (select 1 from public.tasks t
              where t.project_id = new.project_id and t.deleted_at is null
                and t.description like '%/placements?open=' || new.id || '%') then
    return null;
  end if;

  select * into s from public.placement_sections where key = new.section_key;
  v_slot := case when s.key is null then 'Homepage'
                 when s.slots = 1 then s.name
                 when s.labels[new.position] is not null and s.labels[new.position] <> '' then s.name || ', ' || s.labels[new.position]
                 else s.name || ', ' || case when s.kind = 'tiles' then 'tile ' else 'slide ' end || new.position end;
  v_where := case when new.shows_on @> array['web', 'app'] then 'Website + App'
                  when new.shows_on = array['app'] then 'App' else 'Website' end;
  v_title := left('Book homepage placement for ' || new.brand || ': ' || v_slot || ' (' || v_where || ')', 300);

  insert into public.tasks (title, description, owner_id, created_by, project_id, due_date, status, completed_at, source)
  values (
    v_title,
    '<p>' || replace(replace(replace(new.brand, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || ' is booked on the homepage from '
      || to_char(new.starts_on, 'Dy DD Mon') || coalesce(' to ' || to_char(new.ends_on, 'Dy DD Mon'), ' onwards') || '.</p>'
      || '<p><a href="/placements?open=' || new.id || '">Open the booking</a></p>',
    coalesce(new.created_by, auth.uid()),
    coalesce(auth.uid(), new.created_by),
    new.project_id,
    new.starts_on,
    'done',
    now(),
    'manual');
  return null;
end;
$$;
revoke execute on function public.placements_project_task() from public, anon, authenticated;
drop trigger if exists placements_project_task on public.placements;
create trigger placements_project_task after insert or update of project_id on public.placements
  for each row execute function public.placements_project_task();

notify pgrst, 'reload schema';
