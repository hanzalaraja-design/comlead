-- Daily deals is for everyone. Its sheet shows the announcement bar and hero
-- slides 1 and 2, which are homepage bookings; since the App / Website tab
-- became team-only, people outside those teams saw an empty sheet. These
-- bookings can be seen by everyone again (changing them follows the usual rules).

drop policy if exists placements_select_daily_deals on public.placements;
create policy placements_select_daily_deals on public.placements
  for select to authenticated
  using (public.is_active_user()
         and ((section_key = 'announcement' and position = 1) or (section_key = 'hero' and position in (1, 2))));

notify pgrst, 'reload schema';
