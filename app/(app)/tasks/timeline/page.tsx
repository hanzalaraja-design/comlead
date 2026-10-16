import Link from "next/link";
import { addDays, differenceInCalendarDays, format, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { PersonAvatar } from "@/components/person-avatar";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskViewTabs } from "@/components/tasks/task-view-tabs";
import { ScrollToToday } from "@/components/tasks/scroll-to-today";
import { getDepartments, requireViewer } from "@/lib/auth";
import { personName, statusLabel } from "@/lib/labels";
import { filtersToSearch, parseFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";
import { fetchTasks, type TaskListRow } from "@/lib/tasks/queries";
import { formatDate, isISODate, parseISODate, todayPKT } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/types";

export const metadata = { title: "Timeline · Highfy Tasks" };

const BAR: Record<TaskStatus, string> = {
  todo: "border border-ink/25 bg-white text-ink",
  in_progress: "bg-brand-primary text-white",
  blocked: "bg-brand-accent text-ink",
  done: "bg-subtle text-ink",
  cancelled: "border border-line bg-white text-muted-foreground",
};

const ZOOMS = [
  { weeks: 2, dayWidth: 48, label: "2 weeks" },
  { weeks: 6, dayWidth: 30, label: "6 weeks" },
  { weeks: 13, dayWidth: 16, label: "3 months" },
];

type Group = "dept" | "owner";

/**
 * Gantt-style view: one row per task, a bar from start date to due date.
 * Tasks with only a due date show as a diamond on that day.
 */
export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  const raw = await searchParams;
  const filters = parseFilters(raw);
  const today = todayPKT();

  const zoom = ZOOMS.find((z) => String(z.weeks) === raw.weeks) ?? ZOOMS[1];
  const group: Group = raw.group === "owner" ? "owner" : "dept";
  const defaultFrom = format(addDays(startOfWeek(parseISODate(today), { weekStartsOn: 1 }), -7), "yyyy-MM-dd");
  const from = isISODate(raw.from) ? format(startOfWeek(parseISODate(raw.from), { weekStartsOn: 1 }), "yyyy-MM-dd") : defaultFrom;
  const dayCount = zoom.weeks * 7;
  const days = Array.from({ length: dayCount }, (_, i) => format(addDays(parseISODate(from), i), "yyyy-MM-dd"));
  const to = days[days.length - 1];
  const index = (d: string) => differenceInCalendarDays(parseISODate(d), parseISODate(from));

  const [departments, options] = await Promise.all([getDepartments(), getFilterOptions()]);
  // Everything due on or after the first visible day; then keep the ones
  // that start before the last visible day.
  const { tasks: fetched, truncated, error } = await fetchTasks(
    { ...filters, due_from: from, due_to: undefined, sort: "due", dir: "asc" },
    { viewerId: viewer.id, departments },
    1000,
  );
  const tasks = fetched.filter((t) => t.due_date && (t.start_date ?? t.due_date) <= to);

  // Group rows
  const groups = new Map<string, { label: string; order: number; tasks: TaskListRow[] }>();
  const deptOrder = new Map(departments.map((d, i) => [d.id, i]));
  for (const t of tasks) {
    const key = group === "dept" ? t.department_id : t.owner_id ?? "none";
    if (!groups.has(key)) {
      groups.set(key, {
        label: group === "dept" ? t.department?.name ?? "No department" : personName(t.owner),
        order: group === "dept" ? deptOrder.get(t.department_id) ?? 99 : 0,
        tasks: [],
      });
    }
    groups.get(key)!.tasks.push(t);
  }
  const sortedGroups = [...groups.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  for (const g of sortedGroups) {
    g.tasks.sort((a, b) => (a.start_date ?? a.due_date!).localeCompare(b.start_date ?? b.due_date!));
  }

  // Links keep filters + view settings.
  const viewParams = { from, weeks: String(zoom.weeks), group };
  const href = (patch: Partial<typeof viewParams>) => {
    const p = new URLSearchParams(filtersToSearch(filters).slice(1));
    for (const [k, v] of Object.entries({ ...viewParams, ...patch })) p.set(k, v);
    return `/tasks/timeline?${p.toString()}`;
  };
  const step = Math.max(1, Math.round(zoom.weeks / 2)) * 7;
  const W = zoom.dayWidth;
  const todayIdx = index(today);
  const trackWidth = dayCount * W;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Tasks", href: "/tasks" }, "Timeline"]}
        title="Timeline"
        description={`${formatDate(from, "d MMM")} – ${formatDate(to, "d MMM yyyy")} · ${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="icon" aria-label="Earlier">
              <Link href={href({ from: format(addDays(parseISODate(from), -step), "yyyy-MM-dd") })}>
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={href({ from: defaultFrom })}>Today</Link>
            </Button>
            <Button asChild variant="outline" size="icon" aria-label="Later">
              <Link href={href({ from: format(addDays(parseISODate(from), step), "yyyy-MM-dd") })}>
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        }
      />
      <TaskViewTabs active="timeline" search={filtersToSearch(filters)} />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Segmented
          items={ZOOMS.map((z) => ({ label: z.label, href: href({ weeks: String(z.weeks) }), active: z.weeks === zoom.weeks }))}
        />
        <Segmented
          items={[
            { label: "By department", href: href({ group: "dept" }), active: group === "dept" },
            { label: "By person", href: href({ group: "owner" }), active: group === "owner" },
          ]}
        />
      </div>

      <TaskFilterBar filters={filters} options={options} hide={["sort"]} allowSave={false} preserve={viewParams} />
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      {tasks.length === 0 ? (
        <EmptyState>No tasks in this period. Tasks need a due date to appear on the timeline.</EmptyState>
      ) : (
        // Opens with a few days before today in view.
        <ScrollToToday offset={Math.max(0, (todayIdx - 2) * W)} className="overflow-x-auto surface">
          <div style={{ minWidth: `calc(var(--label-w) + ${trackWidth}px)` }} className="[--label-w:9rem] md:[--label-w:16rem]">
            {/* Header: months + days */}
            <div className="sticky top-0 z-20 flex border-b bg-muted/60 text-[10px] text-muted-foreground backdrop-blur">
              <div className="sticky left-0 z-20 w-[var(--label-w)] shrink-0 border-r bg-muted px-3 py-1.5 text-xs font-medium">
                Task
              </div>
              <div className="relative flex" style={{ width: trackWidth }}>
                {days.map((d, i) => {
                  const date = parseISODate(d);
                  const weekend = date.getDay() === 0 || date.getDay() === 6;
                  const showMonth = i === 0 || d.endsWith("-01");
                  return (
                    <div
                      key={d}
                      style={{ width: W }}
                      className={cn(
                        "shrink-0 border-r py-1 text-center leading-tight",
                        weekend && "bg-muted",
                        d === today && "bg-brand-accent font-semibold text-ink",
                      )}
                    >
                      <div className="h-3 truncate px-0.5 font-medium">{showMonth ? format(date, "MMM") : ""}</div>
                      {(W >= 24 || date.getDay() === 1) && <div>{format(date, "d")}</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {sortedGroups.map((g) => (
              <div key={g.label}>
                <div className="flex border-b bg-muted/30">
                  <div className="sticky left-0 z-10 w-[var(--label-w)] shrink-0 bg-muted/30 px-3 py-1.5 text-xs font-semibold backdrop-blur">
                    {g.label} <span className="font-normal text-muted-foreground">· {g.tasks.length}</span>
                  </div>
                  <div style={{ width: trackWidth }} />
                </div>
                {g.tasks.map((t) => (
                  <TimelineRow key={t.id} task={t} index={index} dayCount={dayCount} W={W} todayIdx={todayIdx} group={group} />
                ))}
              </div>
            ))}
          </div>
        </ScrollToToday>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(Object.keys(BAR) as TaskStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2.5 w-4 rounded-sm", BAR[s])} /> {statusLabel(s)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rotate-45 bg-ink" /> Due date only (no start date)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-brand-accent" /> Today
        </span>
        {truncated && <span>Showing the first 1000 tasks; narrow the filters.</span>}
      </div>
    </>
  );
}

function TimelineRow({
  task: t,
  index,
  dayCount,
  W,
  todayIdx,
  group,
}: {
  task: TaskListRow;
  index: (d: string) => number;
  dayCount: number;
  W: number;
  todayIdx: number;
  group: Group;
}) {
  const due = index(t.due_date!);
  const start = t.start_date ? index(t.start_date) : null;
  const clippedLeft = start !== null && start < 0;
  const clippedRight = due >= dayCount;
  const left = Math.max(0, start ?? due);
  const right = Math.min(dayCount - 1, due);
  const tip = `${t.title} · ${statusLabel(t.status)} · ${
    t.start_date ? `${formatDate(t.start_date, "d MMM")} → ` : "Due "
  }${formatDate(t.due_date, "d MMM")}${t.overdue ? " · Overdue" : ""}`;

  return (
    <div className="group flex border-b last:border-b-0 hover:bg-muted/30">
      <Link
        href={`/tasks/${t.id}`}
        className="sticky left-0 z-10 flex w-[var(--label-w)] shrink-0 items-center gap-2 border-r bg-white px-3 py-1.5 group-hover:bg-subtle"
      >
        <span className={cn("min-w-0 flex-1 truncate text-xs md:text-sm", t.status === "cancelled" && "line-through opacity-60")}>
          {t.title}
        </span>
        {group === "dept" ? (
          <PersonAvatar person={t.owner} className="hidden h-5 w-5 md:inline-flex" />
        ) : (
          <span className="hidden truncate text-[11px] text-muted-foreground md:inline">{t.department?.name}</span>
        )}
      </Link>
      <div className="relative h-8" style={{ width: dayCount * W }}>
        {todayIdx >= 0 && todayIdx < dayCount && (
          <div className="absolute inset-y-0 w-0.5 bg-brand-accent" style={{ left: todayIdx * W + W / 2 - 1 }} />
        )}
        {start === null ? (
          due < dayCount && (
            <Link
              href={`/tasks/${t.id}`}
              title={tip}
              className={cn(
                "absolute top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 rounded-[2px]",
                BAR[t.status],
                t.overdue && "ring-2 ring-brand-accent ring-offset-1 ring-offset-white",
              )}
              style={{ left: due * W + W / 2 - 6 }}
            />
          )
        ) : (
          <Link
            href={`/tasks/${t.id}`}
            title={tip}
            className={cn(
              "absolute top-1.5 h-5 rounded-md opacity-90 hover:opacity-100",
              BAR[t.status],
              clippedLeft && "rounded-l-none",
              clippedRight && "rounded-r-none",
              t.overdue && "ring-2 ring-brand-accent ring-offset-1 ring-offset-white",
            )}
            style={{ left: left * W + 2, width: Math.max(W - 4, (right - left + 1) * W - 4) }}
          >
            {(right - left + 1) * W > 90 && (
              <span className="block truncate px-2 text-[11px] font-semibold leading-5">{t.title}</span>
            )}
          </Link>
        )}
      </div>
    </div>
  );
}

function Segmented({ items }: { items: { label: string; href: string; active: boolean }[] }) {
  return (
    <div className="inline-flex surface p-0.5">
      {items.map((i) => (
        <Link
          key={i.label}
          href={i.href}
          className={cn("rounded-md px-2.5 py-1 text-xs", i.active ? "bg-accent font-medium" : "text-muted-foreground")}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}
