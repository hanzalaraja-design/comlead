import Link from "next/link";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskViewTabs } from "@/components/tasks/task-view-tabs";
import { STATUS_STYLES } from "@/lib/labels";
import { getDepartments, requireViewer } from "@/lib/auth";
import { filtersToSearch, parseFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";
import { fetchTasks, type TaskListRow } from "@/lib/tasks/queries";
import { formatTime, parseISODate, todayPKT } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Calendar · Highfy Tasks" };

const MAX_PER_DAY = 3;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  const raw = await searchParams;
  const today = todayPKT();
  const monthParam = typeof raw.month === "string" && /^\d{4}-\d{2}$/.test(raw.month) ? raw.month : today.slice(0, 7);
  const monthStart = startOfMonth(parseISODate(`${monthParam}-01`));
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd }).map((d) => format(d, "yyyy-MM-dd"));

  const base = parseFilters(raw);
  const filters = { ...base, due_from: days[0], due_to: days[days.length - 1], sort: "due" as const, dir: "asc" as const };
  const [departments, options] = await Promise.all([getDepartments(), getFilterOptions()]);
  const { tasks, error } = await fetchTasks(filters, { viewerId: viewer.id, departments }, 1000);

  const byDay = new Map<string, TaskListRow[]>();
  for (const t of tasks) {
    if (!t.due_date) continue;
    if (!byDay.has(t.due_date)) byDay.set(t.due_date, []);
    byDay.get(t.due_date)!.push(t);
  }

  // Keep the other filters when paging months.
  const keep = filtersToSearch({ ...base, due_from: undefined, due_to: undefined, sort: "due", dir: "asc" });
  const monthHref = (m: Date) => {
    const params = new URLSearchParams(keep.slice(1));
    params.set("month", format(m, "yyyy-MM"));
    return `/tasks/calendar?${params.toString()}`;
  };

  const daysHref = (day: string) =>
    `/tasks${filtersToSearch({ ...base, due_from: day, due_to: day })}`;

  return (
    <>
      <PageHeader
        title={format(monthStart, "MMMM yyyy")}
        description="Tasks by due date"
        actions={
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
        }
      />
      <TaskViewTabs active="calendar" search={filtersToSearch(base)} />
      <TaskFilterBar filters={base} options={options} hide={["sort"]} allowSave={false} preserve={{ month: monthParam }} />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {/* Desktop: month grid */}
      <div className="hidden overflow-hidden rounded-lg border md:block">
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
              <div
                key={day}
                className={cn("min-h-28 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-muted/30")}
              >
                <div
                  className={cn(
                    "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs",
                    day === today ? "bg-primary font-semibold text-primary-foreground" : !inMonth && "text-muted-foreground",
                  )}
                >
                  {Number(day.slice(8))}
                </div>
                <ul className="space-y-1">
                  {items.slice(0, MAX_PER_DAY).map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/tasks/${t.id}`}
                        title={t.title}
                        className={cn(
                          "block truncate rounded px-1.5 py-0.5 text-[11px]",
                          STATUS_STYLES[t.status],
                          t.overdue && "ring-1 ring-red-500",
                        )}
                      >
                        {t.due_time && <span className="opacity-70">{formatTime(t.due_time)} </span>}
                        {t.title}
                      </Link>
                    </li>
                  ))}
                  {items.length > MAX_PER_DAY && (
                    <li>
                      <Link href={daysHref(day)} className="px-1.5 text-[11px] text-muted-foreground hover:underline">
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
              <h2 className={cn("mb-1 text-sm font-semibold", day === today && "text-primary")}>
                {format(parseISODate(day), "EEE d MMM")}
                {day === today && " · Today"}
              </h2>
              <ul className="divide-y rounded-lg border">
                {byDay.get(day)!.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tasks/${t.id}`} className="flex items-center gap-2 px-3 py-2.5 text-sm">
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
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No tasks due this month.
          </p>
        )}
      </div>
    </>
  );
}
