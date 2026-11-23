-- Partnership tags can be deleted, by anyone (just as anyone can create one).
-- A deleted tag comes off every partnership it was on. Safe to run twice.

grant delete on public.partnership_tags to authenticated;
drop policy if exists partnership_tags_delete on public.partnership_tags;
create policy partnership_tags_delete on public.partnership_tags for delete to authenticated
  using (public.is_active_user());

notify pgrst, 'reload schema';
