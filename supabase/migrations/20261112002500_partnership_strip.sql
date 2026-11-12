-- An optional Partnership strip on the homepage (website and app), under the
-- hero carousel. Optional sections can stay empty: they're never flagged as
-- "empty today".

alter table public.placement_sections add column if not exists optional boolean not null default false;

insert into public.placement_sections (key, name, kind, slots, labels, sort, optional)
values ('partnership_strip', 'Partnership strip', 'banner', 1, '{}', 45, true)
on conflict (key) do update set optional = true;

notify pgrst, 'reload schema';
