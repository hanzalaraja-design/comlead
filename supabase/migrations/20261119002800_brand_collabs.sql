-- Highfy Tasks: Brand collabs. Commercial asks the Content team for social
-- content for a brand (launch, offer, awareness); Content sends a plan priced
-- from the media kit; Commercial approves; each piece becomes a task; Content
-- marks pieces live and shares a report. Each step is a function below that
-- checks who may do it, so the tables themselves are read-only to the app.

-- ---------------------------------------------------------------------------
-- Who's who: the Content team joins Commercial, Design and Tech in settings
-- ---------------------------------------------------------------------------

alter table public.placement_settings add column if not exists content_department_id uuid references public.departments (id) on delete set null;

-- First time: use the teams called Content and Commercial, if they exist.
update public.placement_settings
   set content_department_id = coalesce(content_department_id, (select id from public.departments where slug = 'content' and not archived limit 1)),
       commercial_department_id = coalesce(commercial_department_id, (select id from public.departments where slug = 'commercial' and not archived limit 1))
 where id = 1;

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
        ('tech', s.tech_department_id),
        ('content', s.content_department_id)) as r(role, department_id)
      join public.department_members m on m.department_id = r.department_id and m.user_id = auth.uid()
     where r.role = p_role);
$$;

/** Commercial (asks, approves), Content (plans, delivers) and Admin. */
create or replace function public.can_use_collabs()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.in_placement_team('commercial') or public.in_placement_team('content');
$$;
grant execute on function public.can_use_collabs() to authenticated;

-- ---------------------------------------------------------------------------
-- The media kit (tentative rates, PKR). Admin can change prices.
-- ---------------------------------------------------------------------------

create table public.collab_rates (
  id uuid primary key default gen_random_uuid(),
  grp text not null check (grp in ('feed', 'reels', 'influencer', 'addon')),
  name text not null check (length(trim(name)) between 1 and 80),
  note text,
  price integer not null check (price >= 0),
  price_max integer check (price_max is null or price_max >= price), -- a range, e.g. A-tier
  sort integer not null default 0,
  archived boolean not null default false
);
alter table public.collab_rates enable row level security;
revoke all on public.collab_rates from anon, authenticated;
grant select on public.collab_rates to authenticated;
grant update (price, price_max, note, archived) on public.collab_rates to authenticated;
create policy collab_rates_select on public.collab_rates for select to authenticated using (public.is_active_user());
create policy collab_rates_admin on public.collab_rates for update to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.collab_rates (grp, name, note, price, price_max, sort) values
  ('feed', 'Static post', null, 30000, null, 10),
  ('feed', 'Product / price carousel', null, 30000, null, 20),
  ('feed', 'Meme carousel', null, 30000, null, 30),
  ('feed', 'Educational carousel', null, 30000, null, 40),
  ('feed', 'Daily deal post', 'One a day; book the slot ahead', 0, null, 50),
  ('reels', 'In-house creator reel', null, 30000, null, 60),
  ('reels', 'Campaign integration reel', null, 20000, null, 70),
  ('influencer', 'Nano influencer reel', '1k–10k followers', 25000, null, 80),
  ('influencer', 'Micro influencer reel', '10k–60k followers', 50000, null, 90),
  ('influencer', 'Macro influencer reel', '60k–200k followers', 100000, null, 100),
  ('influencer', 'A-tier influencer reel', '250k–600k followers', 250000, 500000, 110),
  ('addon', 'Collab post with the brand', 'With an in-house reel', 10000, null, 120),
  ('addon', 'Influencer collab with Highfy', null, 10000, null, 130),
  ('addon', 'Influencer collab with the brand', null, 10000, null, 140);

-- ---------------------------------------------------------------------------
-- Requests, the pieces in each plan, and comments
-- ---------------------------------------------------------------------------

create table public.collab_requests (
  id uuid primary key default gen_random_uuid(),
  brand text not null check (length(trim(brand)) between 1 and 120),
  promote text not null check (length(trim(promote)) between 1 and 500),     -- product, launch or offer
  goals text[] not null check (cardinality(goals) between 1 and 6),
  go_live date not null,
  budget text not null,
  audience text not null check (length(trim(audience)) between 1 and 300),
  key_message text not null check (length(trim(key_message)) between 1 and 300),
  link text,                     -- Instagram or website (optional)
  refs text,                     -- creative references (optional)
  project_id uuid references public.projects (id) on delete set null,      -- campaign (optional)
  notes text,                    -- anything else (optional)
  status text not null default 'requested'
    check (status in ('requested', 'planned', 'changes', 'approved', 'live', 'reported')),
  plan_note text,
  change_note text,
  total integer not null default 0,
  total_max integer not null default 0,
  report_summary text,
  report_images text[] not null default '{}',
  requested_by uuid not null default auth.uid() references public.profiles (id),
  planned_by uuid references public.profiles (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  reported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index collab_requests_status_idx on public.collab_requests (status, go_live);

create table public.collab_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.collab_requests (id) on delete cascade,
  rate_id uuid references public.collab_rates (id) on delete set null,
  name text not null,            -- copied from the media kit when planned
  qty integer not null default 1 check (qty between 1 and 50),
  unit_price integer not null check (unit_price >= 0),
  unit_price_max integer,
  idea text,
  owner_id uuid references public.profiles (id) on delete set null,
  due_date date,
  task_id uuid references public.tasks (id) on delete set null,
  live_url text,
  live_at timestamptz,
  reach integer,
  views integer,
  is_addon boolean not null default false,  -- an extra on another piece: no task, nothing to post
  sort integer not null default 0
);
create index collab_items_request_idx on public.collab_items (request_id, sort);

create table public.collab_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.collab_requests (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null default '' check (length(body) <= 10000),
  image_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint collab_comments_not_empty check (length(trim(body)) > 0 or cardinality(image_paths) > 0)
);
create index collab_comments_request_idx on public.collab_comments (request_id, created_at);

alter table public.collab_requests enable row level security;
alter table public.collab_items enable row level security;
alter table public.collab_comments enable row level security;
revoke all on public.collab_requests, public.collab_items, public.collab_comments from anon, authenticated;
grant select on public.collab_requests, public.collab_items to authenticated;
grant select, insert, delete on public.collab_comments to authenticated;
create policy collab_requests_select on public.collab_requests for select to authenticated using (public.can_use_collabs());
create policy collab_items_select on public.collab_items for select to authenticated using (public.can_use_collabs());
create policy collab_comments_select on public.collab_comments for select to authenticated using (public.can_use_collabs());
create policy collab_comments_insert on public.collab_comments for insert to authenticated
  with check (author_id = auth.uid() and public.can_use_collabs());
create policy collab_comments_delete on public.collab_comments for delete to authenticated using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The steps
-- ---------------------------------------------------------------------------

/** Notify everyone in a team (for new requests). */
create or replace function public.collab_notify_team(p_role text, p_kind text, p_title text, p_body text, p_href text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid;
begin
  for u in
    select m.user_id from public.placement_settings s
      join public.department_members m on m.department_id = case p_role when 'content' then s.content_department_id else s.commercial_department_id end
     where s.id = 1
  loop
    perform public.notify(u, p_kind, auth.uid(), p_title, p_body, p_href, null);
  end loop;
end;
$$;
revoke execute on function public.collab_notify_team(text, text, text, text, text) from public, anon, authenticated;

/** Commercial sends (or, before a plan arrives, edits) a request. */
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
  if not (public.is_admin() or public.in_placement_team('commercial')) then
    raise exception 'Only the Commercial team can ask for content.' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.collab_requests (brand, promote, goals, go_live, budget, audience, key_message, link, refs, project_id, notes)
    values (p ->> 'brand', p ->> 'promote', array(select jsonb_array_elements_text(p -> 'goals')), (p ->> 'go_live')::date,
            p ->> 'budget', p ->> 'audience', p ->> 'key_message', nullif(p ->> 'link', ''), nullif(p ->> 'refs', ''),
            nullif(p ->> 'project_id', '')::uuid, nullif(p ->> 'notes', ''))
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
    notes = nullif(p ->> 'notes', ''), updated_at = now()
  where id = p_id;
  return p_id;
end;
$$;
grant execute on function public.collab_save_request(uuid, jsonb) to authenticated;

/** Content sends the plan: pieces from the media kit, with idea, who and when. Replaces any earlier plan. */
create or replace function public.collab_send_plan(p_id uuid, p_items jsonb, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.collab_requests;
  it jsonb;
  rate public.collab_rates;
  n integer := 0;
  v_total integer := 0;
  v_max integer := 0;
begin
  if not (public.is_admin() or public.in_placement_team('content')) then
    raise exception 'Only the Content team can send a plan.' using errcode = '42501';
  end if;
  select * into r from public.collab_requests where id = p_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status not in ('requested', 'changes', 'planned') then
    raise exception 'This plan is already approved.' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then raise exception 'Add at least one piece.'; end if;

  delete from public.collab_items where request_id = p_id;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into rate from public.collab_rates where id = (it ->> 'rate_id')::uuid;
    if not found then raise exception 'A piece isn''t in the media kit any more. Pick it again.'; end if;
    n := n + 1;
    insert into public.collab_items (request_id, rate_id, name, qty, unit_price, unit_price_max, idea, owner_id, due_date, is_addon, sort)
    values (p_id, rate.id, rate.name, greatest(1, coalesce((it ->> 'qty')::int, 1)), rate.price, rate.price_max,
            nullif(trim(it ->> 'idea'), ''), nullif(it ->> 'owner_id', '')::uuid, coalesce(nullif(it ->> 'due_date', '')::date, r.go_live), rate.grp = 'addon', n);
    v_total := v_total + rate.price * greatest(1, coalesce((it ->> 'qty')::int, 1));
    v_max := v_max + coalesce(rate.price_max, rate.price) * greatest(1, coalesce((it ->> 'qty')::int, 1));
  end loop;

  update public.collab_requests
     set status = 'planned', plan_note = nullif(trim(p_note), ''), planned_by = auth.uid(),
         total = v_total, total_max = v_max, updated_at = now()
   where id = p_id;
  perform public.notify(r.requested_by, 'collab', auth.uid(),
    coalesce(public.person_label(auth.uid()), 'Content') || ' sent a plan for ' || r.brand,
    n || ' piece' || case when n = 1 then '' else 's' end || ' · Rs ' || to_char(v_total, 'FM999,999,999'), '/collabs/' || p_id, null);
end;
$$;
grant execute on function public.collab_send_plan(uuid, jsonb, text) to authenticated;

/** Commercial asks for changes to the plan. */
create or replace function public.collab_ask_changes(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.collab_requests;
begin
  if not (public.is_admin() or public.in_placement_team('commercial')) then
    raise exception 'Only the Commercial team can do that.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Say what should change.'; end if;
  select * into r from public.collab_requests where id = p_id for update;
  if r.status <> 'planned' then raise exception 'There''s no plan waiting for approval.'; end if;
  update public.collab_requests set status = 'changes', change_note = trim(p_note), updated_at = now() where id = p_id;
  perform public.notify(r.planned_by, 'collab', auth.uid(),
    coalesce(public.person_label(auth.uid()), 'Commercial') || ' asked for changes: ' || r.brand, trim(p_note), '/collabs/' || p_id, null);
end;
$$;
grant execute on function public.collab_ask_changes(uuid, text) to authenticated;

/** Commercial approves: each piece becomes a task for whoever does it, in the Content team. */
create or replace function public.collab_approve(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.collab_requests;
  it public.collab_items;
  v_dept uuid;
  v_task uuid;
begin
  if not (public.is_admin() or public.in_placement_team('commercial')) then
    raise exception 'Only the Commercial team can approve a plan.' using errcode = '42501';
  end if;
  select * into r from public.collab_requests where id = p_id for update;
  if r.status <> 'planned' then raise exception 'There''s no plan waiting for approval.'; end if;
  select content_department_id into v_dept from public.placement_settings where id = 1;

  for it in select * from public.collab_items where request_id = p_id and not is_addon order by sort loop
    insert into public.tasks (title, description, owner_id, due_date, department_id, project_id, created_by, source)
    values (
      it.name || case when it.qty > 1 then ' ×' || it.qty else '' end || ': ' || r.brand,
      '<p>' || replace(replace(replace(coalesce(it.idea, r.promote), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>'
        || '<p>Brand collab. Mark it live with the post link on <a href="/collabs/' || p_id || '">the request</a>.</p>',
      coalesce(it.owner_id, r.planned_by), it.due_date, v_dept, r.project_id, auth.uid(), 'manual')
    returning id into v_task;
    update public.collab_items set task_id = v_task where id = it.id;
  end loop;

  update public.collab_requests set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = p_id;
  perform public.notify(r.planned_by, 'collab', auth.uid(),
    coalesce(public.person_label(auth.uid()), 'Commercial') || ' approved the plan for ' || r.brand,
    'Rs ' || to_char(r.total, 'FM999,999,999') || ' · the pieces are in everyone''s Tasks', '/collabs/' || p_id, null);
end;
$$;
grant execute on function public.collab_approve(uuid) to authenticated;

/** Content (or whoever does the piece) marks it live with its link; its task is done. */
create or replace function public.collab_mark_live(p_item uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  it public.collab_items;
  r public.collab_requests;
begin
  select * into it from public.collab_items where id = p_item for update;
  if not found or it.is_addon then raise exception 'Piece not found.'; end if;
  if not (public.is_admin() or public.in_placement_team('content') or it.owner_id = auth.uid()) then
    raise exception 'Only the Content team can mark it live.' using errcode = '42501';
  end if;
  if coalesce(trim(p_url), '') !~* '^https?://' then raise exception 'Paste the link to the live post.'; end if;
  select * into r from public.collab_requests where id = it.request_id for update;
  if r.status not in ('approved', 'live') then raise exception 'The plan isn''t approved yet.'; end if;

  update public.collab_items set live_url = trim(p_url), live_at = coalesce(live_at, now()) where id = p_item;
  if it.task_id is not null then
    update public.tasks set status = 'done' where id = it.task_id and status <> 'done' and deleted_at is null;
    -- The "live" notification below says it; skip the task's own "finished" one.
    delete from public.notifications where task_id = it.task_id and kind = 'finished' and created_at >= now();
  end if;
  perform public.notify(r.requested_by, 'collab', auth.uid(),
    'Live: ' || it.name || ' for ' || r.brand, trim(p_url), '/collabs/' || r.id, null);
  if not exists (select 1 from public.collab_items where request_id = r.id and live_url is null and not is_addon) then
    update public.collab_requests set status = 'live', updated_at = now() where id = r.id and status = 'approved';
  end if;
end;
$$;
grant execute on function public.collab_mark_live(uuid, text) to authenticated;

/** Content shares the report: a summary, optional screenshots and numbers per piece. */
create or replace function public.collab_report(p_id uuid, p_summary text, p_images text[], p_numbers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.collab_requests;
  x jsonb;
begin
  if not (public.is_admin() or public.in_placement_team('content')) then
    raise exception 'Only the Content team can share the report.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_summary, ''))) = 0 then raise exception 'Write a short summary.'; end if;
  select * into r from public.collab_requests where id = p_id for update;
  if r.status not in ('live', 'reported') then raise exception 'Mark every piece live first.'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_numbers, '[]')) loop
    update public.collab_items
       set reach = nullif(x ->> 'reach', '')::int, views = nullif(x ->> 'views', '')::int
     where id = (x ->> 'id')::uuid and request_id = p_id;
  end loop;
  update public.collab_requests
     set status = 'reported', report_summary = trim(p_summary), report_images = coalesce(p_images, '{}'),
         reported_at = coalesce(reported_at, now()), updated_at = now()
   where id = p_id;
  perform public.notify(r.requested_by, 'collab', auth.uid(),
    'Report ready: ' || r.brand, left(trim(p_summary), 300), '/collabs/' || p_id, null);
end;
$$;
grant execute on function public.collab_report(uuid, text, text[], jsonb) to authenticated;

notify pgrst, 'reload schema';
