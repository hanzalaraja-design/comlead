import Link from "next/link";
import { Suspense } from "react";
import { CheckSquare, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { MeetingFilters } from "@/components/meetings/meeting-filters";
import { getDepartments, getPeople, requireViewer } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime, isISODate } from "@/lib/time";

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

  const { data, error } = await query;
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
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const canCreate = viewer.isAdmin || viewer.memberDeptIds.length > 0;

  return (
    <>
      <PageHeader
        breadcrumb={dept ? [{ label: "Meetings", href: "/meetings" }, dept.name] : ["Meetings", "All departments"]}
        title={dept ? `${dept.name} meetings` : "Meetings"}
        description="Weekly meetings, newest first"
        actions={
          canCreate && (
            <Button asChild size="sm">
              <Link href={`/meetings/new${dept ? `?dept=${dept.slug}` : ""}`}>
                <Plus className="h-4 w-4" /> New meeting
              </Link>
            </Button>
          )
        }
      />
      <Suspense>
        <MeetingFilters
          departments={departments.map((d) => ({ value: d.slug, label: d.name }))}
          people={people.map((p) => ({ value: p.id, label: personName(p) }))}
        />
      </Suspense>
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      {meetings.length === 0 ? (
        <EmptyState>{sp.q ? "No minutes match that search." : "No meetings recorded yet."}</EmptyState>
      ) : (
        <ul className="divide-y divide-brand-panel surface">
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
                    {!m.minutes && <span className="rounded-full bg-brand-accent px-2 py-0.5 font-semibold text-brand-primary-deep">No minutes yet</span>}
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
