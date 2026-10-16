import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { filtersToSearch } from "@/lib/tasks/filters";
import { formatDate, formatTime, weekEndPKT, weekStartPKT, weekdayName } from "@/lib/time";
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
  department_id: string;
  name: string;
  slug: string;
  meeting_weekday: number | null;
  meeting_time: string | null;
  meeting_id: string | null;
  meeting_date: string | null;
  state: "held" | "no_minutes" | "missing" | "upcoming" | "no_schedule";
};

const MEETING_STATE: Record<MeetingWeek["state"], { label: string; className: string }> = {
  held: { label: "Minutes saved", className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200" },
  no_minutes: { label: "Missing minutes", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  missing: { label: "Not held", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
  upcoming: { label: "Upcoming", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  no_schedule: { label: "No schedule set", className: "bg-muted text-muted-foreground" },
};

export default async function DashboardPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [deptRes, personRes, meetingRes] = await Promise.all([
    supabase.rpc("dashboard_department_stats"),
    supabase.rpc("dashboard_person_stats"),
    supabase.rpc("dashboard_meetings_this_week"),
  ]);
  const depts = (deptRes.data ?? []) as DeptStats[];
  const persons = ((personRes.data ?? []) as PersonStats[]).filter((p) => p.open_count || p.overdue_count || p.completed_this_week);
  const meetings = (meetingRes.data ?? []) as MeetingWeek[];
  const weekStart = weekStartPKT();

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

  const error = deptRes.error || personRes.error || meetingRes.error;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Week of ${formatDate(weekStart, "d MMM")} – ${formatDate(weekEndPKT(), "d MMM yyyy")} (PKT)`}
      />
      {error && <p className="mb-3 text-sm text-red-600">{error.message}</p>}

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Open tasks" value={totals.open} href={all.open} />
        <Tile label="Overdue" value={totals.overdue} href={all.overdue} tone={totals.overdue ? "red" : undefined} />
        <Tile label="Blocked" value={totals.blocked} href={all.blocked} tone={totals.blocked ? "amber" : undefined} />
        <Tile label="Completed this week" value={totals.done} href={all.done} tone="green" />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">By department</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Department</th>
                <th className="px-3 py-2 text-right font-medium">Open</th>
                <th className="px-3 py-2 text-right font-medium">Overdue</th>
                <th className="px-3 py-2 text-right font-medium">Blocked</th>
                <th className="px-3 py-2 text-right font-medium">Done this week</th>
              </tr>
            </thead>
            <tbody className="divide-y">
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
          <h2 className="mb-3 text-sm font-semibold">By person</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Person</th>
                  <th className="px-3 py-2 text-right font-medium">Overdue</th>
                  <th className="px-3 py-2 text-right font-medium">Done this week</th>
                </tr>
              </thead>
              <tbody className="divide-y">
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
          <h2 className="mb-3 text-sm font-semibold">Meetings this week</h2>
          <ul className="divide-y rounded-lg border">
            {meetings.map((m) => {
              const state = MEETING_STATE[m.state];
              const href = m.meeting_id ? `/meetings/${m.meeting_id}` : `/meetings?dept=${m.slug}`;
              return (
                <li key={m.department_id}>
                  <Link href={href} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-muted/40">
                    <div className="min-w-0">
                      <p className="font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.meeting_date
                          ? formatDate(m.meeting_date, "EEE d MMM")
                          : m.meeting_weekday
                            ? `${weekdayName(m.meeting_weekday)}${m.meeting_time ? ` ${formatTime(m.meeting_time)}` : ""}`
                            : "—"}
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

const TONES = {
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  green: "text-green-700 dark:text-green-400",
};

function Tile({ label, value, href, tone }: { label: string; value: number; href: string; tone?: keyof typeof TONES }) {
  return (
    <Link href={href} className="rounded-lg border p-4 hover:bg-muted/40">
      <p className={cn("text-2xl font-semibold tabular-nums", tone && value ? TONES[tone] : undefined)}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Link>
  );
}

function NumCell({ value, href, tone }: { value: number; href: string; tone?: keyof typeof TONES }) {
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      {value ? (
        <Link href={href} className={cn("font-medium hover:underline", tone && TONES[tone])}>
          {value}
        </Link>
      ) : (
        <span className="text-muted-foreground">0</span>
      )}
    </td>
  );
}
