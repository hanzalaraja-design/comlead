-- 1. Comments on meetings, with @mentions.
-- 2. When a task was done: logging something after the fact no longer makes it late.

-- ---------------------------------------------------------------------------
-- 1. Meeting comments
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_comments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 10000),
  created_at timestamptz not null default now()
);
create index if not exists meeting_comments_meeting_idx on public.meeting_comments (meeting_id, created_at);

create table if not exists public.meeting_mentions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.meeting_comments (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  mentioned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  unique (comment_id, user_id)
);
create index if not exists meeting_mentions_user_idx on public.meeting_mentions (user_id, created_at desc);

-- Tagged in a meeting's comments: you can open that meeting.
create or replace function public.mentioned_in_meeting(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and exists (
    select 1 from public.meeting_mentions mm
     where mm.meeting_id = p_meeting_id and mm.user_id = auth.uid());
$$;

-- Who can see a meeting (the same rule as the meetings list).
create or replace function public.can_read_meeting(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.meetings m
     where m.id = p_meeting_id
       and (public.can_read_dept(m.department_id)
            or public.is_meeting_attendee(m.id)
            or (m.series_id is not null and public.is_series_invitee(m.series_id))
            or public.mentioned_in_meeting(m.id)));
$$;

grant execute on function public.mentioned_in_meeting(uuid), public.can_read_meeting(uuid) to authenticated;

drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings
  for select to authenticated
  using (public.can_read_dept(department_id)
         or public.is_meeting_attendee(id)
         or (series_id is not null and public.is_series_invitee(series_id))
         or public.mentioned_in_meeting(id));

alter table public.meeting_comments enable row level security;
revoke all on public.meeting_comments from anon, authenticated;
grant select, insert, delete on public.meeting_comments to authenticated;

drop policy if exists meeting_comments_select on public.meeting_comments;
create policy meeting_comments_select on public.meeting_comments
  for select to authenticated
  using (public.can_read_meeting(meeting_id));

drop policy if exists meeting_comments_insert on public.meeting_comments;
create policy meeting_comments_insert on public.meeting_comments
  for insert to authenticated
  with check (author_id = auth.uid() and public.is_active_user() and public.can_read_meeting(meeting_id));

drop policy if exists meeting_comments_delete on public.meeting_comments;
create policy meeting_comments_delete on public.meeting_comments
  for delete to authenticated
  using (author_id = auth.uid());

alter table public.meeting_mentions enable row level security;
revoke all on public.meeting_mentions from anon, authenticated;
grant select, update (seen_at) on public.meeting_mentions to authenticated;

drop policy if exists meeting_mentions_select on public.meeting_mentions;
create policy meeting_mentions_select on public.meeting_mentions
  for select to authenticated
  using (user_id = auth.uid() and public.is_active_user());

drop policy if exists meeting_mentions_update on public.meeting_mentions;
create policy meeting_mentions_update on public.meeting_mentions
  for update to authenticated
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid());

-- Called right after posting a comment: the tagged people get a mention.
create or replace function public.add_meeting_mentions(p_comment_id uuid, p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment public.meeting_comments;
begin
  select * into v_comment from public.meeting_comments where id = p_comment_id;
  if v_comment.id is null or v_comment.author_id is distinct from auth.uid() or not public.is_active_user() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;

  insert into public.meeting_mentions (comment_id, meeting_id, user_id, mentioned_by)
  select v_comment.id, v_comment.meeting_id, p.id, auth.uid()
    from public.profiles p
   where p.id = any (p_user_ids)
     and p.status = 'active'
     and p.id <> auth.uid()
  on conflict do nothing;
end;
$$;

revoke execute on function public.add_meeting_mentions(uuid, uuid[]) from public, anon;
grant execute on function public.add_meeting_mentions(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. When a task was done
--
--  * "Already done on <date>": a past completed_at given with the change is kept.
--  * Logged after the fact: a task added after its due date and ticked off the
--    same day counts as done on its due date, not late.
--  * The owner (or an Admin) can correct the date of a finished task.
-- The activity log still records when each change was actually made.
-- ---------------------------------------------------------------------------

create or replace function public.tasks_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    if new.completed_at is not null
       and new.completed_at <= now()
       and (tg_op = 'INSERT' or new.completed_at is distinct from old.completed_at) then
      null;  -- a date given with the change: keep it
    elsif new.due_date is not null
       and new.due_date < (coalesce(new.created_at, now()) at time zone 'Asia/Karachi')::date
       and (coalesce(new.created_at, now()) at time zone 'Asia/Karachi')::date = v_today then
      new.completed_at := least(now(), (new.due_date + coalesce(new.due_time, time '12:00')) at time zone 'Asia/Karachi');
    else
      new.completed_at := now();
    end if;
  elsif new.status = 'done' and new.completed_at is distinct from old.completed_at then
    -- Correcting when it was done.
    if new.completed_at is null or new.completed_at > now() then
      new.completed_at := old.completed_at;
    elsif auth.uid() is not null and new.owner_id is distinct from auth.uid() and not public.is_admin() then
      raise exception 'Only the task''s owner can change when it was done'
        using errcode = 'insufficient_privilege';
    end if;
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  if new.status <> 'blocked' then
    new.blocked_reason := null;
  end if;

  if tg_op = 'INSERT' and new.meeting_id is not null and new.source = 'manual' then
    new.source := 'meeting';
  end if;

  -- Tags: trimmed, no blanks, no duplicates.
  new.tags := coalesce(
    (select array_agg(distinct t order by t)
       from unnest(new.tags) as u(raw)
       cross join lateral (select trim(u.raw) as t) x
      where x.t <> ''),
    '{}');

  return new;
end;
$$;

notify pgrst, 'reload schema';
