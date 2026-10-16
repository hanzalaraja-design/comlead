-- Departments and sub-teams from SPEC.md section 4.
-- Safe to run more than once.

insert into public.departments (name, slug, sort_order) values
  ('Commercial', 'commercial', 1),
  ('Ops', 'ops', 2),
  ('Finance', 'finance', 3),
  ('Marketing', 'marketing', 4),
  ('Content', 'content', 5),
  ('Brand', 'brand', 6),
  ('HR', 'hr', 7),
  ('Customer Experience', 'customer-experience', 8)
on conflict (slug) do nothing;

insert into public.sub_teams (department_id, name)
select d.id, s.name
  from public.departments d
  cross join (values ('SEO'), ('Affiliate'), ('CRM'), ('Performance')) as s(name)
 where d.slug = 'marketing'
on conflict (department_id, name) do nothing;
