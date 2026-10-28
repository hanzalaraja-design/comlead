import { DOMAINS, domainHref } from "@/lib/domains";
import type { ProjectKind } from "@/lib/types";

/**
 * The ways into tasks (My tasks, My team, All teams, Projects), and the link
 * back from a task to wherever it was opened.
 */
export type TaskScope = "my" | "team" | "all" | "projects";
export type TaskView = "list" | "board" | "calendar";
export type TaskFrom = "my" | "team" | "all" | "project";
/** A tab, or the path of one project ("/projects/zong-app"). */
export type ScopeRef = TaskScope | `/${string}`;

export const SCOPES: { key: TaskScope; label: string; href: string; tab?: boolean }[] = [
  { key: "my", label: "My tasks", href: "/my", tab: true },
  { key: "team", label: "My team", href: "/tasks/team", tab: true },
  { key: "all", label: "All teams", href: "/tasks" },
  { key: "projects", label: "Projects", href: "/projects" },
];

export const scopeBase = (scope: ScopeRef) => (scope.startsWith("/") ? scope : SCOPES.find((s) => s.key === scope)!.href);

export function viewHref(scope: ScopeRef, view: TaskView, search = "") {
  const base = scopeBase(scope);
  return (view === "list" ? base : `${base}/${view}`) + search;
}

export const taskHref = (id: string, from?: TaskFrom) => `/tasks/${id}${from ? `?from=${from}` : ""}`;

export const isTaskFrom = (v: unknown): v is TaskFrom => v === "my" || v === "team" || v === "all" || v === "project";

type CrumbLink = { label: string; href: string };

/**
 * The trail above a task, from where it was opened:
 * Tasks / My tasks, Tasks / My team / Ayesha, All teams / Brand, or
 * Projects / My Zong App.
 * Private tasks only live in My tasks.
 */
export function taskTrail(
  from: TaskFrom | undefined,
  task: {
    department: { name: string; slug: string } | null;
    project?: { name: string; slug: string; kind: ProjectKind } | null;
    owner: { id: string } | null;
  },
  ownerName: string,
): CrumbLink[] {
  const tasks = { label: "Tasks", href: "/my" };
  if (task.project && (from === "project" || !task.department))
    return [
      { label: DOMAINS[task.project.kind].plural, href: DOMAINS[task.project.kind].path },
      { label: task.project.name, href: domainHref(task.project) },
    ];
  const where = !task.department ? "my" : from === "project" ? "all" : from ?? "all";
  if (where === "my") return [tasks, { label: "My tasks", href: "/my" }];
  if (where === "team") {
    const team = `/tasks/team?team=${task.department!.slug}`;
    return [
      tasks,
      { label: "My team", href: team },
      ...(task.owner ? [{ label: ownerName, href: `${team}&owner=${task.owner.id}` }] : []),
    ];
  }
  return [{ label: "All teams", href: "/tasks" }, { label: task.department!.name, href: `/tasks?dept=${task.department!.slug}` }];
}
