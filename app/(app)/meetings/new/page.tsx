import { EmptyState, PageHeader } from "@/components/page-header";
import { SeriesForm } from "@/components/meetings/series-form";
import { getPeople, requireViewer } from "@/lib/auth";
import { getProjects } from "@/lib/projects";
import { departmentsForSetup } from "@/lib/meetings";
import { addDaysISO, formatDate, todayPKT } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "New meeting · Highfy Tasks" };

export default async function NewMeetingPage({ searchParams }: { searchParams: Promise<{ dept?: string; past?: string; followup?: string }> }) {
  const viewer = await requireViewer();
  const [{ dept, past: pastParam, followup }, departments, people, projects] = await Promise.all([searchParams, departmentsForSetup(viewer), getPeople(), getProjects()]);
  const from = followup && /^[0-9a-f-]{36}$/i.test(followup) ? await followUpOf(followup) : null;
  const past = pastParam === "1" && !from;
  const mine = departments.filter((d) => d.mine);
  const home = mine.find((d) => d.id === (from?.department_id ?? dept)) ?? mine[0];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        breadcrumb={[{ label: "Meetings", href: "/meetings" }, past ? "Past meeting" : from ? "Follow-up meeting" : "New meeting"]}
        title={past ? "Record a past meeting" : from ? "Follow-up meeting" : "New meeting"}
        description={
          past
            ? "For a meeting that already happened. No invite is sent; you go straight to the minutes."
            : from
              ? `Follows up "${from.sourceTitle}" from ${formatDate(from.sourceDate, "EEE d MMM")}. Same people and links; change anything before sending.`
              : "Set it once. It goes to everyone's Outlook, and the agenda and minutes live here."
        }
      />
      {!home ? (
        <EmptyState>You need to be in a department to set up a meeting. Ask an Admin to add you.</EmptyState>
      ) : (
        <SeriesForm
          id={null}
          departments={departments}
          people={people}
          canCancel={false}
          past={past}
          projects={projects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name, kind: p.kind }))}
          initial={{
            title: from?.title ?? "",
            department_id: home.id,
            kind: from?.kind ?? "internal",
            frequency: past || from ? "once" : "weekly",
            start_date: from?.start_date ?? todayPKT(),
            meeting_time: from?.meeting_time ?? "11:00",
            duration_minutes: from?.duration_minutes ?? 60,
            // Only the people picked (and you); a whole team only when you add it.
            department_ids: [],
            user_ids: (from?.user_ids ?? []).filter((u) => u !== viewer.id),
            external_emails: from?.external_emails ?? [],
            project_ids: from?.project_ids ?? [],
          }}
        />
      )}
    </div>
  );
}

/** A follow-up to a meeting: same team, people, guests and links; one week later (or today, if that's passed). */
async function followUpOf(meetingId: string) {
  const supabase = await createClient();
  const { data: m } = await supabase.from("meetings").select("id, title, department_id, meeting_date, meeting_time, series_id").eq("id", meetingId).maybeSingle();
  if (!m) return null;
  const [{ data: attendees }, { data: links }, series] = await Promise.all([
    supabase.from("meeting_attendees").select("user_id").eq("meeting_id", meetingId),
    supabase.from("meeting_projects").select("project_id").eq("meeting_id", meetingId).then((r) => (r.error ? { data: [] } : r)),
    m.series_id
      ? supabase.from("meeting_series").select("kind, duration_minutes, external_emails").eq("id", m.series_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const title = (m.title as string | null)?.trim() || "Meeting";
  const nextWeek = addDaysISO(m.meeting_date as string, 7);
  const s = series.data as { kind: "internal" | "external"; duration_minutes: number; external_emails: string[] } | null;
  return {
    sourceTitle: title,
    sourceDate: m.meeting_date as string,
    title: /^follow-up:/i.test(title) ? title : `Follow-up: ${title}`.slice(0, 200),
    department_id: m.department_id as string,
    start_date: nextWeek > todayPKT() ? nextWeek : todayPKT(),
    meeting_time: ((m.meeting_time as string | null) ?? "11:00").slice(0, 5),
    kind: s?.kind ?? ("internal" as const),
    duration_minutes: s?.duration_minutes ?? 60,
    external_emails: s?.external_emails ?? [],
    user_ids: ((attendees ?? []) as { user_id: string }[]).map((a) => a.user_id),
    project_ids: ((links ?? []) as { project_id: string }[]).map((l) => l.project_id),
  };
}
