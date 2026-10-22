/**
 * The three ways into tasks (My tasks, My team, All teams), and the link
 * back from a task to wherever it was opened.
 */
export type TaskScope = "my" | "team" | "all";
export type TaskView = "list" | "board" | "calendar";
export type TaskFrom = TaskScope;

export const SCOPES: { key: TaskScope; label: string; href: string }[] = [
  { key: "my", label: "My tasks", href: "/my" },
  { key: "team", label: "My team", href: "/tasks/team" },
  { key: "all", label: "All teams", href: "/tasks" },
];

export const scopeBase = (scope: TaskScope) => SCOPES.find((s) => s.key === scope)!.href;

export function viewHref(scope: TaskScope, view: TaskView, search = "") {
  const base = scopeBase(scope);
  return (view === "list" ? base : `${base}/${view}`) + search;
}

export const taskHref = (id: string, from?: TaskFrom) => `/tasks/${id}${from ? `?from=${from}` : ""}`;

export const isTaskFrom = (v: unknown): v is TaskFrom => v === "my" || v === "team" || v === "all";

type CrumbLink = { label: string; href: string };

/**
 * The trail above a task, from where it was opened:
 * Tasks / My tasks, Tasks / My team / Ayesha, or Tasks / All teams / Brand.
 * Private tasks only live in My tasks.
 */
export function taskTrail(
  from: TaskFrom | undefined,
  task: { department: { name: string; slug: string } | null; owner: { id: string } | null },
  ownerName: string,
): CrumbLink[] {
  const tasks = { label: "Tasks", href: "/my" };
  const where = !task.department ? "my" : from ?? "all";
  if (where === "my") return [tasks, { label: "My tasks", href: "/my" }];
  if (where === "team") {
    const team = `/tasks/team?team=${task.department!.slug}`;
    return [
      tasks,
      { label: "My team", href: team },
      ...(task.owner ? [{ label: ownerName, href: `${team}&owner=${task.owner.id}` }] : []),
    ];
  }
  return [tasks, { label: "All teams", href: "/tasks" }, { label: task.department!.name, href: `/tasks?dept=${task.department!.slug}` }];
}
