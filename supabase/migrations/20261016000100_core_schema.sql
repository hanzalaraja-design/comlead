-- Highfy Tasks: core schema (Phase 1)
-- Tables for people, departments, tasks, meetings and saved views.
-- Row Level Security policies live in 20261016000200_rls.sql.
-- Activity log triggers live in 20261016000300_activity_log.sql.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.user_status as enum ('pending', 'active', 'disabled');
create type public.dept_role as enum ('lead', 'member');
create type public.task_status as enum ('todo', 'in_progress', 'blocked', 'done', 'cancelled');
create type public.task_priority as enum ('urgent', 'high', 'medium', 'low');
create type public.task_source as enum ('manual', 'meeting', 'whatsapp');

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- All "today" logic uses Pakistan time.
create or replace function public.pkt_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Karachi')::date;
$$;

-- Start of the current week (Monday 00:00 PKT) as a timestamptz.
create or replace function public.pkt_week_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('week', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi';
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  avatar_url text,
  is_admin boolean not null default false,
  status public.user_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_highfy_email check (lower(email) like '%@highfy.pk')
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Departments and sub-teams
-- ---------------------------------------------------------------------------

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  archived boolean not null default false,
  sort_order integer not null default 0,
  -- Weekly meeting schedule. ISO weekday: 1 = Monday ... 7 = Sunday.
  meeting_weekday smallint check (meeting_weekday between 1 and 7),
  meeting_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger departments_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

create table public.sub_teams (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (department_id, name)
);

create index sub_teams_department_idx on public.sub_teams (department_id);

-- Membership carries the role. A person can be in several departments,
-- and lead some while being a member of others.
create table public.department_members (
  department_id uuid not null references public.departments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.dept_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (department_id, user_id)
);

create index department_members_user_idx on public.department_members (user_id);

-- ---------------------------------------------------------------------------
-- Meetings
-- ---------------------------------------------------------------------------

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id),
  sub_team_id uuid references public.sub_teams (id) on delete set null,
  title text,
  meeting_date date not null,
  meeting_time time,
  agenda text,
  minutes text,               -- HTML from the rich text editor
  decisions text[] not null default '{}',
  search tsvector,            -- maintained by trigger below
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meetings_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null
);

create index meetings_department_date_idx on public.meetings (department_id, meeting_date desc);
create index meetings_search_idx on public.meetings using gin (search);

create or replace function public.meetings_set_search()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search :=
    setweight(to_tsvector('english'::regconfig, coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(new.agenda, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, array_to_string(new.decisions, ' ')), 'B') ||
    setweight(to_tsvector('english'::regconfig,
      regexp_replace(coalesce(new.minutes, ''), '<[^>]+>', ' ', 'g')), 'C');
  return new;
end;
$$;

create trigger meetings_search
  before insert or update of title, agenda, decisions, minutes on public.meetings
  for each row execute function public.meetings_set_search();

create trigger meetings_updated_at
  before update on public.meetings
  for each row execute function public.set_updated_at();

create table public.meeting_attendees (
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (meeting_id, user_id)
);

create index meeting_attendees_user_idx on public.meeting_attendees (user_id);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,           -- HTML from the rich text editor
  department_id uuid not null references public.departments (id),
  sub_team_id uuid references public.sub_teams (id) on delete set null,
  owner_id uuid,
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  due_date date,
  due_time time,
  source public.task_source not null default 'manual',
  meeting_id uuid,
  tags text[] not null default '{}',
  blocked_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint tasks_owner_id_fkey foreign key (owner_id) references public.profiles (id) on delete set null,
  constraint tasks_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
  constraint tasks_deleted_by_fkey foreign key (deleted_by) references public.profiles (id) on delete set null,
  constraint tasks_meeting_id_fkey foreign key (meeting_id) references public.meetings (id) on delete set null,
  constraint tasks_due_time_needs_date check (due_time is null or due_date is not null)
);

create index tasks_department_status_idx on public.tasks (department_id, status) where deleted_at is null;
create index tasks_owner_idx on public.tasks (owner_id) where deleted_at is null;
create index tasks_due_idx on public.tasks (due_date) where deleted_at is null;
create index tasks_meeting_idx on public.tasks (meeting_id);
create index tasks_completed_idx on public.tasks (completed_at);
create index tasks_tags_idx on public.tasks using gin (tags);

-- Keep completed_at, blocked_reason and source consistent.
create or replace function public.tasks_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := now();
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

create trigger tasks_normalize
  before insert or update on public.tasks
  for each row execute function public.tasks_normalize();

create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create table public.task_collaborators (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (task_id, user_id)
);

create index task_collaborators_user_idx on public.task_collaborators (user_id);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid not null default auth.uid(),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  constraint task_comments_author_id_fkey foreign key (author_id) references public.profiles (id) on delete cascade
);

create index task_comments_task_idx on public.task_comments (task_id, created_at);

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint task_attachments_uploaded_by_fkey foreign key (uploaded_by) references public.profiles (id) on delete cascade,
  -- Files live under "<task_id>/..." in the task-attachments bucket.
  constraint task_attachments_path_matches_task check (storage_path like task_id::text || '/%')
);

create index task_attachments_task_idx on public.task_attachments (task_id);

-- ---------------------------------------------------------------------------
-- Saved views (a named task list URL)
-- ---------------------------------------------------------------------------

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  path text not null check (path like '/%'),
  created_at timestamptz not null default now()
);

create index saved_views_user_idx on public.saved_views (user_id);

-- ---------------------------------------------------------------------------
-- Profile creation on first login
-- ---------------------------------------------------------------------------

-- Runs when Supabase Auth creates a user. Non-Highfy emails are rejected
-- outright, so no account is ever created for them. The CEO account is
-- bootstrapped as an active Admin so someone can approve everyone else.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(new.email);
  v_is_ceo boolean := v_email = 'hanzala@highfy.pk';
begin
  if v_email is null or v_email not like '%@highfy.pk' then
    raise exception 'Only @highfy.pk accounts may sign in'
      using errcode = 'check_violation';
  end if;

  insert into public.profiles (id, email, full_name, avatar_url, is_admin, status)
  values (
    new.id,
    v_email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    v_is_ceo,
    case when v_is_ceo then 'active'::public.user_status else 'pending'::public.user_status end
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
