import Link from "next/link";
import { Suspense } from "react";
import { CalendarClock, CheckSquare, Globe2, History, Pencil, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { MeetingFilters } from "@/components/meetings/meeting-filters";
import { canLead, getDepartments, getPeople, requireViewer } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime, isISODate, todayPKT } from "@/lib/time";
import { describeSeries, nextOnOrAfter, type Frequency } from "@/lib/series";

export const metadata = { title: "Meetings · Highfy Tasks" };

const UUID_RE = /^[0-9a-f-]{36}$/i;

function snippet(html: string | null, max = 180) {
  const text = (html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; q?: string; from?: string; to?: string; attendee?: string }>;
}) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const supabase = await createClient();
  const [departments, people] = await Promise.all([getDepartments(), getPeople()]);
  const dept = departments.find((d) => d.slug === sp.dept);

  let query = supabase
    .from("meetings")
    .select(
      "id, title, meeting_date, meeting_time, minutes, department_id, attendees:meeting_attendees(user_id), items:tasks!tasks_meeting_id_fkey(id, status)",
    )
    .order("meeting_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (dept) query = query.eq("department_id", dept.id);
  if (isISODate(sp.from)) query = query.gte("meeting_date", sp.from);
  if (isISODate(sp.to)) query = query.lte("meeting_date", sp.to);
  if (sp.q?.trim()) query = query.textSearch("search", sp.q.trim().slice(0, 200), { type: "websearch", config: "english" });
  if (sp.attendee && UUID_RE.test(sp.attendee)) {
    const { data: att } = await supabase.from("meeting_attendees").select("meeting_id").eq("user_id", sp.attendee);
    const ids = (att ?? []).map((a) => a.meeting_id as string);
    query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }

  const [{ data, error }, { data: seriesData }] = await Promise.all([
    query,
    supabase
      .from("meeting_series")
      .select("id, title, department_id, kind, frequency, start_date, meeting_time, created_by")
      .eq("archived", false)
      .order("meeting_time"),
  ]);
  const today = todayPKT();
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const upcoming = ((seriesData ?? []) as {
    id: string;
    title: string;
    department_id: string;
    kind: "internal" | "external";
    frequency: Frequency;
    start_date: string;
    meeting_time: string;
    created_by: string | null;
  }[])
    .filter((x) => !dept || x.department_id === dept.id)
    .map((x) => ({ ...x, next: nextOnOrAfter(x, today) }))
    .filter((x): x is typeof x & { next: string } => x.next !== null)
    .sort((a, b) => (a.next === b.next ? a.meeting_time.localeCompare(b.meeting_time) : a.next.localeCompare(b.next)));
  const meetings = (data ?? []) as unknown as {
    id: string;
    title: string | null;
    meeting_date: string;
    meeting_time: string | null;
    minutes: string | null;
    department_id: string;
    attendees: { user_id: string }[];
    items: { id: string; status: string }[];
  }[];
  const canCreate = viewer.isAdmin || viewer.memberDeptIds.length > 0;

  return (
    <>
      <PageHeader
        breadcrumb={dept ? [{ label: "Meetings", href: "/meetings" }, dept.name] : ["Meetings", "All departments"]}
        title={dept ? `${dept.name} meetings` : "Meetings"}
        description="Plan meetings, take minutes, turn them into tasks."
        actions={
          canCreate && (
            <>
              <Button asChild size="sm" variant="outline">
                <Link href={`/meetings/new?past=1${dept ? `&dept=${dept.id}` : ""}`}>
                  <History className="h-4 w-4" /> Record a past meeting
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href={`/meetings/new${dept ? `?dept=${dept.id}` : ""}`}>
                  <Plus className="h-4 w-4" /> New meeting
                </Link>
              </Button>
            </>
          )
        }
      />
      <Suspense>
        <MeetingFilters
          departments={departments.map((d) => ({ value: d.slug, label: d.name }))}
          people={people.map((p) => ({ value: p.id, label: personName(p) }))}
        />
      </Suspense>
      {!sp.q && upcoming.length > 0 && (
        <section className="mb-8">
          <h2 className="kicker mb-2 text-ink">Upcoming</h2>
          <ul className="divide-y divide-line surface">
            {upcoming.map((x) => {
              const isToday = x.next === today;
              return (
                <li key={x.id} className="flex items-center gap-3 px-4 py-3">
                  <div
                    className={
                      isToday
                        ? "flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[12px] bg-info-soft text-info"
                        : "flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[12px] bg-subtle text-ink"
                    }
                  >
                    <span className="text-[10px] font-semibold uppercase leading-none">{formatDate(x.next, "MMM")}</span>
                    <span className="text-lg font-semibold leading-tight">{formatDate(x.next, "d")}</span>
                  </div>
                  <Link href={`/meetings/series/${x.id}?date=${x.next}`} className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate font-medium">
                      {x.title}
                      {x.kind === "external" && <Globe2 className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-label="External" />}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {isToday ? `Today at ${formatTime(x.meeting_time)}` : describeSeries(x)}
                      {!dept && ` · ${deptName.get(x.department_id) ?? ""}`}
                    </p>
                  </Link>
                  {(x.created_by === viewer.id || canLead(viewer, x.department_id)) && (
                    <Button asChild variant="ghost" size="sm" className="shrink-0 text-ink-muted">
                      <Link href={`/meetings/series/${x.id}/edit`} aria-label={`Edit ${x.title}`}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {!sp.q && upcoming.length === 0 && canCreate && (
        <div className="mb-8 flex items-center gap-3 rounded-[20px] border border-dashed border-line p-4 text-sm text-ink-muted">
          <CalendarClock className="h-5 w-5 shrink-0" />
          <span className="flex-1">No meetings planned. Set one up and it lands in everyone&apos;s Outlook.</span>
          <Button asChild size="sm" variant="outline">
            <Link href="/meetings/new">Set one up</Link>
          </Button>
        </div>
      )}
      <h2 className="kicker mb-2 text-ink">{sp.q ? "Results" : "Past meetings"}</h2>
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      {meetings.length === 0 ? (
        <EmptyState>{sp.q ? "No minutes match that search." : "No meetings recorded yet."}</EmptyState>
      ) : (
        <ul className="divide-y divide-line surface">
          {meetings.map((m) => {
            const open = m.items.filter((i) => i.status !== "done" && i.status !== "cancelled").length;
            return (
              <li key={m.id}>
                <Link href={`/meetings/${m.id}`} className="block px-4 py-3 hover:bg-muted/40">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <h2 className="font-medium">{m.title || `${deptName.get(m.department_id) ?? ""} weekly meeting`}</h2>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(m.meeting_date, "EEE d MMM yyyy")}
                      {m.meeting_time && ` · ${formatTime(m.meeting_time)}`}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {!dept && <span>{deptName.get(m.department_id)}</span>}
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> {m.attendees.length}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CheckSquare className="h-3 w-3" /> {m.items.length} action item{m.items.length === 1 ? "" : "s"}
                      {open > 0 && ` · ${open} open`}
                    </span>
                    {!m.minutes && <span className="rounded-full bg-warning-soft px-2 py-0.5 font-semibold text-warning-ink">No minutes yet</span>}
                  </div>
                  {m.minutes && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{snippet(m.minutes)}</p>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
