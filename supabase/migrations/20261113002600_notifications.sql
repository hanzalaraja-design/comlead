-- Highfy Tasks: notifications on the Notifications page and as push (phone
-- and browser). Replaces the emails. Task events come from the activity log
-- (written by triggers), so nothing is missed whichever way a task changes;
-- placements and design requests notify from the app.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  title text not null,
  body text,
  href text,
  task_id uuid references public.tasks (id) on delete cascade,
  in_feed boolean not null default true,
  push boolean not null default false,
  pushed_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_feed_idx on public.notifications (user_id, created_at desc) where in_feed;
create index notifications_user_unread_idx on public.notifications (user_id) where in_feed and read_at is null;
create index notifications_push_pending_idx on public.notifications (created_at) where push and pushed_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- What each person wants. No row = the defaults below.
create table public.notification_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade default auth.uid(),
  feed_off text[] not null default '{}',
  push_off text[] not null default '{status,due,edits,project_task,meeting,ending}',
  quiet_from time,            -- no push between these (Pakistan time)
  quiet_to time,
  quiet_days int[] not null default '{}', -- 0 = Sunday … 6 = Saturday
  paused_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.notification_settings enable row level security;
revoke all on public.notification_settings from anon, authenticated;
grant select, insert, update on public.notification_settings to authenticated;
create policy notification_settings_own on public.notification_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- One row per phone or browser that turned push on.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Writer
-- ---------------------------------------------------------------------------

create or replace function public.person_label(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) from public.profiles where id = p_id;
$$;

/** Notify one person, as their settings say. Never the person who did it. */
create or replace function public.notify(
  p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text default null, p_href text default null, p_task uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.notification_settings;
  v_feed boolean;
  v_push boolean;
  v_now timestamp := (now() at time zone 'Asia/Karachi');
begin
  if p_user is null or p_user is not distinct from p_actor then return; end if;
  if not exists (select 1 from public.profiles where id = p_user and status = 'active') then return; end if;
  select * into s from public.notification_settings where user_id = p_user;
  if not found then
    s.feed_off := '{}';
    s.push_off := '{status,due,edits,project_task,meeting,ending}';
    s.quiet_days := '{}';
  end if;
  v_feed := not (p_kind = any (s.feed_off));
  v_push := not (p_kind = any (s.push_off));
  if v_push and (
       (s.paused_until is not null and s.paused_until > now())
    or extract(dow from v_now)::int = any (s.quiet_days)
    or (s.quiet_from is not null and s.quiet_to is not null and (
          case when s.quiet_from <= s.quiet_to then v_now::time >= s.quiet_from and v_now::time < s.quiet_to
               else v_now::time >= s.quiet_from or v_now::time < s.quiet_to end))) then
    v_push := false;
  end if;
  if not v_feed and not v_push then return; end if;
  -- The same thing twice in a row (e.g. several quick edits) stays one notification.
  if exists (
    select 1 from public.notifications
     where user_id = p_user and kind = p_kind and task_id is not distinct from p_task and title = left(p_title, 300) and body is not distinct from left(p_body, 500)
       and created_at > now() - interval '2 minutes') then
    return;
  end if;
  insert into public.notifications (user_id, kind, actor_id, title, body, href, task_id, in_feed, push)
  values (p_user, p_kind, p_actor, left(p_title, 300), left(p_body, 500), p_href, p_task, v_feed, v_push);
end;
$$;
revoke execute on function public.notify(uuid, text, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.notify(uuid, text, uuid, text, text, text, uuid) to service_role;

/** Push to send: marks them sent so two servers never send the same one. */
create or replace function public.claim_pushes()
returns table (id uuid, user_id uuid, title text, body text, href text)
language sql
security definer
set search_path = ''
as $$
  update public.notifications n set pushed_at = now()
   where n.push and n.pushed_at is null and n.created_at > now() - interval '30 minutes'
  returning n.id, n.user_id, n.title, n.body, n.href;
$$;
revoke execute on function public.claim_pushes() from public, anon, authenticated;
grant execute on function public.claim_pushes() to service_role;

-- ---------------------------------------------------------------------------
-- Task events, from the activity log
-- ---------------------------------------------------------------------------

/** Whoever owns, made or works on a task (and, for a subtask, the main task's owner). */
create or replace function public.task_people(p_task uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select owner_id from public.tasks where id = p_task and owner_id is not null
  union select created_by from public.tasks where id = p_task and created_by is not null
  union select user_id from public.task_collaborators where task_id = p_task
  union select p.owner_id from public.tasks t join public.tasks p on p.id = t.parent_task_id where t.id = p_task and p.owner_id is not null;
$$;

create or replace function public.notify_from_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  v_who text := coalesce(public.person_label(new.actor_id), 'Someone');
  v_title text := '“' || coalesce(new.entity_label, 'a task') || '”';
  v_href text := case when new.task_id is not null then '/tasks/' || new.task_id end;
  v_status text;
  u uuid;
begin
  if new.task_id is null or new.action = 'task.deleted' then return null; end if;
  select * into t from public.tasks where id = new.task_id;
  if not found then return null; end if;

  case new.action
  when 'task.created' then
    perform public.notify(t.owner_id, 'assigned', new.actor_id,
      v_who || ' gave you ' || v_title,
      case when t.due_date is not null then 'Due ' || to_char(t.due_date, 'Dy DD Mon') end, v_href, t.id);
    if t.parent_task_id is not null then
      for u in select p.owner_id from public.tasks p where p.id = t.parent_task_id and p.owner_id is distinct from t.owner_id loop
        perform public.notify(u, 'edits', new.actor_id, v_who || ' added a subtask: ' || v_title, null, v_href, t.id);
      end loop;
    end if;
    if t.project_id is not null then
      for u in select m.user_id from public.project_members m where m.project_id = t.project_id and m.role = 'lead' and m.user_id is distinct from t.owner_id loop
        perform public.notify(u, 'project_task', new.actor_id,
          v_who || ' added ' || v_title || ' to ' || coalesce((select name from public.projects where id = t.project_id), 'a project'), null, v_href, t.id);
      end loop;
    end if;
  when 'task.reassigned' then
    perform public.notify(t.owner_id, 'assigned', new.actor_id, v_who || ' gave you ' || v_title,
      case when t.due_date is not null then 'Due ' || to_char(t.due_date, 'Dy DD Mon') end, v_href, t.id);
  when 'task.completed' then
    for u in select public.task_people(t.id) loop
      perform public.notify(u, 'finished', new.actor_id, v_who || ' finished ' || v_title, null, v_href, t.id);
    end loop;
  when 'task.status_changed' then
    v_status := case new.new_value ->> 'status' when 'in_progress' then 'In progress' when 'blocked' then 'Blocked' when 'todo' then 'To do' else new.new_value ->> 'status' end;
    for u in select public.task_people(t.id) loop
      perform public.notify(u, 'status', new.actor_id, v_who || ' moved ' || v_title || ' to ' || v_status,
        case when new.new_value ->> 'status' = 'blocked' then new.new_value ->> 'blocked_reason' end, v_href, t.id);
    end loop;
  when 'task.due_changed' then
    for u in select public.task_people(t.id) loop
      perform public.notify(u, 'due', new.actor_id,
        v_who || case when t.due_date is null then ' removed the due date of ' || v_title
                      else ' moved ' || v_title || ' to ' || to_char(t.due_date, 'Dy DD Mon') end, null, v_href, t.id);
    end loop;
  when 'task.edited' then
    if new.new_value ?| array['title', 'description', 'department_id', 'start_date', 'blocked_reason', 'meeting_id'] then
      for u in select public.task_people(t.id) loop
        perform public.notify(u, 'edits', new.actor_id, v_who || ' edited ' || v_title, null, v_href, t.id);
      end loop;
    end if;
  when 'task.collaborator_added' then
    perform public.notify(new.subject_user_id, 'collaborator', new.actor_id, v_who || ' added you to ' || v_title, null, v_href, t.id);
  when 'attachment.added' then
    for u in select public.task_people(t.id) loop
      perform public.notify(u, 'edits', new.actor_id, v_who || ' attached ' || coalesce(new.new_value ->> 'file_name', 'a file') || ' to ' || v_title, null, v_href, t.id);
    end loop;
  when 'comment.added' then
    -- Owner, maker, collaborators and anyone who commented before.
    for u in
      select public.task_people(t.id)
      union select c.author_id from public.task_comments c where c.task_id = t.id
    loop
      perform public.notify(u, 'comment', new.actor_id, v_who || ' commented on ' || v_title,
        nullif(regexp_replace(coalesce(new.new_value ->> 'body', ''), '\s+', ' ', 'g'), ''), v_href || '#comments', t.id);
    end loop;
  else
    null;
  end case;
  return null;
end;
$$;

create trigger activity_log_notify
  after insert on public.activity_log
  for each row execute function public.notify_from_activity();

-- @mentions: a mention replaces the plain "commented" (and "added you") one for that person.
create or replace function public.notify_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_body text;
begin
  select title into v_title from public.tasks where id = new.task_id;
  select regexp_replace(body, '\s+', ' ', 'g') into v_body from public.task_comments where id = new.comment_id;
  delete from public.notifications
   where user_id = new.user_id and kind in ('comment', 'collaborator') and task_id = new.task_id and pushed_at is null
     and created_at > now() - interval '5 minutes';
  perform public.notify(new.user_id, 'mention', new.mentioned_by,
    coalesce(public.person_label(new.mentioned_by), 'Someone') || ' mentioned you on “' || coalesce(v_title, 'a task') || '”',
    v_body, '/tasks/' || new.task_id || '#comments', new.task_id);
  return null;
end;
$$;

create trigger task_mentions_notify
  after insert on public.task_mentions
  for each row execute function public.notify_mention();

-- Added to a project, campaign or partnership.
create or replace function public.notify_project_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.projects;
begin
  select * into p from public.projects where id = new.project_id;
  perform public.notify(new.user_id, 'project_added', auth.uid(),
    coalesce(public.person_label(auth.uid()), 'Someone') || ' added you to ' || p.name
      || case when new.role = 'lead' then ' as an owner' else '' end,
    null, '/' || p.kind || 's/' || p.slug, null);
  return null;
end;
$$;

create trigger project_members_notify
  after insert on public.project_members
  for each row execute function public.notify_project_member();

-- Added to a meeting.
create or replace function public.notify_meeting_attendee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = new.meeting_id;
  perform public.notify(new.user_id, 'meeting', auth.uid(),
    coalesce(public.person_label(auth.uid()), 'Someone') || ' added you to ' || coalesce(m.title, 'a meeting') || ' on ' || to_char(m.meeting_date, 'Dy DD Mon'),
    null, '/meetings/' || m.id, null);
  return null;
end;
$$;

create trigger meeting_attendees_notify
  after insert on public.meeting_attendees
  for each row execute function public.notify_meeting_attendee();

-- Old mentions count as read now that they live on the Notifications page.
update public.task_mentions set seen_at = now() where seen_at is null;

notify pgrst, 'reload schema';
