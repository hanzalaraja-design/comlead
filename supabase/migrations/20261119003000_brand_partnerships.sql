-- Brand partnerships: three categories with Notion-style tags, a list
-- everyone can see, terms for each period of a deal, and comments.
--
--  * Categories are now Associations, Referral and Fintech. The old Beauty /
--    Strategic split goes; existing partnerships start with no category.
--  * Tags belong to a category. Anyone can create one; it's shared.
--  * Everyone sees the list of partnerships (name, category, tags, owner).
--    Opening one still needs access (or a request for it).
--  * "Parts" of a project: separate pieces with their own stage, fields and
--    description. Partnerships use them as terms (Nov to Dec 2026, 2027
--    renewal); journeys use them next. Anyone in the project can edit them.
--  * Comments on a project, campaign or partnership.
-- Nothing changes about owners, people, teams or who can open what.

-- ---------------------------------------------------------------------------
-- 1. Categories
-- ---------------------------------------------------------------------------

alter table public.projects drop constraint if exists projects_category_check;
update public.projects set category = null where category in ('beauty', 'non_beauty');
alter table public.projects add constraint projects_category_check
  check (category is null or category in ('associations', 'referral', 'fintech'));

-- ---------------------------------------------------------------------------
-- 2. Tags
-- ---------------------------------------------------------------------------

create table public.partnership_tags (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('associations', 'referral', 'fintech')),
  name text not null check (length(trim(name)) between 1 and 40),
  color text not null default 'gray' check (color in ('gray', 'purple', 'blue', 'green', 'amber', 'pink', 'teal')),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index partnership_tags_name_idx on public.partnership_tags (category, lower(trim(name)));

create table public.project_tags (
  project_id uuid not null references public.projects (id) on delete cascade,
  tag_id uuid not null references public.partnership_tags (id) on delete cascade,
  primary key (project_id, tag_id)
);
create index project_tags_tag_idx on public.project_tags (tag_id);

insert into public.partnership_tags (category, name, color, created_by) values
  ('referral', 'Discount only', 'green', null),
  ('referral', 'Discount + commission', 'amber', null),
  ('fintech', 'BNPL', 'blue', null),
  ('fintech', 'Card discounts', 'pink', null)
on conflict do nothing;

alter table public.partnership_tags enable row level security;
alter table public.project_tags enable row level security;
revoke all on public.partnership_tags, public.project_tags from anon;
grant select, insert on public.partnership_tags to authenticated;
grant select, insert, delete on public.project_tags to authenticated;

-- Everyone sees the tags (they show on the list); anyone can add one.
create policy partnership_tags_select on public.partnership_tags for select to authenticated using (public.is_active_user());
create policy partnership_tags_insert on public.partnership_tags for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());

-- Tags on a partnership: seen by everyone, set by the people in it.
create policy project_tags_select on public.project_tags for select to authenticated using (public.is_active_user());
create policy project_tags_insert on public.project_tags for insert to authenticated
  with check (public.is_project_member(project_id));
create policy project_tags_delete on public.project_tags for delete to authenticated
  using (public.is_project_member(project_id));

-- ---------------------------------------------------------------------------
-- 3. The list everyone sees
-- ---------------------------------------------------------------------------

/** Every partnership's name, category, owner and tags, and whether you can open it. Nothing inside. */
create or replace function public.partnership_directory()
returns table (id uuid, name text, slug text, category text, archived boolean, locked boolean, owner text, can_open boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.slug, p.category, p.archived, p.locked,
         coalesce((select string_agg(public.person_label(m.user_id), ', ' order by m.added_at)
                     from public.project_members m where m.project_id = p.id and m.role = 'lead'),
                  public.person_label(p.created_by)),
         public.is_project_member(p.id) or p.created_by = auth.uid()
    from public.projects p
   where p.kind = 'partnership' and public.is_active_user()
   order by p.archived, p.name;
$$;
revoke execute on function public.partnership_directory() from public, anon;
grant execute on function public.partnership_directory() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Parts: terms of a partnership (and, next, journeys)
-- ---------------------------------------------------------------------------

create table public.project_parts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('term', 'journey')),
  name text not null check (length(trim(name)) between 1 and 120),
  sort int not null default 0,
  stage text not null default 'draft',
  starts_on date,
  ends_on date check (ends_on is null or starts_on is null or ends_on >= starts_on),
  description text check (description is null or length(description) <= 20000),
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  extra jsonb not null default '{}'::jsonb,
  renewed_from uuid references public.project_parts (id) on delete set null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_parts_stage_check check (
    (kind = 'term' and stage in ('draft', 'in_talks', 'agreed', 'live', 'ended'))
    or (kind = 'journey' and stage in ('idea', 'drafting', 'design', 'review', 'approved', 'live')))
);
create index project_parts_project_idx on public.project_parts (project_id, kind, sort);

alter table public.project_parts enable row level security;
revoke all on public.project_parts from anon;
grant select, insert, update, delete on public.project_parts to authenticated;

-- The people in the project see and edit its parts.
create policy project_parts_select on public.project_parts for select to authenticated using (public.is_project_member(project_id));
create policy project_parts_insert on public.project_parts for insert to authenticated with check (public.is_project_member(project_id));
create policy project_parts_update on public.project_parts for update to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));
create policy project_parts_delete on public.project_parts for delete to authenticated using (public.is_project_member(project_id));

create or replace function public.project_parts_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger project_parts_touch before update on public.project_parts
  for each row execute function public.project_parts_touch();

-- ---------------------------------------------------------------------------
-- 5. Comments on a project, campaign or partnership
-- ---------------------------------------------------------------------------

create table public.project_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  part_id uuid references public.project_parts (id) on delete set null,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 10000),
  created_at timestamptz not null default now()
);
create index project_comments_project_idx on public.project_comments (project_id, created_at);

alter table public.project_comments enable row level security;
revoke all on public.project_comments from anon;
grant select, insert, delete on public.project_comments to authenticated;
create policy project_comments_select on public.project_comments for select to authenticated using (public.is_project_member(project_id));
create policy project_comments_insert on public.project_comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_project_member(project_id));
create policy project_comments_delete on public.project_comments for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- Everyone else in the project hears about a new comment.
create or replace function public.notify_project_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.projects;
  v_who uuid;
begin
  select * into p from public.projects where id = new.project_id;
  for v_who in
    select m.user_id from public.project_members m where m.project_id = p.id
    union select p.created_by
  loop
    perform public.notify(v_who, 'comment', new.author_id,
      coalesce(public.person_label(new.author_id), 'Someone') || ' commented on ' || p.name,
      left(new.body, 200), '/' || p.kind || 's/' || p.slug || '#comments', null);
  end loop;
  return null;
end;
$$;
create trigger project_comments_notify after insert on public.project_comments
  for each row execute function public.notify_project_comment();

-- ---------------------------------------------------------------------------
-- 6. Activity: changes to parts and comments go in the activity log, and the
--    people in the project can read them (and the history of its tasks).
-- ---------------------------------------------------------------------------

create or replace function public.log_project_part()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.project_parts := coalesce(new, old);
  v_action text;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := r.kind || '.created';
    v_new := jsonb_build_object('project_id', r.project_id, 'name', r.name);
  elsif tg_op = 'DELETE' then
    v_action := r.kind || '.deleted';
    v_new := jsonb_build_object('project_id', r.project_id, 'name', r.name);
  elsif new.stage is distinct from old.stage then
    v_action := r.kind || '.stage_changed';
    v_old := jsonb_build_object('stage', old.stage);
    v_new := jsonb_build_object('project_id', r.project_id, 'stage', new.stage, 'name', new.name);
  elsif new.sort is distinct from old.sort and new.name = old.name and new.fields = old.fields
        and new.description is not distinct from old.description then
    return null; -- reordering isn't worth a line
  else
    v_action := r.kind || '.edited';
    v_new := jsonb_build_object('project_id', r.project_id, 'name', new.name);
  end if;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, entity_label, old_value, new_value)
  values (auth.uid(), v_action, r.kind, r.id, r.name, v_old, v_new);
  return null;
end;
$$;
create trigger project_parts_log after insert or update or delete on public.project_parts
  for each row execute function public.log_project_part();

create or replace function public.log_project_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activity_log (actor_id, action, entity_type, entity_id, entity_label, new_value)
  values (new.author_id, 'project.commented', 'project', new.project_id,
          (select name from public.projects where id = new.project_id),
          jsonb_build_object('project_id', new.project_id, 'body', left(new.body, 200)));
  return null;
end;
$$;
create trigger project_comments_log after insert on public.project_comments
  for each row execute function public.log_project_comment();

create policy activity_log_select_project on public.activity_log
  for select to authenticated
  using (new_value ? 'project_id' and entity_type in ('term', 'journey', 'project')
         and public.is_project_member((new_value ->> 'project_id')::uuid));

notify pgrst, 'reload schema';
