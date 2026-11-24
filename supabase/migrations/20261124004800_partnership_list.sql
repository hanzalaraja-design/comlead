-- Brand partnerships list: each partnership's status and dates, from its
-- current term (the live one, else the next agreed, in talks or draft one,
-- else the last that ended). Everyone sees them in the list, like the name
-- and tags. Tags can also be renamed and recoloured, by anyone (as anyone can
-- create or delete one). Safe to run twice.

drop function if exists public.partnership_directory();
create function public.partnership_directory()
returns table (id uuid, name text, slug text, category text, categories text[], archived boolean, locked boolean, owner text, can_open boolean,
               term_stage text, term_starts date, term_ends date)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.slug, p.category, p.categories, p.archived, p.locked,
         coalesce((select string_agg(public.person_label(m.user_id), ', ' order by m.added_at)
                     from public.project_members m where m.project_id = p.id and m.role = 'lead'),
                  public.person_label(p.created_by)),
         public.is_project_member(p.id) or p.created_by = auth.uid(),
         t.stage, t.starts_on, t.ends_on
    from public.projects p
    left join lateral (
      select x.stage, x.starts_on, x.ends_on
        from public.project_parts x
       where x.project_id = p.id and x.kind = 'term'
       order by case x.stage when 'live' then 0 when 'agreed' then 1 when 'in_talks' then 2 when 'draft' then 3 else 4 end,
                case when x.stage = 'ended' then x.ends_on end desc nulls last,
                x.starts_on nulls last, x.created_at desc
       limit 1) t on true
   where p.kind = 'partnership' and public.is_active_user()
   order by p.archived, p.name;
$$;
revoke execute on function public.partnership_directory() from public, anon;
grant execute on function public.partnership_directory() to authenticated;

-- Rename a tag or change its colour.
grant update (name, color) on public.partnership_tags to authenticated;
drop policy if exists partnership_tags_update on public.partnership_tags;
create policy partnership_tags_update on public.partnership_tags for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

notify pgrst, 'reload schema';
