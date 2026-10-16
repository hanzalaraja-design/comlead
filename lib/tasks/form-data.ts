import { getDepartmentMembers, getDepartments, getPeople, getSubTeams, isMemberOf, type Viewer } from "@/lib/auth";

/** Everything the task form needs, scoped to what the viewer may do. */
export async function getTaskFormData(viewer: Viewer, includeDepartmentId?: string) {
  const [departments, subTeams, people, members] = await Promise.all([
    getDepartments(),
    getSubTeams(),
    getPeople(),
    getDepartmentMembers(),
  ]);

  const membersByDept: Record<string, string[]> = {};
  for (const m of members) (membersByDept[m.department_id] ??= []).push(m.user_id);

  return {
    // You can only put tasks in departments you belong to.
    departments: departments
      .filter((d) => (!d.archived && isMemberOf(viewer, d.id)) || d.id === includeDepartmentId)
      .map((d) => ({ id: d.id, name: d.name, slug: d.slug })),
    subTeams,
    people,
    membersByDept,
  };
}
