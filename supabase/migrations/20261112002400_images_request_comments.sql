-- 1. Screenshots pasted into descriptions and comments.
-- 2. Comments on placement requests (with screenshots too).
-- 3. Designers can mark a request complete, with or without sending it for review;
--    whoever asked can ask for a revision at any point after that.

-- ---------------------------------------------------------------------------
-- 1. Pasted images: a private bucket, files under "<uploader id>/".
--    The app shows them through /api/files, which checks you're signed in.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('inline-files', 'inline-files', false, 15728640) -- 15 MB
on conflict (id) do nothing;

drop policy if exists inline_files_select on storage.objects;
create policy inline_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'inline-files' and public.is_active_user());

drop policy if exists inline_files_insert on storage.objects;
create policy inline_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'inline-files' and public.is_active_user() and name like auth.uid()::text || '/%');

alter table public.task_comments add column if not exists image_paths text[] not null default '{}';
-- A comment can be just a screenshot.
alter table public.task_comments drop constraint if exists task_comments_body_check;
alter table public.task_comments drop constraint if exists task_comments_not_empty;
alter table public.task_comments add constraint task_comments_not_empty check (length(trim(body)) > 0 or cardinality(image_paths) > 0);

-- ---------------------------------------------------------------------------
-- 2. Comments on placement requests
-- ---------------------------------------------------------------------------

create table if not exists public.creative_request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.creative_requests (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null default '' check (length(body) <= 10000),
  image_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint creative_request_comments_not_empty check (length(trim(body)) > 0 or cardinality(image_paths) > 0)
);
create index if not exists creative_request_comments_request_idx on public.creative_request_comments (request_id, created_at);

alter table public.creative_request_comments enable row level security;
revoke all on public.creative_request_comments from anon, authenticated;
grant select, insert, delete on public.creative_request_comments to authenticated;

drop policy if exists creative_request_comments_select on public.creative_request_comments;
create policy creative_request_comments_select on public.creative_request_comments
  for select to authenticated using (public.is_active_user());

drop policy if exists creative_request_comments_insert on public.creative_request_comments;
create policy creative_request_comments_insert on public.creative_request_comments
  for insert to authenticated with check (public.is_active_user() and author_id = auth.uid());

drop policy if exists creative_request_comments_delete on public.creative_request_comments;
create policy creative_request_comments_delete on public.creative_request_comments
  for delete to authenticated using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. "Completed" by the designer, and revisions
-- ---------------------------------------------------------------------------

alter table public.creative_requests drop constraint if exists creative_requests_status_check;
alter table public.creative_requests add constraint creative_requests_status_check
  check (status in ('requested', 'in_design', 'in_review', 'approved', 'done', 'live', 'cancelled'));

create or replace function public.creative_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_asker boolean := public.is_admin() or auth.uid() = old.requested_by;
  v_design boolean := public.is_admin() or public.in_placement_team('design');
begin
  new.updated_at := now();
  if new.status = 'live' and old.status is distinct from 'live' then new.live_at := now(); end if;
  if new.status in ('in_review', 'done') and old.status not in ('in_review', 'done') then
    new.version := old.version + 1;
    new.change_note := null;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if new.requested_by is distinct from old.requested_by or new.created_at is distinct from old.created_at or new.channel is distinct from old.channel then
    raise exception 'That can''t be changed' using errcode = 'insufficient_privilege';
  end if;

  if (new.title, new.formats, new.brief, new.project_id, new.needed_by, new.live_from, new.live_to, new.ref_paths)
     is distinct from (old.title, old.formats, old.brief, old.project_id, old.needed_by, old.live_from, old.live_to, old.ref_paths)
     and not v_asker then
    raise exception 'Only whoever asked can change the request' using errcode = 'insufficient_privilege';
  end if;

  if (new.designer_id is distinct from old.designer_id or new.art_paths is distinct from old.art_paths) and not v_design then
    raise exception 'Only Design can do that' using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status then
    if new.status in ('in_review', 'done') and not v_design then
      raise exception 'Only Design can send it for review or mark it complete' using errcode = 'insufficient_privilege';
    elsif new.status = 'in_design' and old.status = 'requested' and not v_design then
      raise exception 'Only Design can start it' using errcode = 'insufficient_privilege';
    elsif new.status = 'in_design' and old.status in ('in_review', 'approved', 'done', 'live') and not v_asker then
      raise exception 'Only whoever asked can ask for a revision' using errcode = 'insufficient_privilege';
    elsif new.status in ('approved', 'live', 'cancelled') and not v_asker then
      raise exception 'Only whoever asked can do that' using errcode = 'insufficient_privilege';
    elsif new.status = 'requested' and not v_design and not v_asker then
      raise exception 'Not allowed' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
