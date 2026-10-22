import { cache } from "react";
import { getDepartmentMembers, type Viewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DeptRole, Project } from "@/lib/types";

export const PROJECT_COLUMNS = "id, name, slug, description, kind, launch_date, department_id, archived, created_by, created_at";

export const KIND_LABELS = { project: "Project", campaign: "Campaign" } as const;

/** Projects the viewer is in (RLS decides; Admins see all). Cached per request. */
export const getProjects = cache(async (): Promise<Project[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select(PROJECT_COLUMNS).order("archived").order("name");
  return (data ?? []) as Project[];
});

export const getProjectMembers = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("project_members").select("project_id, user_id, role");
  return (data ?? []) as { project_id: string; user_id: string; role: "lead" | "member" }[];
});

/** project_id → everyone in it: named people plus the home team. */
export async function membersByProject(projects: Project[]): Promise<Record<string, string[]>> {
  const [named, deptMembers] = await Promise.all([getProjectMembers(), getDepartmentMembers()]);
  const out: Record<string, string[]> = {};
  for (const p of projects) {
    const ids = new Set<string>();
    if (p.created_by) ids.add(p.created_by);
    for (const m of named) if (m.project_id === p.id) ids.add(m.user_id);
    if (p.department_id) for (const m of deptMembers) if (m.department_id === p.department_id) ids.add(m.user_id);
    out[p.id] = [...ids];
  }
  return out;
}

/** Same rule as can_manage_project() in the database. */
export function canManageProject(
  viewer: Viewer,
  project: Pick<Project, "id" | "created_by" | "department_id">,
  named: { project_id: string; user_id: string; role: DeptRole }[],
): boolean {
  return (
    viewer.isAdmin ||
    project.created_by === viewer.id ||
    (!!project.department_id && viewer.leadDeptIds.includes(project.department_id)) ||
    named.some((m) => m.project_id === project.id && m.user_id === viewer.id && m.role === "lead")
  );
}

export function projectSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}
