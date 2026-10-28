import { createClient } from "@/lib/supabase/server";
import { OPEN_STATUSES, personName } from "@/lib/labels";
import { whenRanges } from "@/lib/tasks/when";
import { addDaysISO, startOfDayPKT } from "@/lib/time";
import type { TaskRow } from "@/lib/types";
import type { TaskFilters } from "./filters";

export const TASK_SELECT = `
  id, title, description, department_id, owner_id, status, priority,
  due_date, due_time, source, meeting_id, tags, blocked_reason, created_by,
  created_at, updated_at, completed_at, overdue, set_id, project_id, parent_task_id,
  assigned_by, assigned_at, locked,
  owner:profiles!tasks_owner_id_fkey(id, email, full_name, avatar_url),
  department:departments!tasks_department_id_fkey(id, name, slug),
  project:projects(id, name, slug, kind),
  parent:parent_task_id(id, title),
  subtasks:tasks!parent_task_id(status),
  collaborators:task_collaborators(user_id),
  meeting:meetings!tasks_meeting_id_fkey(id, title, meeting_date)
`;

/**
 * The columns every database has had from the start. Used when a release
 * goes out before its SQL update has been run, so tasks still show.
 */
export const TASK_SELECT_CORE = `
  id, title, description, department_id, owner_id, status, priority,
  due_date, due_time, source, meeting_id, tags, blocked_reason, created_by,
  created_at, updated_at, completed_at, overdue,
  owner:profiles!tasks_owner_id_fkey(id, email, full_name, avatar_url),
  department:departments!tasks_department_id_fkey(id, name, slug),
  meeting:meetings!tasks_meeting_id_fkey(id, title, meeting_date)
`;

/** The database is behind the app: a column or relationship it asked for isn't there yet. */
export const isSchemaBehind = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "PGRST200" || e.code === "42703" || e.code === "PGRST204" || /could not find|does not exist/i.test(e.message ?? ""));

export type TaskListRow = TaskRow & { overdue: boolean };

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

export const TASK_LIMIT = 500;

/**
 * Run a filtered task query. RLS limits rows to what the viewer may see.
 * Returns the rows and whether the result was cut off at the limit.
 */
export async function fetchTasks(
  filters: TaskFilters,
  ctx: { viewerId: string },
  limit = TASK_LIMIT,
): Promise<{ tasks: TaskListRow[]; truncated: boolean; error?: string }> {
  const supabase = await createClient();
  const asc = filters.dir === "asc";

  // A team's list also holds tasks that name it as an extra team.
  let teamOr: string | null = null;
  if (filters.dept.length) {
    const [depts, extra] = await Promise.all([
      supabase.from("departments").select("id").in("slug", filters.dept),
      supabase.from("task_teams").select("task_id, dept:departments!inner(slug)").in("dept.slug", filters.dept).limit(2000),
    ]);
    if (!depts.error && !extra.error) {
      const deptIds = (depts.data ?? []).map((d) => d.id as string);
      const taskIds = (extra.data ?? []).map((t) => t.task_id as string);
      const parts = [`department_id.in.(${deptIds.join(",") || "00000000-0000-0000-0000-000000000000"})`];
      if (taskIds.length) parts.push(`id.in.(${taskIds.join(",")})`);
      teamOr = parts.join(",");
    }
  }

  const build = (legacy: boolean) => {
    // Team and project filters by slug through inner joins, so they don't need the lists first.
    let select = legacy ? TASK_SELECT_CORE : TASK_SELECT;
    const viaJoin = filters.dept.length && (legacy || !teamOr);
    if (viaJoin) select += ", dept_filter:departments!tasks_department_id_fkey!inner(slug)";
    if (filters.project.length && !legacy) select += ", project_filter:projects!inner(slug)";
    let q = supabase.from("tasks").select(select);

    // Status: default is open tasks only.
    if (filters.status !== "all") {
      q = q.in("status", filters.status.length ? filters.status : OPEN_STATUSES);
    }
    // Subtasks show under their main task; they're listed on their own only when looking at someone's tasks.
    if (!filters.owner.length && !legacy) q = q.is("parent_task_id", null);
    if (filters.priority.length) q = q.in("priority", filters.priority);
    if (filters.source.length) q = q.in("source", filters.source);

    // OR-groups are collected and applied once at the end (PostgREST takes a single "or").
    const orGroups: string[] = [];
    if (teamOr && !legacy) orGroups.push(teamOr);
    if (filters.owner.length) {
      const ids = filters.owner.map((o) => (o === "me" ? ctx.viewerId : o)).filter((o) => o !== "none");
      const wantsNone = filters.owner.includes("none");
      if (wantsNone && ids.length) orGroups.push(`owner_id.is.null,owner_id.in.(${ids.join(",")})`);
      else if (wantsNone) q = q.is("owner_id", null);
      else q = q.in("owner_id", ids);
    }

    // When: open tasks by due date, finished ones by the day they were completed.
    const ranges = whenRanges(filters.when);
    if (ranges) {
      const due = ranges.map((r) => `and(due_date.gte.${r.from},due_date.lte.${r.to})`).join(",");
      const done = ranges
        .map((r) => `and(completed_at.gte."${startOfDayPKT(r.from)}",completed_at.lt."${startOfDayPKT(addDaysISO(r.to, 1))}")`)
        .join(",");
      const statuses = filters.status === "all" ? null : filters.status.length ? filters.status : OPEN_STATUSES;
      const onlyDone = statuses?.every((s) => s === "done");
      const onlyOpen = statuses?.every((s) => s !== "done");
      if (onlyDone) orGroups.push(done);
      else if (onlyOpen) orGroups.push(due);
      else orGroups.push(`and(status.neq.done,or(${due})),and(status.eq.done,or(${done}))`);
    }
    if (orGroups.length === 1) q = q.or(orGroups[0]);
    else if (orGroups.length > 1) q = q.or(`and(${orGroups.map((g) => `or(${g})`).join(",")})`);

    if (viaJoin) q = q.in("dept_filter.slug", filters.dept);
    if (filters.project.length && !legacy) q = q.in("project_filter.slug", filters.project);
    if (filters.meeting) q = q.eq("meeting_id", filters.meeting);
    if (filters.tags.length) q = q.overlaps("tags", filters.tags);
    if (filters.overdue) q = q.eq("overdue", true);

    if (filters.due_from) q = q.gte("due_date", filters.due_from);
    if (filters.due_to) q = q.lte("due_date", filters.due_to);
    if (filters.created_from) q = q.gte("created_at", startOfDayPKT(filters.created_from));
    if (filters.created_to) q = q.lt("created_at", startOfDayPKT(addDaysISO(filters.created_to, 1)));
    if (filters.completed_from) q = q.gte("completed_at", startOfDayPKT(filters.completed_from));
    if (filters.completed_to) q = q.lt("completed_at", startOfDayPKT(addDaysISO(filters.completed_to, 1)));
    if (filters.q) q = q.ilike("title", `%${filters.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);

    switch (filters.sort) {
      case "due":
        q = q
          .order("due_date", { ascending: asc, nullsFirst: false })
          .order("due_time", { ascending: asc, nullsFirst: false });
        break;
      case "priority":
        q = q.order("priority", { ascending: asc }).order("due_date", { ascending: true, nullsFirst: false });
        break;
      case "status":
        q = q.order("status", { ascending: asc }).order("due_date", { ascending: true, nullsFirst: false });
        break;
      case "created":
        q = q.order("created_at", { ascending: asc });
        break;
      case "completed":
        q = q.order("completed_at", { ascending: asc, nullsFirst: false });
        break;
      case "updated":
        q = q.order("updated_at", { ascending: asc });
        break;
      case "title":
        q = q.order("title", { ascending: asc });
        break;
      default:
        q = q.order("created_at", { ascending: false });
    }
    return q;
  };

  let { data, error } = await build(false).limit(limit + 1);
  if (isSchemaBehind(error)) {
    console.error("[tasks] database is behind the app; showing tasks without the newest fields:", error?.message);
    ({ data, error } = await build(true).limit(limit + 1));
  }
  if (error) return { tasks: [], truncated: false, error: error.message };

  let tasks = (data ?? []) as unknown as TaskListRow[];
  const truncated = tasks.length > limit;
  tasks = tasks.slice(0, limit);

  // Sorts on joined columns are done here.
  if (filters.sort === "owner") {
    tasks.sort((a, b) => personName(a.owner).localeCompare(personName(b.owner)) * (asc ? 1 : -1));
  } else if (filters.sort === "department") {
    tasks.sort((a, b) => (a.department?.name ?? "").localeCompare(b.department?.name ?? "") * (asc ? 1 : -1));
  }

  return { tasks, truncated };
}

export function comparePriority(a: TaskListRow, b: TaskListRow) {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

/**
 * Run a task query with the full select, falling back to the core columns
 * when the database is behind the app. `run` gets the select string.
 */
export async function withTaskSelect<R extends { error: { code?: string; message?: string } | null }>(
  run: (select: string) => PromiseLike<R>,
): Promise<R> {
  const res = await run(TASK_SELECT);
  if (!isSchemaBehind(res.error)) return res;
  console.error("[tasks] database is behind the app; showing tasks without the newest fields:", res.error?.message);
  return run(TASK_SELECT_CORE);
}
