import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { filtersToSearch } from "@/lib/tasks/filters";
import { formatDate, formatTime, todayPKT, weekEndPKT, weekStartPKT } from "@/lib/time";
import { nextOnOrAfter, type Frequency } from "@/lib/series";
import { CrownMark } from "@/components/brand";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard · Highfy Tasks" };

type DeptStats = {
  department_id: string;
  name: string;
  slug: string;
  open_count: number;
  overdue_count: number;
  blocked_count: number;
  completed_this_week: number;
};
type PersonStats = {
  user_id: string;
  full_name: string | null;
  email: string;
  open_count: number;
  overdue_count: number;
  completed_this_week: number;
};
type MeetingWeek = {
  id: string;
  title: string;
  date: string;
  time: string;
  meeting_id: string | null;
  state: "held" | "no_minutes" | "missing" | "upcoming";
};

const MEETING_STATE: Record<MeetingWeek["state"], { label: string; className: string }> = {
  held: { label: "Minutes saved", className: "bg-subtle text-ink" },
  no_minutes: { label: "Missing minutes", className: "bg-warning-soft text-warning-ink" },
  missing: { label: "Not held", className: "bg-danger-soft text-danger-ink" },
  upcoming: { label: "Upcoming", className: "border border-line text-ink" },
};

export default async function DashboardPage() {
  await requireAdmin();
  const supabase = await createClient();
  const weekStart = weekStartPKT();
  const weekEnd = weekEndPKT();
  const today = todayPKT();
  const [deptRes, personRes, seriesRes, held] = await Promise.all([
    supabase.rpc("dashboard_department_stats"),
    supabase.rpc("dashboard_person_stats"),
    supabase.from("meeting_series").select("id, title, frequency, start_date, meeting_time").eq("archived", false),
    supabase.from("meetings").select("id, series_id, meeting_date, minutes").gte("meeting_date", weekStart).lte("meeting_date", weekEnd).not("series_id", "is", null),
  ]);
  const depts = (deptRes.data ?? []) as DeptStats[];
  const persons = ((personRes.data ?? []) as PersonStats[]).filter((p) => p.open_count || p.overdue_count || p.completed_this_week);
  // Every planned meeting that falls in this week, and whether minutes were taken.
  const meetings: MeetingWeek[] = ((seriesRes.data ?? []) as { id: string; title: string; frequency: Frequency; start_date: string; meeting_time: string }[])
    .map((x) => ({ x, date: nextOnOrAfter(x, weekStart) }))
    .filter((r): r is { x: (typeof r)["x"]; date: string } => !!r.date && r.date <= weekEnd)
    .map(({ x, date }) => {
      const m = (held.data ?? []).find((h) => h.series_id === x.id && h.meeting_date === date);
      const state: MeetingWeek["state"] = m?.minutes ? "held" : date >= today ? "upcoming" : m ? "no_minutes" : "missing";
      return { id: x.id, title: x.title, date, time: x.meeting_time, meeting_id: (m?.id as string) ?? null, state };
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const leaders = [...depts].filter((d) => d.completed_this_week > 0).sort((a, b) => b.completed_this_week - a.completed_this_week).slice(0, 6);
  const topScore = leaders[0]?.completed_this_week ?? 0;

  const totals = depts.reduce(
    (t, d) => ({
      open: t.open + d.open_count,
      overdue: t.overdue + d.overdue_count,
      blocked: t.blocked + d.blocked_count,
      done: t.done + d.completed_this_week,
    }),
    { open: 0, overdue: 0, blocked: 0, done: 0 },
  );

  const doneThisWeek = { status: "all" as const, completed_from: weekStart, sort: "completed" as const, dir: "desc" as const };
  const deptLinks = (slug?: string) => {
    const dept = slug ? [slug] : [];
    return {
      open: `/tasks${filtersToSearch({ dept })}`,
      overdue: `/tasks${filtersToSearch({ dept, overdue: true })}`,
      blocked: `/tasks${filtersToSearch({ dept, status: ["blocked"] })}`,
      done: `/tasks${filtersToSearch({ dept, ...doneThisWeek })}`,
    };
  };
  const all = deptLinks();

  const error = deptRes.error || personRes.error || seriesRes.error;

  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "Dashboard"]}
        title="Dashboard"
        description={`Week of ${formatDate(weekStart, "d MMM")} – ${formatDate(weekEndPKT(), "d MMM yyyy")} (PKT)`}
      />
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
        <Tile hero label="Overdue" value={totals.overdue} href={all.overdue} note="Across the company, past due and not done." />
        <Tile label="Open" value={totals.open} href={all.open} note="To do, in progress or blocked." />
        <Tile label="Blocked" value={totals.blocked} href={all.blocked} note="Waiting on something or someone." />
        <Tile label="Done this week" value={totals.done} href={all.done} note="Completed since Monday." />
      </div>

      <section className="mb-8">
        <h2 className="kicker mb-3 text-ink">This week&apos;s leaderboard</h2>
        {leaders.length === 0 ? (
          <p className="surface px-4 py-5 text-sm text-ink-muted">No tasks closed yet this week. First one takes the crown.</p>
        ) : (
          <ol className="surface space-y-3 p-4 md:p-6">
            {leaders.map((d, i) => (
              <li key={d.department_id} className="grid grid-cols-[1.5rem_8rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm md:grid-cols-[1.5rem_11rem_minmax(0,1fr)_3rem]">
                <span className="text-center font-semibold text-ink-muted">{i === 0 ? <CrownMark className="h-4 w-5" /> : i + 1}</span>
                <Link href={`/departments/${d.slug}`} className="truncate font-semibold text-ink hover:underline">
                  {d.name}
                </Link>
                <span className="h-2.5 overflow-hidden rounded-full bg-subtle">
                  <span
                    className={cn("block h-full rounded-full", i === 0 ? "bg-success" : "bg-success/60")}
                    style={{ width: `${Math.max(6, (d.completed_this_week / topScore) * 100)}%` }}
                  />
                </span>
                <span className="text-right font-semibold tabular-nums text-ink">{d.completed_this_week}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-xs text-ink-muted">Tasks closed since Monday, by department. Teams, not people.</p>
      </section>

      <section className="mb-8">
        <h2 className="kicker mb-3 text-ink">By department</h2>
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-subtle text-[13px] text-ink">
              <tr>
                <th className="px-3 py-2 text-left font-bold">Department</th>
                <th className="px-3 py-2 text-right font-bold">Open</th>
                <th className="px-3 py-2 text-right font-bold">Overdue</th>
                <th className="px-3 py-2 text-right font-bold">Blocked</th>
                <th className="px-3 py-2 text-right font-bold">Done this week</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line divide-line">
              {depts.map((d) => {
                const l = deptLinks(d.slug);
                return (
                  <tr key={d.department_id}>
                    <td className="px-3 py-2">
                      <Link href={`/departments/${d.slug}`} className="font-medium hover:underline">
                        {d.name}
                      </Link>
                    </td>
                    <NumCell value={d.open_count} href={l.open} />
                    <NumCell value={d.overdue_count} href={l.overdue} tone="red" />
                    <NumCell value={d.blocked_count} href={l.blocked} tone="amber" />
                    <NumCell value={d.completed_this_week} href={l.done} tone="green" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="kicker mb-3 text-ink">By person</h2>
          <div className="surface overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-subtle text-[13px] text-ink">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">Person</th>
                  <th className="px-3 py-2 text-right font-bold">Overdue</th>
                  <th className="px-3 py-2 text-right font-bold">Done this week</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line divide-line">
                {persons.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">
                      No tasks assigned yet.
                    </td>
                  </tr>
                )}
                {persons.map((p) => (
                  <tr key={p.user_id}>
                    <td className="px-3 py-2">
                      <Link href={`/activity?person=${p.user_id}`} className="hover:underline">
                        {personName(p)}
                      </Link>
                    </td>
                    <NumCell value={p.overdue_count} href={`/tasks${filtersToSearch({ owner: [p.user_id], overdue: true })}`} tone="red" />
                    <NumCell
                      value={p.completed_this_week}
                      href={`/tasks${filtersToSearch({ owner: [p.user_id], ...doneThisWeek })}`}
                      tone="green"
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="kicker mb-3 text-ink">Meetings this week</h2>
          <ul className="surface divide-y divide-line divide-line">
            {meetings.length === 0 && <li className="px-3 py-4 text-sm text-ink-muted">No meetings planned this week.</li>}
            {meetings.map((m) => {
              const state = MEETING_STATE[m.state];
              const href = m.meeting_id ? `/meetings/${m.meeting_id}` : `/meetings/series/${m.id}?date=${m.date}`;
              return (
                <li key={m.id}>
                  <Link href={href} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-muted/40">
                    <div className="min-w-0">
                      <p className="font-bold">{m.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(m.date, "EEE d MMM")} · {formatTime(m.time)}
                      </p>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", state.className)}>{state.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}

// Orange marks only numbers that need attention (brand guide §1).
const TONES = {
  red: "rounded-full bg-danger-soft px-2 py-0.5 text-danger-ink",
  amber: "text-ink",
  green: "text-ink",
};

/** Stat card: kicker, big number, one plain line. The hero card is filled purple. */
function Tile({ label, value, href, note, hero }: { label: string; value: number; href: string; note: string; hero?: boolean }) {
  return (
    <Link href={href} className={cn("block p-4 transition-opacity hover:opacity-90 md:p-6", hero ? "card-filled" : "card-outlined")}>
      <p className={cn("kicker", hero ? "text-white/80" : "text-ink")}>{label}</p>
      <p
        className={cn(
          "mt-1 text-[32px] font-bold leading-none tabular-nums md:text-[40px]",
          hero ? (value ? "text-danger-soft" : "text-white") : "text-ink",
        )}
      >
        {value}
      </p>
      <p className={cn("mt-2 text-[13px] font-medium", hero ? "text-white/75" : "text-ink-muted")}>{note}</p>
    </Link>
  );
}

function NumCell({ value, href, tone }: { value: number; href: string; tone?: keyof typeof TONES }) {
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      {value ? (
        <Link href={href} className={cn("font-semibold hover:underline", tone ? TONES[tone] : "text-ink")}>
          {value}
        </Link>
      ) : (
        <span className="text-ink-muted/70">0</span>
      )}
    </td>
  );
}
