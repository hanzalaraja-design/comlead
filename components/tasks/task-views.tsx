import Link from "next/link";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/page-header";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { TaskList } from "@/components/tasks/task-list";
import { STATUS_STYLES } from "@/lib/labels";
import { filtersToSearch, type TaskFilters } from "@/lib/tasks/filters";
import { TASK_LIMIT, fetchTasks, type TaskListRow } from "@/lib/tasks/queries";
import { taskHref, viewHref, type ScopeRef, type TaskFrom } from "@/lib/tasks/scope";
import { addDaysISO, formatTime, parseISODate, todayPKT } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * The list, board and calendar views, shared by My tasks, My team and All
 * teams. `filters` already holds what the tab fixes (owner = me, the team).
 */

/** Done tasks: what the When filter picked, or the last 30 days. */
function doneFilters(filters: TaskFilters): TaskFilters {
  return filters.when.length
    ? { ...filters, status: ["done"], sort: "completed", dir: "desc" }
    : { ...filters, status: ["done"], completed_from: filters.completed_from ?? addDaysISO(todayPKT(), -29), sort: "completed", dir: "desc" };
}

function CompletedNote({ filters, scope, extra }: { filters: TaskFilters; scope: ScopeRef; extra?: Record<string, string> }) {
  const params = new URLSearchParams(filtersToSearch({ ...filters, status: ["done"], sort: "completed", dir: "desc", when: ["all"] }).slice(1));
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
  return (
    <Link href={viewHref(scope, "list", `?${params}`)} className="text-sm font-medium normal-case tracking-normal text-brand-primary hover:underline">
      See all completed
    </Link>
  );
}

export async function ListView({
  filters,
  viewerId,
  scope,
  from,
  extra,
  showOwner = true,
  showDepartment = true,
  showProject = true,
  show,
}: {
  filters: TaskFilters;
  viewerId: string;
  scope: ScopeRef;
  from: TaskFrom;
  /** Query params the tab needs kept in links (e.g. which team). */
  extra?: Record<string, string>;
  showOwner?: boolean;
  showDepartment?: boolean;
  showProject?: boolean;
  /**
   * Projects, campaigns and partnerships: finished tasks stay in the list, at
   * the bottom, with an All / Open / Done switch. The value is the ?show= param.
   */
  show?: string;
}) {
  if (show !== undefined) return <ListWithDone filters={filters} viewerId={viewerId} scope={scope} from={from} show={show} showOwner={showOwner} showDepartment={showDepartment} />;
  // The default (open tasks) also lists what was finished, with the same filters.
  const withDone = Array.isArray(filters.status) && filters.status.length === 0 && !filters.overdue;
  const [{ tasks, truncated, error }, done] = await Promise.all([
    fetchTasks(filters, { viewerId }),
    withDone ? fetchTasks(doneFilters(filters), { viewerId }, 200) : null,
  ]);
  const completed = done?.tasks ?? [];
  return (
    <>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {tasks.length ? (
        <TaskList tasks={tasks} showCompleted={filters.sort === "completed"} showOwner={showOwner} showDepartment={showDepartment} showProject={showProject} from={from} />
      ) : (
        <EmptyState>{withDone ? "Nothing open here." : "No tasks match these filters."}</EmptyState>
      )}
      {truncated && (
        <p className="mt-3 text-center text-xs text-muted-foreground">Showing the first {TASK_LIMIT}. Narrow the filters to see the rest.</p>
      )}
      {completed.length > 0 && (
        <section className="mt-8">
          <h2 className="kicker mb-2 flex items-center gap-2 text-ink">
            Completed
            <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs text-success-ink">{completed.length}</span>
            <span className="text-xs font-normal normal-case tracking-normal text-ink-muted">
              {filters.when.length ? "in the dates you picked" : "last 30 days"}
            </span>
            <span className="ml-auto">
              <CompletedNote filters={filters} scope={scope} extra={extra} />
            </span>
          </h2>
          <TaskList tasks={completed} showCompleted showOwner={showOwner} showDepartment={showDepartment} showProject={showProject} from={from} />
        </section>
      )}
    </>
  );
}

/** Open and finished tasks together, finished ones last, with how many are done. */
async function ListWithDone({
  filters,
  viewerId,
  scope,
  from,
  show,
  showOwner,
  showDepartment,
}: {
  filters: TaskFilters;
  viewerId: string;
  scope: ScopeRef;
  from: TaskFrom;
  show: string;
  showOwner: boolean;
  showDepartment: boolean;
}) {
  const mode = show === "open" || show === "done" ? show : "all";
  const custom = !(Array.isArray(filters.status) && filters.status.length === 0) || filters.overdue;
  const [open, done] = await Promise.all([
    fetchTasks(filters, { viewerId }),
    custom ? null : fetchTasks({ ...filters, status: ["done"], sort: "completed", dir: "desc" }, { viewerId }, 500),
  ]);
  const finished = done?.tasks ?? [];
  const total = open.tasks.length + finished.length;
  const tasks = mode === "open" ? open.tasks : mode === "done" ? finished : [...open.tasks, ...finished];
  const link = (m: string) => {
    const params = new URLSearchParams(filtersToSearch(filters).slice(1));
    if (m !== "all") params.set("show", m);
    const q = params.toString();
    return viewHref(scope, "list", q ? `?${q}` : "");
  };
  return (
    <>
      {open.error && <p className="mb-3 text-sm text-danger">{open.error}</p>}
      {!custom && total > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm text-ink-muted">
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-subtle">
              <span className="block h-full rounded-full bg-success" style={{ width: `${Math.round((finished.length / total) * 100)}%` }} />
            </span>
            {finished.length} of {total} done
          </span>
          <nav aria-label="Show" className="inline-flex rounded-[12px] bg-subtle p-0.5 text-sm">
            {(["all", "open", "done"] as const).map((m) => (
              <Link
                key={m}
                href={link(m)}
                aria-current={mode === m ? "page" : undefined}
                className={cn("rounded-[10px] px-3 py-1 font-semibold", mode === m ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink")}
              >
                {m === "all" ? "All" : m === "open" ? "Open" : "Done"}
              </Link>
            ))}
          </nav>
        </div>
      )}
      {tasks.length ? (
        <TaskList tasks={tasks} showOwner={showOwner} showDepartment={showDepartment} showProject={false} from={from} />
      ) : (
        <EmptyState>{mode === "done" ? "Nothing finished yet." : mode === "open" ? "Nothing open here." : "No tasks yet."}</EmptyState>
      )}
      {open.truncated && (
        <p className="mt-3 text-center text-xs text-muted-foreground">Showing the first {TASK_LIMIT}. Narrow the filters to see the rest.</p>
      )}
    </>
  );
}

export async function BoardView({
  filters,
  viewerId,
  scope,
  from,
  extra,
  canEdit = true,
  showDepartment = true,
}: {
  filters: TaskFilters;
  viewerId: string;
  scope: ScopeRef;
  from: TaskFrom;
  extra?: Record<string, string>;
  canEdit?: boolean;
  showDepartment?: boolean;
}) {
  const ctx = { viewerId };
  const [open, done] = await Promise.all([
    fetchTasks({ ...filters, status: ["todo", "in_progress", "blocked"], sort: "due", dir: "asc" }, ctx),
    fetchTasks(doneFilters(filters), ctx, 100),
  ]);
  return (
    <>
      {(open.error || done.error) && <p className="mb-3 text-sm text-danger">{open.error || done.error}</p>}
      <KanbanBoard tasks={[...open.tasks, ...done.tasks]} canEdit={canEdit} showDepartment={showDepartment} from={from} />
      <p className="mt-3 text-sm text-ink-muted">
        {filters.when.length ? "Done shows the dates you picked." : "Done shows the last 30 days."}{" "}
        <CompletedNote filters={filters} scope={scope} extra={extra} />
      </p>
    </>
  );
}

const MAX_PER_DAY = 3;

export async function CalendarView({
  filters,
  viewerId,
  scope,
  from,
  month,
  extra,
}: {
  filters: TaskFilters;
  viewerId: string;
  scope: ScopeRef;
  from: TaskFrom;
  /** yyyy-MM, or empty for this month. */
  month?: string;
  extra?: Record<string, string>;
}) {
  const today = todayPKT();
  const monthParam = month && /^\d{4}-\d{2}$/.test(month) ? month : today.slice(0, 7);
  const monthStart = startOfMonth(parseISODate(`${monthParam}-01`));
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd }).map((d) => format(d, "yyyy-MM-dd"));

  const { tasks, error } = await fetchTasks(
    { ...filters, when: [], due_from: days[0], due_to: days[days.length - 1], sort: "due", dir: "asc" },
    { viewerId },
    1000,
  );
  const byDay = new Map<string, TaskListRow[]>();
  for (const t of tasks) {
    if (!t.due_date) continue;
    if (!byDay.has(t.due_date)) byDay.set(t.due_date, []);
    byDay.get(t.due_date)!.push(t);
  }

  const keep = (m?: string) => {
    const params = new URLSearchParams(filtersToSearch({ ...filters, when: [], due_from: undefined, due_to: undefined }).slice(1));
    for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
    if (m) params.set("month", m);
    const s = params.toString();
    return s ? `?${s}` : "";
  };
  const monthHref = (m: Date) => viewHref(scope, "calendar", keep(format(m, "yyyy-MM")));
  const dayHref = (day: string) => {
    const params = new URLSearchParams(keep().slice(1));
    params.set("due_from", day);
    params.set("due_to", day);
    params.set("status", "all");
    return viewHref(scope, "list", `?${params}`);
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">{format(monthStart, "MMMM yyyy")}</h2>
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon" aria-label="Previous month">
            <Link href={monthHref(addMonths(monthStart, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={monthHref(parseISODate(today))}>Today</Link>
          </Button>
          <Button asChild variant="outline" size="icon" aria-label="Next month">
            <Link href={monthHref(addMonths(monthStart, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      {/* Desktop: month grid */}
      <div className="hidden overflow-hidden surface md:block">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-xs font-medium text-muted-foreground">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="px-2 py-1.5">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const items = byDay.get(day) ?? [];
            const inMonth = day.slice(0, 7) === monthParam;
            return (
              <div key={day} className={cn("min-h-28 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-muted/30")}>
                <div
                  className={cn(
                    "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs",
                    day === today ? "bg-info-soft font-bold text-info-ink" : !inMonth && "text-muted-foreground",
                  )}
                >
                  {Number(day.slice(8))}
                </div>
                <ul className="space-y-1">
                  {items.slice(0, MAX_PER_DAY).map((t) => (
                    <li key={t.id}>
                      <Link
                        href={taskHref(t.id, from)}
                        title={t.title}
                        className={cn("block truncate rounded px-1.5 py-0.5 text-[11px]", STATUS_STYLES[t.status], t.overdue && "ring-2 ring-danger")}
                      >
                        {t.due_time && <span className="opacity-70">{formatTime(t.due_time)} </span>}
                        {t.title}
                      </Link>
                    </li>
                  ))}
                  {items.length > MAX_PER_DAY && (
                    <li>
                      <Link href={dayHref(day)} className="px-1.5 text-[11px] text-muted-foreground hover:underline">
                        +{items.length - MAX_PER_DAY} more
                      </Link>
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Phone: agenda */}
      <div className="space-y-4 md:hidden">
        {days
          .filter((d) => d.slice(0, 7) === monthParam && byDay.has(d))
          .map((day) => (
            <section key={day}>
              <h2 className={cn("mb-1 text-sm font-semibold", day === today && "text-ink")}>
                {format(parseISODate(day), "EEE d MMM")}
                {day === today && " · Today"}
              </h2>
              <ul className="divide-y divide-line surface">
                {byDay.get(day)!.map((t) => (
                  <li key={t.id}>
                    <Link href={taskHref(t.id, from)} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_STYLES[t.status])} />
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      {t.due_time && <span className="text-xs text-muted-foreground">{formatTime(t.due_time)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        {!days.some((d) => d.slice(0, 7) === monthParam && byDay.has(d)) && (
          <p className="surface border-dashed p-6 text-center text-sm text-muted-foreground">No tasks due this month.</p>
        )}
      </div>
    </>
  );
}
