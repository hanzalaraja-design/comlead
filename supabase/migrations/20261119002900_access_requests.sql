-- Request access, and activity anyone on a task can see.
--
--  * Open a task, project, campaign or partnership you can't see and you get
--    who has access now and a "Request access" button, instead of "not found".
--  * The owner gets a notification and gives access or declines. Giving
--    access adds the person the same way as adding them by hand: as a
--    collaborator on a task, as a person on a project. Nothing else about
--    owners, collaborators, teams or who sees what changes.
--  * A task's history (activity) can be read by everyone who can read the
--    task, not only by team leads and the person who did it.

-- ---------------------------------------------------------------------------
-- 1. Requests
-- ---------------------------------------------------------------------------

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('task', 'project')),
  item_id uuid not null,
  requested_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reason text check (reason is null or length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending', 'given', 'declined')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index access_requests_one_pending_idx on public.access_requests (item_type, item_id, requested_by) where status = 'pending';
create index access_requests_item_idx on public.access_requests (item_type, item_id);

/** Who can give access: a task's owner (or whoever made it), a project's owners, and Admins. */
create or replace function public.can_decide_access(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (public.is_active_user() and case p_type
    when 'task' then exists (
      select 1 from public.tasks t
       where t.id = p_id and t.deleted_at is null
         and (t.owner_id = auth.uid() or (t.owner_id is null and t.created_by = auth.uid())))
    when 'project' then public.can_manage_project(p_id)
    else false end);
$$;

/** The people who get asked. */
create or replace function public.access_deciders(p_type text, p_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(t.owner_id, t.created_by) from public.tasks t
   where p_type = 'task' and t.id = p_id and coalesce(t.owner_id, t.created_by) is not null
  union
  select m.user_id from public.project_members m where p_type = 'project' and m.project_id = p_id and m.role = 'lead'
  union
  select p.created_by from public.projects p where p_type = 'project' and p.id = p_id and p.created_by is not null;
$$;
revoke execute on function public.access_deciders(text, uuid) from public, anon, authenticated;

/**
 * What the lock screen shows: the item's name, who has access now, and
 * whether you already asked. Only for active people, and only names: nothing
 * inside the item. A project is looked up by its slug, a task by its id.
 */
create or replace function public.access_info(p_type text, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v jsonb;
begin
  if not public.is_active_user() then return null; end if;
  if p_type = 'task' then
    if p_key !~* '^[0-9a-f-]{36}$' then return null; end if;
    select jsonb_build_object(
             'id', t.id,
             'title', t.title,
             'locked', t.locked,
             'owner', public.person_label(coalesce(t.owner_id, t.created_by)),
             'teams', coalesce((
               select jsonb_agg(distinct d.name)
                 from public.departments d
                where d.id = t.department_id
                   or d.id in (select tt.department_id from public.task_teams tt where tt.task_id = t.id)), '[]'::jsonb),
             'people', coalesce((
               select jsonb_agg(public.person_label(c.user_id))
                 from public.task_collaborators c where c.task_id = t.id), '[]'::jsonb),
             'project', (select p.name from public.projects p where p.id = t.project_id),
             'can_read', public.can_read_task(t.id)),
           t.id
      into v, v_id
      from public.tasks t
     where t.id = p_key::uuid and t.deleted_at is null;
  elsif p_type = 'project' then
    select jsonb_build_object(
             'id', p.id,
             'title', p.name,
             'kind', p.kind,
             'slug', p.slug,
             'locked', p.locked,
             'owner', coalesce((
               select string_agg(public.person_label(m.user_id), ', ')
                 from public.project_members m where m.project_id = p.id and m.role = 'lead'),
               public.person_label(p.created_by)),
             'teams', coalesce((
               select jsonb_agg(distinct d.name)
                 from public.departments d
                where d.id = p.department_id
                   or d.id in (select pt.department_id from public.project_teams pt where pt.project_id = p.id)), '[]'::jsonb),
             'people', coalesce((
               select jsonb_agg(public.person_label(m.user_id))
                 from public.project_members m where m.project_id = p.id and m.role = 'member'), '[]'::jsonb),
             'can_read', public.is_project_member(p.id) or p.created_by = auth.uid()),
           p.id
      into v, v_id
      from public.projects p
     where p.slug = p_key;
  else
    return null;
  end if;
  if v is null then return null; end if;
  return v || jsonb_build_object(
    'type', p_type,
    'asked', exists (
      select 1 from public.access_requests r
       where r.item_type = p_type and r.item_id = v_id and r.requested_by = auth.uid() and r.status = 'pending'));
end;
$$;

/** Ask for access. Returns the request's id; asking twice keeps the first. */
create or replace function public.request_access(p_type text, p_key text, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  info jsonb := public.access_info(p_type, p_key);
  v_item uuid;
  v_req uuid;
  v_who uuid;
  v_href text;
begin
  if info is null then
    raise exception 'That doesn''t exist, or you can''t ask for it' using errcode = 'insufficient_privilege';
  end if;
  if (info ->> 'can_read')::boolean then
    raise exception 'You already have access';
  end if;
  v_item := (info ->> 'id')::uuid;
  select id into v_req from public.access_requests
   where item_type = p_type and item_id = v_item and requested_by = auth.uid() and status = 'pending';
  if v_req is not null then return v_req; end if;

  insert into public.access_requests (item_type, item_id, requested_by, reason)
  values (p_type, v_item, auth.uid(), nullif(left(trim(coalesce(p_reason, '')), 500), ''))
  returning id into v_req;

  v_href := '/access/' || v_req;
  for v_who in select * from public.access_deciders(p_type, v_item) loop
    perform public.notify(v_who, 'access', auth.uid(),
      coalesce(public.person_label(auth.uid()), 'Someone') || ' asked for access to ' || (info ->> 'title'),
      nullif(left(trim(coalesce(p_reason, '')), 500), ''), v_href, null);
  end loop;
  -- Nobody to ask (no owner left): the Admins.
  if not found then
    for v_who in select id from public.profiles where is_admin and status = 'active' loop
      perform public.notify(v_who, 'access', auth.uid(),
        coalesce(public.person_label(auth.uid()), 'Someone') || ' asked for access to ' || (info ->> 'title'),
        nullif(left(trim(coalesce(p_reason, '')), 500), ''), v_href, null);
    end loop;
  end if;
  return v_req;
end;
$$;

/** Give access or decline. Giving adds them as a collaborator (task) or a person on it (project). */
create or replace function public.decide_access(p_request uuid, p_give boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.access_requests;
  v_title text;
  v_href text;
begin
  select * into r from public.access_requests where id = p_request for update;
  if not found or not public.can_decide_access(r.item_type, r.item_id) then
    raise exception 'Only the owner can give access to this' using errcode = 'insufficient_privilege';
  end if;
  if r.status <> 'pending' then return; end if;

  if r.item_type = 'task' then
    select title, '/tasks/' || id into v_title, v_href from public.tasks where id = r.item_id;
    if p_give then
      insert into public.task_collaborators (task_id, user_id) values (r.item_id, r.requested_by) on conflict do nothing;
    end if;
  else
    select name, '/' || kind || 's/' || slug into v_title, v_href from public.projects where id = r.item_id;
    if p_give then
      insert into public.project_members (project_id, user_id, role) values (r.item_id, r.requested_by, 'member') on conflict do nothing;
    end if;
  end if;

  update public.access_requests
     set status = case when p_give then 'given' else 'declined' end, decided_by = auth.uid(), decided_at = now()
   where id = r.id;

  perform public.notify(r.requested_by, 'access', auth.uid(),
    case when p_give then coalesce(public.person_label(auth.uid()), 'Someone') || ' gave you access to ' || v_title
         else coalesce(public.person_label(auth.uid()), 'Someone') || ' declined your request for ' || v_title end,
    null, case when p_give then v_href else '/notifications' end, case when r.item_type = 'task' then r.item_id end);
end;
$$;

alter table public.access_requests enable row level security;
revoke all on public.access_requests from anon, authenticated;
grant select on public.access_requests to authenticated;

-- Your own requests, and the ones you can decide on. Written only through the functions above.
create policy access_requests_select on public.access_requests
  for select to authenticated
  using (requested_by = auth.uid() or public.can_decide_access(item_type, item_id));

revoke execute on function public.access_info(text, text), public.request_access(text, text, text), public.decide_access(uuid, boolean),
  public.can_decide_access(text, uuid) from public, anon;
grant execute on function public.access_info(text, text), public.request_access(text, text, text), public.decide_access(uuid, boolean),
  public.can_decide_access(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A task's activity: everyone who can read the task can read its history.
-- ---------------------------------------------------------------------------

create policy activity_log_select_task on public.activity_log
  for select to authenticated
  using (task_id is not null and public.can_read_task(task_id));

notify pgrst, 'reload schema';
