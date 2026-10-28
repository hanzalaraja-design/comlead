-- Descriptions on projects, campaigns and partnerships are rich text now, and
-- can hold tables pasted from Excel, so they can be longer than 2,000 characters.

alter table public.projects drop constraint if exists projects_description_check;
alter table public.projects add constraint projects_description_check check (length(description) <= 100000);

notify pgrst, 'reload schema';
