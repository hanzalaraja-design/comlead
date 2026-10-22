import { getDepartmentMembers, getDepartments, getPeople, isMemberOf, type Viewer } from "@/lib/auth";
import { getProjects, membersByProject } from "@/lib/projects";

/** Everything the task form needs, scoped to what the viewer may do. */
export async function getTaskFormData(viewer: Viewer, includeDepartmentId?: string, includeProjectId?: string) {
  const [departments, allProjects, people, members] = await Promise.all([
    getDepartments(),
    getProjects(),
    getPeople(),
    getDepartmentMembers(),
  ]);

  const membersByDept: Record<string, string[]> = {};
  for (const m of members) (membersByDept[m.department_id] ??= []).push(m.user_id);
  // Projects you're in (RLS decides), plus the task's own.
  const projects = allProjects.filter((p) => !p.archived || p.id === includeProjectId);

  return {
    // You can only put tasks in departments you belong to.
    departments: departments
      .filter((d) => (!d.archived && isMemberOf(viewer, d.id)) || d.id === includeDepartmentId)
      .map((d) => ({ id: d.id, name: d.name, slug: d.slug })),
    projects: projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug, department_id: p.department_id })),
    people,
    membersByDept,
    membersByProject: await membersByProject(projects),
  };
}
