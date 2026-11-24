-- Follow-up meetings: a meeting set up as a follow-up remembers which meeting
-- it follows, so it shows under it (on its page and in the Meetings list) and
-- carries its open action items. Who can see or change it is unchanged.
-- Safe to run twice.

alter table public.meeting_series
  add column if not exists follow_up_of uuid references public.meetings (id) on delete set null;
create index if not exists meeting_series_follow_up_idx on public.meeting_series (follow_up_of) where follow_up_of is not null;

notify pgrst, 'reload schema';
