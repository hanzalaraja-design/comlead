import Link from "next/link";
import { EmptyState } from "@/components/page-header";
import { PersonAvatar } from "@/components/person-avatar";
import { TaskList } from "@/components/tasks/task-list";
import { BulkProvider, SelectAll } from "@/components/bulk-select";
import { BulkTasksBar } from "@/components/tasks/bulk-tasks";
import { getPeople } from "@/lib/auth";
import { personName } from "@/lib/labels";
import type { TaskFilters } from "@/lib/tasks/filters";
import { PERIODS, getPeriod, isPeriod, type Period, type PeriodKey } from "@/lib/tasks/period";
import { compareCreated, fetchTasks, type TaskListRow } from "@/lib/tasks/queries";
import { onTimeStatus } from "@/lib/tasks/ontime";
import { taskHref, type TaskFrom } from "@/lib/tasks/scope";
import { differenceInCalendarDays } from "date-fns";
import { formatDate, formatPKT, parseISODate, todayPKT } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { PersonRef, TaskStatus } from "@/lib/types";

/**
 * "What's up": the time tabs, four counts and the tasks for that time, as a
 * list in groups or as one card per person. Shared by My tasks, My team and
 * All teams; each passes the filters its tab fixes.
 */

type Raw = Record<string, string | string[] | undefined>;

export function readPeriod(raw: Raw, fallback: PeriodKey): Period {
  return getPeriod(isPeriod(raw.period) ? raw.period : fallback);
}
export const readBy = (raw: Raw) => (raw.by === "person" ? "person" : "list");

export type PeriodTasks = { open: TaskListRow[]; done: TaskListRow[]; truncated: boolean; error?: string };

/** Open tasks (sorted by due date, then oldest first when there's none) and what got done in the period. */
export async function loadPeriodTasks(filters: TaskFilters, period: Period, viewerId: string): Promise<PeriodTasks> {
  const today = todayPKT();
  const picked = filters.status === "all" ? [] : filters.status;
  const openStatuses = picked.filter((s) => s !== "done") as TaskStatus[];
  const wantsOpen = !picked.length || openStatuses.length > 0;
  // Done: what was finished in the period; every finished task when they asked for done ones in All open.
  const wantsDone = picked.includes("done") || (!picked.length && period.from !== null && period.when !== "future");
  const base = { ...filters, when: [] };
  const [open, done] = await Promise.all([
    wantsOpen ? fetchTasks({ ...base, status: openStatuses.length ? openStatuses : [], sort: "due", dir: "asc" }, { viewerId }, 600) : null,
    wantsDone
      ? fetchTasks(
          period.from
            ? { ...base, status: ["done"], completed_from: period.from, completed_to: period.to! < today ? period.to! : today, sort: "completed", dir: "desc" }
            : { ...base, status: ["done"], sort: "completed", dir: "desc" },
          { viewerId },
          400,
        )
      : null,
  ]);
  return { open: open?.tasks ?? [], done: done?.tasks ?? [], truncated: !!open?.truncated, error: open?.error ?? done?.error };
}

type Groups = { key: string; title: string; hint?: string; tone: "bad" | "warn" | "plain" | "good"; tasks: TaskListRow[]; done?: boolean }[];

/** Split the tasks into the groups the period shows, in order. */
function groupFor(period: Period, { open, done }: PeriodTasks): Groups {
  const today = todayPKT();
  const inRange = (d: string | null) => !!d && (period.from === null || d >= period.from) && (period.to === null || d <= period.to);
  const overdue = open.filter((t) => t.due_date && t.due_date < today);
  const noDate = open.filter((t) => !t.due_date).sort(compareCreated);
  if (period.when === "past") {
    return [
      { key: "open", title: `Still open from ${period.words}`, tone: "bad", tasks: open.filter((t) => inRange(t.due_date)) },
      { key: "done", title: `Done ${period.words}`, tone: "good", tasks: done, done: true },
    ];
  }
  if (period.when === "future") {
    return [
      { key: "due", title: `Due ${period.words}`, tone: "plain", tasks: open.filter((t) => inRange(t.due_date)) },
      { key: "none", title: "No deadline", hint: "oldest first, by the day it was added", tone: "plain", tasks: noDate },
    ];
  }
  if (period.key === "open") {
    return [
      { key: "overdue", title: "Overdue", tone: "bad", tasks: overdue },
      { key: "due", title: "Coming up", tone: "plain", tasks: open.filter((t) => t.due_date && t.due_date >= today) },
      { key: "none", title: "No deadline", hint: "oldest first, by the day it was added", tone: "plain", tasks: noDate },
      { key: "done", title: "Done", tone: "good", tasks: done, done: true },
    ];
  }
  return [
    { key: "overdue", title: "Overdue", tone: "bad", tasks: overdue },
    {
      key: "due",
      title: period.key === "today" ? "Due today" : `Due ${period.words}`,
      tone: period.key === "today" ? "warn" : "plain",
      tasks: open.filter((t) => t.due_date && t.due_date >= today && inRange(t.due_date)),
    },
    { key: "none", title: "No deadline", hint: "oldest first, by the day it was added", tone: "plain", tasks: noDate },
    { key: "done", title: period.key === "today" ? "Done today" : `Done ${period.words}`, tone: "good", tasks: done, done: true },
  ];
}

const TONE = {
  bad: "bg-danger-soft text-danger-ink",
  warn: "bg-warning-soft text-warning-ink",
  plain: "bg-subtle text-ink",
  good: "bg-success-soft text-success-ink",
};
const NUMBER = { bad: "text-danger", warn: "text-warning-ink", plain: "text-ink", good: "text-success" };

/** Links that keep every other parameter on the page. */
function hrefWith(path: string, raw: Raw, set: Record<string, string | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v) p.set(k, v);
  for (const [k, v] of Object.entries(set)) {
    if (v === null) p.delete(k);
    else p.set(k, v);
  }
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

export function PeriodTabs({ path, raw, period, fallback }: { path: string; raw: Raw; period: Period; fallback: PeriodKey }) {
  return (
    <nav aria-label="When" className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
      {PERIODS.map((p) => (
        <Link
          key={p.key}
          href={hrefWith(path, raw, { period: p.key === fallback ? null : p.key })}
          aria-current={period.key === p.key ? "page" : undefined}
          className={cn(
            "inline-flex h-9 shrink-0 items-center rounded-full border px-4 text-sm font-semibold",
            period.key === p.key ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-ink/40",
          )}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

/** List or one card per person (My team and All teams). */
export function ByToggle({ path, raw, by }: { path: string; raw: Raw; by: "list" | "person" }) {
  return (
    <nav aria-label="Show as" className="inline-flex rounded-[12px] bg-subtle p-0.5 text-sm">
      {(["list", "person"] as const).map((k) => (
        <Link
          key={k}
          href={hrefWith(path, raw, { by: k === "list" ? null : k })}
          aria-current={by === k ? "page" : undefined}
          className={cn("rounded-[10px] px-3 py-1 font-semibold", by === k ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink")}
        >
          {k === "list" ? "List" : "By person"}
        </Link>
      ))}
    </nav>
  );
}

function Counts({ period, data, groups }: { period: Period; data: PeriodTasks; groups: Groups }) {
  const get = (k: string) => groups.find((g) => g.key === k)?.tasks.length ?? 0;
  const blocked = data.open.filter((t) => t.status === "blocked").length;
  const scored = data.done.map((t) => onTimeStatus(t.due_date, t.completed_at)).filter((x) => !!x);
  const cards: { label: string; n: number | string; tone: keyof typeof NUMBER; anchor?: string }[] =
    period.when === "past"
      ? [
          { label: "Still open", n: get("open"), tone: get("open") ? "bad" : "plain", anchor: "open" },
          { label: "Done", n: get("done"), tone: "good", anchor: "done" },
          { label: "Done on time", n: scored.length ? `${Math.round((scored.filter((x) => x!.onTime).length / scored.length) * 100)}%` : "—", tone: "plain" },
          { label: "Blocked now", n: blocked, tone: blocked ? "warn" : "plain" },
        ]
      : period.when === "future"
        ? [
            { label: `Due ${period.words}`, n: get("due"), tone: "plain", anchor: "due" },
            { label: "No one on it", n: groups.find((g) => g.key === "due")?.tasks.filter((t) => !t.owner_id).length ?? 0, tone: "plain" },
            { label: "No deadline", n: get("none"), tone: "plain", anchor: "none" },
            { label: "Blocked now", n: blocked, tone: blocked ? "warn" : "plain" },
          ]
        : [
            { label: "Overdue", n: get("overdue"), tone: get("overdue") ? "bad" : "plain", anchor: "overdue" },
            { label: period.key === "open" ? "Coming up" : period.key === "today" ? "Due today" : `Due ${period.words}`, n: get("due"), tone: "plain", anchor: "due" },
            { label: "Blocked", n: blocked, tone: blocked ? "warn" : "plain" },
            period.key === "open"
              ? { label: "No deadline", n: get("none"), tone: "plain", anchor: "none" }
              : { label: period.key === "today" ? "Done today" : `Done ${period.words}`, n: get("done"), tone: "good", anchor: "done" },
          ];
  return (
    <div className="mb-5 grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
      {cards.map((c) => {
        const body = (
          <>
            <b className={cn("block text-[26px] font-bold leading-tight", NUMBER[c.tone])}>{c.n}</b>
            <span className="text-[13px] text-ink-muted">{c.label}</span>
          </>
        );
        return c.anchor ? (
          <a key={c.label} href={`#${c.anchor}`} className="rounded-[16px] border border-line bg-white px-4 py-3 hover:border-ink/30">
            {body}
          </a>
        ) : (
          <div key={c.label} className="rounded-[16px] border border-line bg-white px-4 py-3">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** One card per person: how far along, what's late, and their tasks for the period. */
async function People({ groups, path, raw, from }: { groups: Groups; path: string; raw: Raw; from: TaskFrom }) {
  const people = await getPeople();
  const byId = new Map(people.map((p) => [p.id, p]));
  const today = todayPKT();
  type Card = { id: string | null; person?: PersonRef; open: TaskListRow[]; late: number; done: TaskListRow[] };
  const cards = new Map<string, Card>();
  const card = (id: string | null) => {
    const k = id ?? "none";
    if (!cards.has(k)) cards.set(k, { id, person: id ? byId.get(id) : undefined, open: [], late: 0, done: [] });
    return cards.get(k)!;
  };
  for (const g of groups)
    for (const t of g.tasks) {
      const c = card(t.owner_id);
      if (g.done) c.done.push(t);
      else {
        c.open.push(t);
        if (t.due_date && t.due_date < today) c.late++;
      }
    }
  const list = [...cards.values()].sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : b.late - a.late || b.open.length - a.open.length || personName(a.person).localeCompare(personName(b.person))));
  if (!list.length) return <EmptyState>Nothing for this time.</EmptyState>;
  const SHOW = 5;
  const due = (t: TaskListRow) => {
    if (t.status === "done") return { text: `Done ${formatPKT(t.completed_at, "EEE")}`, cls: "text-ink-muted" };
    if (!t.due_date) return { text: `Added ${formatPKT(t.created_at, "d MMM")}`, cls: "text-ink-muted" };
    if (t.due_date < today) return { text: `${differenceInCalendarDays(parseISODate(today), parseISODate(t.due_date))}d late`, cls: "font-semibold text-danger-ink" };
    if (t.due_date === today) return { text: "Today", cls: "font-semibold text-warning-ink" };
    return { text: formatDate(t.due_date, differenceInCalendarDays(parseISODate(t.due_date), parseISODate(today)) < 7 ? "EEE" : "d MMM"), cls: "text-ink-muted" };
  };
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {list.map((c) => {
        const total = c.open.length + c.done.length;
        const rows = [...c.open, ...c.done];
        return (
          <section key={c.id ?? "none"} className="rounded-[16px] border border-line bg-white p-4">
            <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
              {c.id ? <PersonAvatar person={c.person} className="h-7 w-7" /> : <span className="h-7 w-7 rounded-full border border-dashed border-line" />}
              <span className="min-w-0 truncate">{c.id ? personName(c.person) : "No one yet"}</span>
            </h3>
            <div className="mb-1 mt-3 h-1.5 overflow-hidden rounded-full bg-subtle">
              <span className="block h-full rounded-full bg-success" style={{ width: `${total ? Math.round((c.done.length / total) * 100) : 0}%` }} />
            </div>
            <p className="flex flex-wrap gap-x-3 text-[12.5px] text-ink-muted">
              <span>
                {c.done.length} of {total} done
              </span>
              {c.late > 0 ? <span className="font-semibold text-danger-ink">{c.late} overdue</span> : !c.open.length && <span className="font-semibold text-success-ink">All clear</span>}
            </p>
            <ul className="mt-2">
              {rows.slice(0, SHOW).map((t) => {
                const d = due(t);
                return (
                  <li key={t.id} className="flex items-center gap-2 border-t border-line py-2 text-sm">
                    <span className={cn("h-4 w-4 shrink-0 rounded-full border-[1.5px]", t.status === "done" ? "border-success bg-success" : t.status === "blocked" ? "border-warning" : "border-line")} />
                    <Link href={taskHref(t.id, from)} className={cn("min-w-0 flex-1 truncate hover:underline", t.status === "done" && "text-ink-muted line-through")}>
                      {t.title}
                    </Link>
                    <span className={cn("shrink-0 text-xs", d.cls)}>{d.text}</span>
                  </li>
                );
              })}
            </ul>
            {rows.length > SHOW && (
              <Link href={hrefWith(path, raw, { by: null, owner: c.id ?? "none" })} className="mt-1 inline-block text-[13px] font-semibold text-brand-primary hover:underline">
                +{rows.length - SHOW} more
              </Link>
            )}
          </section>
        );
      })}
    </div>
  );
}

export async function WhatsUp({
  data,
  period,
  by = "list",
  path,
  raw,
  from,
  showOwner = true,
  showDepartment = true,
  completedHref,
}: {
  data: PeriodTasks;
  period: Period;
  by?: "list" | "person";
  /** This page, for links that keep the other parameters. */
  path: string;
  raw: Raw;
  from: TaskFrom;
  showOwner?: boolean;
  showDepartment?: boolean;
  completedHref?: string;
}) {
  const groups = groupFor(period, data);
  const shown = groups.filter((g) => g.tasks.length);
  return (
    <>
      <Counts period={period} data={data} groups={groups} />
      {data.error && <p className="mb-3 text-sm text-danger">{data.error}</p>}
      {by === "person" ? (
        <People groups={groups} path={path} raw={raw} from={from} />
      ) : shown.length ? (
        <BulkProvider ids={shown.flatMap((g) => g.tasks.map((t) => t.id))}>
        <div className="mb-2 flex justify-end">
          <SelectAll />
        </div>
        <div className="space-y-6">
          {shown.map((g) => (
            <section key={g.key} id={g.key} className="scroll-mt-24">
              <h2 className="mb-2 flex items-center gap-2 text-[15px] font-bold text-ink">
                {g.title}
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", TONE[g.tone])}>{g.tasks.length}</span>
                {g.hint && <span className="text-[13px] font-normal text-ink-muted">{g.hint}</span>}
              </h2>
              <TaskList tasks={g.tasks} showCompleted={g.done} showOwner={showOwner} showDepartment={showDepartment} from={from} />
            </section>
          ))}
        </div>
        <BulkTasksBar people={await getPeople()} />
        </BulkProvider>
      ) : (
        <EmptyState>{period.when === "past" ? `Nothing was due ${period.words}.` : `Nothing ${period.words ? `for ${period.words}` : "open"}. Enjoy the quiet.`}</EmptyState>
      )}
      {data.truncated && <p className="mt-3 text-center text-xs text-muted-foreground">Showing the first 600 open tasks. Narrow the filters to see the rest.</p>}
      {completedHref && (
        <p className="mt-6 text-center">
          <Link href={completedHref} className="text-sm font-medium text-brand-primary hover:underline">
            See everything completed
          </Link>
        </p>
      )}
    </>
  );
}
