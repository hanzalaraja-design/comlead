-- Campaigns can be a sale or a brand theme (what Highfy stands for in a
-- season). Existing campaigns count as sales. Safe to run twice.

alter table public.projects add column if not exists campaign_type text;
alter table public.projects drop constraint if exists projects_campaign_type_check;
alter table public.projects add constraint projects_campaign_type_check
  check (campaign_type is null or campaign_type in ('sale', 'theme'));

notify pgrst, 'reload schema';
