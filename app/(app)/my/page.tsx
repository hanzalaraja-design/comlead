import Link from "next/link";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { cookies } from "next/headers";
import { RememberRole } from "@/components/tasks/remember-role";
import { QuickAdd } from "@/components/tasks/quick-add";
import { CelebrateWhenCleared } from "@/components/progress/celebrate";
import { getDepartments, isMemberOf, requireViewer, viewerId } from "@/lib/auth";
import { OPEN_STATUSES } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { countActiveFilters, filtersToSearch, parseFilters, type TaskFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskTabs } from "@/components/tasks/task-tabs";
import { withTaskSelect, type TaskListRow } from "@/lib/tasks/queries";
import { PeriodTabs, WhatsUp, loadPeriodTasks, readPeriod, type PeriodTasks } from "@/components/tasks/whats-up";
import { formatDate, startOfDayPKT, todayPKT } from "@/lib/time";
import { onTimeStatus } from "@/lib/tasks/ontime";
import { clearedLine } from "@/lib/voice";

export const metadata = { title: "My tasks · Highfy Tasks" };

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [id, supabase, raw] = await Promise.all([viewerId(), createClient(), searchParams]);
  // Yours, always; the filter bar narrows it further.
  const filters: TaskFilters = { ...parseFilters(raw), owner: ["me"] };
  const filtered = countActiveFilters({ ...filters, owner: [] }) > 0;
  // Owner, collaborator or both: which of your tasks to show.
  // Opens on the last one you picked; "I own" the first time.
  const asked = raw.role === "own" || raw.role === "collab" || raw.role === "both" ? raw.role : (await cookies()).get("my_role")?.value;
  const role = asked === "collab" || asked === "both" ? asked : "own";
  const today = todayPKT();

  const period = readPeriod(raw, "today");

  // Everything at once: no query here waits for another.
  const monthStart = `${today.slice(0, 7)}-01`;
  const [viewer, departments, owned, collabRes, options, monthDone] = await Promise.all([
    requireViewer(),
    getDepartments(),
    loadPeriodTasks(filters, period, id),
    // Open tasks I'm a collaborator on but don't own.
    withTaskSelect((select) =>
      supabase
        .from("tasks")
        .select(`${select}, me:task_collaborators!inner(user_id)`)
        .eq("me.user_id", id)
        .in("status", OPEN_STATUSES)
        .or(`owner_id.is.null,owner_id.neq.${id}`)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(200),
    ),
    getFilterOptions(),
    // On time this month: your finished tasks that had a due date.
    supabase
      .from("tasks")
      .select("due_date, completed_at")
      .eq("owner_id", id)
      .eq("status", "done")
      .not("due_date", "is", null)
      .gte("completed_at", startOfDayPKT(monthStart))
      .limit(1000),
  ]);
  const scored = ((monthDone.data ?? []) as { due_date: string; completed_at: string }[]).map((t) => onTimeStatus(t.due_date, t.completed_at)).filter((x) => !!x);
  const onTimeCount = scored.filter((x) => x!.onTime).length;

  const collaborating = (collabRes.data ?? []) as unknown as TaskListRow[];
  const byDue = (x: TaskListRow, y: TaskListRow) =>
    (x.due_date ?? "9999").localeCompare(y.due_date ?? "9999") || (x.due_time ?? "").localeCompare(y.due_time ?? "") || x.created_at.localeCompare(y.created_at);
  const data: PeriodTasks =
    role === "own"
      ? owned
      : role === "collab"
        ? { open: collaborating, done: [], truncated: false }
        : { ...owned, open: [...owned.open, ...collaborating.filter((c) => !owned.open.some((o) => o.id === c.id))].sort(byDue) };

  const overdue = owned.open.filter((t) => t.overdue).length;
  const dueToday = owned.open.filter((t) => t.due_date === today).length;
  // Teams you can add tasks to: your own, or every team for Admin.
  const myDepartments = departments.filter((d) => !d.archived && isMemberOf(viewer, d.id));

  // This month's on-time score.
  const onTimeChip = (className: string) =>
    scored.length > 0 && (
      <span className={cn("items-center gap-2 rounded-[12px] bg-white px-3 py-2 text-[13px] text-ink shadow-sm", className)}>
        <span className={cn("font-bold", onTimeCount / scored.length >= 0.8 ? "text-success-ink" : "text-warning-ink")}>
          {Math.round((onTimeCount / scored.length) * 100)}% on time
        </span>
        <span className="text-ink-muted">
          {onTimeCount} of {scored.length} finished by their due date this month
        </span>
      </span>
    );

  return (
    <>
      <PageHeader
        breadcrumb={["Tasks", "My tasks"]}
        title="My tasks"
        description={period.range || formatDate(today, "EEEE d MMMM")}
      />
      <TaskTabs scope="my" view="list" search={filtersToSearch({ ...filters, owner: [] })} />
      <RememberRole role={role} />
      {/* Pinned while you scroll, so switching never means scrolling back up. */}
      <div className="sticky top-14 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-transparent bg-background/95 px-4 py-2 backdrop-blur md:top-0 md:-mx-12 md:px-12">
        {(
          [
            ["own", "I own", owned.open.length],
            ["collab", "Collaborating", collaborating.length],
            ["both", "All", owned.open.length + collaborating.length],
          ] as const
        ).map(([key, label, n]) => {
          const params = new URLSearchParams(filtersToSearch({ ...filters, owner: [] }).slice(1));
          params.set("role", key);
          const qs = params.toString();
          return (
            <Link
              key={key}
              href={`/my${qs ? `?${qs}` : ""}`}
              aria-current={role === key ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold",
                role === key ? "bg-ink text-white" : "border border-line bg-white text-ink hover:bg-subtle",
              )}
            >
              {label}
              {n !== null && <span className={cn("rounded-full px-2 text-xs", role === key ? "bg-white/20" : "bg-subtle")}>{n}</span>}
            </Link>
          );
        })}
        {onTimeChip("ml-auto hidden md:inline-flex")}
      </div>
      {/* On phones it sits below the switch, so the pinned bar stays one line. */}
      {onTimeChip("mb-4 inline-flex md:hidden")}
      {!filtered && <CelebrateWhenCleared remaining={overdue + dueToday} line={clearedLine(today + viewer.id)} />}

      <div className="mb-6">
        <QuickAdd departments={myDepartments.map((d) => ({ id: d.id, name: d.name }))} mine />
      </div>

      <TaskFilterBar filters={filters} options={options} hide={["owner", "sort", "when"]} preserve={{ role, ...(period.key !== "today" ? { period: period.key } : {}) }} />
      <PeriodTabs path="/my" raw={raw} period={period} fallback="today" />
      <WhatsUp
        data={data}
        period={period}
        path="/my"
        raw={raw}
        from="my"
        showOwner={role !== "own"}
        completedHref="/my?status=done&period=open"
      />
    </>
  );
}
