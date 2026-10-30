import { cache } from "react";
import { differenceInCalendarDays } from "date-fns";
import { getDepartments, type Viewer } from "@/lib/auth";
import { formatDate, parseISODate } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";
import type { DeptRole, Project } from "@/lib/types";

export const PROJECT_COLUMNS =
  "id, name, slug, description, kind, category, locked, start_date, end_date, archived, created_by, created_at, teams:project_teams(department_id)";

type ProjectRow = Omit<Project, "team_ids"> & { teams: { department_id: string }[] | null };

export const toProject = ({ teams, ...p }: ProjectRow): Project => ({ ...p, team_ids: (teams ?? []).map((t) => t.department_id) });

export { CATEGORY_LABELS, DOMAINS, KIND_LABELS, domainHref, isProjectKind } from "@/lib/domains";

/** Projects the viewer is in (RLS decides; Admins see all). Cached per request. */
export const getProjects = cache(async (): Promise<Project[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select(PROJECT_COLUMNS).order("archived").order("name");
  return ((data ?? []) as unknown as ProjectRow[]).map(toProject);
});

export const getProjectMembers = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("project_members").select("project_id, user_id, role");
  return (data ?? []) as { project_id: string; user_id: string; role: "lead" | "member" }[];
});

/** Every team, including ones you're not in, so any team can join a project. */
export const getTeamDirectory = cache(async (): Promise<{ id: string; name: string; slug: string }[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("team_directory");
  return (data ?? []) as { id: string; name: string; slug: string }[];
});

/** Names for every team a project can name: all teams, plus old project teams you're in. */
export const getTeamNames = cache(async (): Promise<{ id: string; name: string }[]> => {
  const [directory, visible] = await Promise.all([getTeamDirectory(), getDepartments()]);
  return [...directory, ...visible.filter((d) => !directory.some((x) => x.id === d.id))];
});

/**
 * project_id → the people on it: its owners and the people picked by name.
 * Its teams can see it, but only the people picked are on it.
 */
export async function membersByProject(projects: Project[]): Promise<Record<string, string[]>> {
  const rows = await getProjectMembers();
  const out: Record<string, string[]> = Object.fromEntries(projects.map((p) => [p.id, [] as string[]]));
  for (const r of rows) out[r.project_id]?.push(r.user_id);
  return out;
}

type Named = { project_id: string; user_id: string; role: DeptRole }[];

/** Same rule as is_project_owner() in the database. */
export function isProjectOwner(viewer: Viewer, project: Pick<Project, "id">, named: Named): boolean {
  return viewer.isAdmin || named.some((m) => m.project_id === project.id && m.user_id === viewer.id && m.role === "lead");
}

/** Same rule as can_manage_project(): owners always, everyone in it while unlocked. */
export function canManageProject(viewer: Viewer, project: Pick<Project, "id" | "locked">, named: Named, isMember: boolean): boolean {
  return isProjectOwner(viewer, project, named) || (isMember && !project.locked);
}

/** Owner ids per project. */
export const ownersOf = (named: Named, projectId: string) => named.filter((m) => m.project_id === projectId && m.role === "lead").map((m) => m.user_id);

export function projectSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      // "L'Oréal" → "loreal": drop accents and apostrophes before joining words.
      .replace(/[\u0300-\u036f'’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}

/** The first of the project's teams you're in: where its tasks go by default. */
export function homeTeamFor(viewer: Viewer, project: Pick<Project, "team_ids">): string | null {
  return project.team_ids.find((id) => viewer.isAdmin || viewer.memberDeptIds.includes(id)) ?? null;
}

/** "Runs 10–15 Nov · starts in 19 days", "Live now · ends in 2 days", "Ended 15 Nov". */
export function datesText(p: Pick<Project, "start_date" | "end_date" | "kind">, today: string): string | null {
  const { start_date: start, end_date: end } = p;
  if (!start && !end) return null;
  const days = (d: string) => differenceInCalendarDays(parseISODate(d), parseISODate(today));
  const span = (a: string, b: string) =>
    a === b
      ? formatDate(a, "d MMM")
      : a.slice(0, 7) === b.slice(0, 7)
        ? `${formatDate(a, "d")}–${formatDate(b, "d MMM")}`
        : `${formatDate(a, "d MMM")} – ${formatDate(b, "d MMM")}`;
  const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
  const live = p.kind === "campaign" ? "Live now" : "Under way";
  if (start && end) {
    if (days(start) > 0) return `Runs ${span(start, end)} · starts ${inDays(days(start))}`;
    if (days(end) >= 0) return `${live} · ${days(end) === 0 ? "ends today" : `ends ${inDays(days(end))}`}`;
    return `Ended ${formatDate(end, "d MMM")}`;
  }
  const one = (start ?? end)!;
  const verb = p.kind === "campaign" ? "Goes live" : start ? "Starts" : "Due";
  if (days(one) > 0) return `${verb} ${formatDate(one, "d MMM")} · ${inDays(days(one))}`;
  if (days(one) === 0) return `${verb} today`;
  return start ? `${p.kind === "campaign" ? "Went live" : "Started"} ${formatDate(one, "d MMM")}` : `Was due ${formatDate(one, "d MMM")}`;
}
