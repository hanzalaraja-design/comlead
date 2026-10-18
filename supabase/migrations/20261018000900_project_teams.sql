-- Teams are either a department or a project team. A project team is a team
-- like any other (members, dept admins, tasks, meetings), usually with
-- people from several departments. Sub-teams are no longer used by the app.
alter table public.departments
  add column if not exists kind text not null default 'department';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'departments_kind_check') then
    alter table public.departments add constraint departments_kind_check check (kind in ('department', 'project'));
  end if;
end $$;

notify pgrst, 'reload schema';
