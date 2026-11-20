-- Paid social: the asker picks what they'd like from the media kit (and how
-- many), or types something else, and can give any budget range. Content's
-- plan starts from those picks. Safe to run twice.

alter table public.collab_requests
  add column if not exists wants jsonb not null default '[]',
  add column if not exists wants_other text check (wants_other is null or length(wants_other) <= 1000);

create or replace function public.collab_save_request(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.collab_requests;
  v_id uuid;
begin
  if not public.is_collab_asker() then
    raise exception 'Only Commercial (and the teams picked to ask) can ask for content.' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.collab_requests (brand, promote, goals, go_live, budget, audience, key_message, link, refs, project_id, notes, wants, wants_other)
    values (p ->> 'brand', p ->> 'promote', array(select jsonb_array_elements_text(p -> 'goals')), (p ->> 'go_live')::date,
            p ->> 'budget', p ->> 'audience', p ->> 'key_message', nullif(p ->> 'link', ''), nullif(p ->> 'refs', ''),
            nullif(p ->> 'project_id', '')::uuid, nullif(p ->> 'notes', ''),
            coalesce(case when jsonb_typeof(p -> 'wants') = 'array' then p -> 'wants' end, '[]'::jsonb), nullif(p ->> 'wants_other', ''))
    returning id into v_id;
    perform public.collab_notify_team('content', 'collab',
      coalesce(public.person_label(auth.uid()), 'Someone') || ' needs content: ' || (p ->> 'brand'),
      (p ->> 'promote') || ' · live by ' || to_char((p ->> 'go_live')::date, 'DD Mon'), '/collabs/' || v_id);
    return v_id;
  end if;
  select * into r from public.collab_requests where id = p_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status not in ('requested', 'changes') then
    raise exception 'The plan has been sent, so the brief can''t change now. Add a comment instead.' using errcode = '42501';
  end if;
  update public.collab_requests set
    brand = p ->> 'brand', promote = p ->> 'promote', goals = array(select jsonb_array_elements_text(p -> 'goals')),
    go_live = (p ->> 'go_live')::date, budget = p ->> 'budget', audience = p ->> 'audience', key_message = p ->> 'key_message',
    link = nullif(p ->> 'link', ''), refs = nullif(p ->> 'refs', ''), project_id = nullif(p ->> 'project_id', '')::uuid,
    notes = nullif(p ->> 'notes', ''),
    wants = coalesce(case when jsonb_typeof(p -> 'wants') = 'array' then p -> 'wants' end, '[]'::jsonb), wants_other = nullif(p ->> 'wants_other', ''),
    updated_at = now()
  where id = p_id;
  return p_id;
end;
$$;
grant execute on function public.collab_save_request(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
