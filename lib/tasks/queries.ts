import { createClient } from "@/lib/supabase/server";
import { OPEN_STATUSES, personName } from "@/lib/labels";
import { addDaysISO, startOfDayPKT } from "@/lib/time";
import type { TaskRow } from "@/lib/types";
import type { TaskFilters } from "./filters";

export const TASK_SELECT = `
  id, title, description, department_id, owner_id, status, priority,
  due_date, due_time, source, meeting_id, tags, blocked_reason, created_by,
  created_at, updated_at, completed_at, overdue,
  owner:profiles!tasks_owner_id_fkey(id, email, full_name, avatar_url),
  department:departments(id, name, slug),
  meeting:meetings!tasks_meeting_id_fkey(id, title, meeting_date)
`;

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
  // Team filter by slug through an inner join, so it doesn't need the team list first.
  let q = supabase.from("tasks").select(filters.dept.length ? `${TASK_SELECT}, dept_filter:departments!inner(slug)` : TASK_SELECT);

  // Status: default is open tasks only.
  if (filters.status !== "all") {
    q = q.in("status", filters.status.length ? filters.status : OPEN_STATUSES);
  }
  if (filters.priority.length) q = q.in("priority", filters.priority);
  if (filters.source.length) q = q.in("source", filters.source);

  if (filters.owner.length) {
    const ids = filters.owner.map((o) => (o === "me" ? ctx.viewerId : o)).filter((o) => o !== "none");
    const wantsNone = filters.owner.includes("none");
    if (wantsNone && ids.length) q = q.or(`owner_id.is.null,owner_id.in.(${ids.join(",")})`);
    else if (wantsNone) q = q.is("owner_id", null);
    else q = q.in("owner_id", ids);
  }

  if (filters.dept.length) q = q.in("dept_filter.slug", filters.dept);
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

  const asc = filters.dir === "asc";
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

  const { data, error } = await q.limit(limit + 1);
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
