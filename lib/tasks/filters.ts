import { PRIORITIES, SOURCES, STATUSES } from "@/lib/labels";
import { isISODate } from "@/lib/time";
import { isWhen, type WhenKey } from "@/lib/tasks/when";
import type { TaskPriority, TaskSource, TaskStatus } from "@/lib/types";

/**
 * Task list filters. Every filter lives in the URL so any combination can be
 * shared as a link and saved as a view. Multi-value filters are
 * comma-separated: ?status=todo,blocked&dept=marketing&owner=me&overdue=1
 */
export type TaskFilters = {
  /** Empty = open tasks (To do / In progress / Blocked). "all" = every status. */
  status: TaskStatus[] | "all";
  priority: TaskPriority[];
  source: TaskSource[];
  /** User ids, plus "me" and "none" (unassigned). */
  owner: string[];
  /** Department slugs. */
  dept: string[];
  meeting?: string;
  tags: string[];
  overdue: boolean;
  /** Ticked "When" ranges: due date for open tasks, completion date for done ones. */
  when: WhenKey[];
  due_from?: string;
  due_to?: string;
  created_from?: string;
  created_to?: string;
  completed_from?: string;
  completed_to?: string;
  q?: string;
  sort: SortKey;
  dir: "asc" | "desc";
};

export const SORTS = [
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
  { value: "owner", label: "Owner" },
  { value: "department", label: "Department" },
  { value: "created", label: "Created" },
  { value: "completed", label: "Completed" },
  { value: "updated", label: "Last updated" },
  { value: "title", label: "Title" },
] as const;

export type SortKey = (typeof SORTS)[number]["value"];

type RawParams = Record<string, string | string[] | undefined>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function list(raw: RawParams, key: string): string[] {
  const v = raw[key];
  const s = Array.isArray(v) ? v.join(",") : v ?? "";
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function one(raw: RawParams, key: string): string | undefined {
  const v = raw[key];
  return (Array.isArray(v) ? v[0] : v) || undefined;
}

function date(raw: RawParams, key: string): string | undefined {
  const v = one(raw, key);
  return isISODate(v) ? v : undefined;
}

export function parseFilters(raw: RawParams): TaskFilters {
  const statusRaw = list(raw, "status");
  const statusValues = STATUSES.map((s) => s.value as string);
  const sort = one(raw, "sort");
  return {
    status: statusRaw.includes("all")
      ? "all"
      : (statusRaw.filter((s) => statusValues.includes(s)) as TaskStatus[]),
    priority: list(raw, "priority").filter((p) => PRIORITIES.some((x) => x.value === p)) as TaskPriority[],
    source: list(raw, "source").filter((p) => SOURCES.some((x) => x.value === p)) as TaskSource[],
    owner: list(raw, "owner").filter((o) => o === "me" || o === "none" || UUID_RE.test(o)),
    dept: list(raw, "dept").filter((d) => /^[a-z0-9-]+$/.test(d)),
    meeting: UUID_RE.test(one(raw, "meeting") ?? "") ? one(raw, "meeting") : undefined,
    tags: list(raw, "tags").slice(0, 20),
    overdue: one(raw, "overdue") === "1",
    when: list(raw, "when").filter(isWhen),
    due_from: date(raw, "due_from"),
    due_to: date(raw, "due_to"),
    created_from: date(raw, "created_from"),
    created_to: date(raw, "created_to"),
    completed_from: date(raw, "completed_from"),
    completed_to: date(raw, "completed_to"),
    q: one(raw, "q")?.slice(0, 200),
    sort: SORTS.some((s) => s.value === sort) ? (sort as SortKey) : "due",
    dir: one(raw, "dir") === "desc" ? "desc" : "asc",
  };
}

/** Serialize back to a query string (only non-default values). */
export function filtersToSearch(f: Partial<TaskFilters>): string {
  const p = new URLSearchParams();
  if (f.status === "all") p.set("status", "all");
  else if (f.status?.length) p.set("status", f.status.join(","));
  if (f.priority?.length) p.set("priority", f.priority.join(","));
  if (f.source?.length) p.set("source", f.source.join(","));
  if (f.owner?.length) p.set("owner", f.owner.join(","));
  if (f.dept?.length) p.set("dept", f.dept.join(","));
  if (f.meeting) p.set("meeting", f.meeting);
  if (f.tags?.length) p.set("tags", f.tags.join(","));
  if (f.overdue) p.set("overdue", "1");
  if (f.when?.length) p.set("when", f.when.join(","));
  for (const k of ["due_from", "due_to", "created_from", "created_to", "completed_from", "completed_to", "q"] as const) {
    if (f[k]) p.set(k, f[k]!);
  }
  if (f.sort && f.sort !== "due") p.set("sort", f.sort);
  if (f.dir === "desc") p.set("dir", "desc");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function countActiveFilters(f: TaskFilters): number {
  return (
    (f.status === "all" || f.status.length ? 1 : 0) +
    (f.priority.length ? 1 : 0) +
    (f.source.length ? 1 : 0) +
    (f.owner.length ? 1 : 0) +
    (f.dept.length ? 1 : 0) +
    (f.meeting ? 1 : 0) +
    (f.tags.length ? 1 : 0) +
    (f.overdue ? 1 : 0) +
    (f.when.length ? 1 : 0) +
    (f.due_from || f.due_to ? 1 : 0) +
    (f.created_from || f.created_to ? 1 : 0) +
    (f.completed_from || f.completed_to ? 1 : 0) +
    (f.q ? 1 : 0)
  );
}
