import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTime, weekdayName } from "@/lib/time";
import type { Department } from "@/lib/types";

export const metadata = { title: "Departments · Highfy Tasks" };

type Stats = { department_id: string; open_count: number; overdue_count: number; blocked_count: number; completed_this_week: number };

export default async function DepartmentsPage() {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const [{ data: depts }, { data: stats }] = await Promise.all([
    supabase.from("departments").select("*").eq("archived", false).order("sort_order").order("name"),
    supabase.rpc("dashboard_department_stats"),
  ]);
  const statsBy = new Map(((stats ?? []) as Stats[]).map((s) => [s.department_id, s]));
  const roleBy = new Map(viewer.memberships.map((m) => [m.department_id, m.role]));

  return (
    <>
      <PageHeader breadcrumb={["Departments", "All departments"]} title="Departments" />
      {!depts?.length ? (
        <EmptyState>You aren&apos;t in a department yet. Ask an Admin to add you.</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(depts as Department[]).map((d) => {
            const s = statsBy.get(d.id);
            const role = roleBy.get(d.id);
            return (
              <li key={d.id}>
                <Link href={`/departments/${d.slug}`} className="block surface p-4 hover:bg-muted/40">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold">{d.name}</h2>
                    {role && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {role === "lead" ? "Lead" : "Member"}
                      </span>
                    )}
                    {!role && !viewer.isAdmin && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">View only</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {d.meeting_weekday
                      ? `Weekly meeting: ${weekdayName(d.meeting_weekday)}${d.meeting_time ? ` ${formatTime(d.meeting_time)}` : ""}`
                      : "No meeting schedule set"}
                  </p>
                  {s && (
                    <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                      <Stat label="Open" value={s.open_count} />
                      <Stat label="Overdue" value={s.overdue_count} tone={s.overdue_count ? "red" : undefined} />
                      <Stat label="Blocked" value={s.blocked_count} tone={s.blocked_count ? "amber" : undefined} />
                      <Stat label="Done wk" value={s.completed_this_week} />
                    </dl>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "red" | "amber" }) {
  return (
    <div>
      <dd
        className={
          "text-lg font-semibold " +
          (tone === "red" ? "text-brand-accent" : "text-ink")
        }
      >
        {value}
      </dd>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
    </div>
  );
}
