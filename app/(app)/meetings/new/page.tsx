import { EmptyState, PageHeader } from "@/components/page-header";
import { SeriesForm } from "@/components/meetings/series-form";
import { getPeople, requireViewer } from "@/lib/auth";
import { getProjects } from "@/lib/projects";
import { departmentsForSetup } from "@/lib/meetings";
import { addDaysISO, formatDate, todayPKT } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "New meeting · Highfy Tasks" };

export default async function NewMeetingPage({ searchParams }: { searchParams: Promise<{ dept?: string; past?: string; follow_up?: string }> }) {
  const viewer = await requireViewer();
  const [{ dept, past: pastParam, follow_up }, departments, people, projects] = await Promise.all([searchParams, departmentsForSetup(viewer), getPeople(), getProjects()]);
  const past = pastParam === "1";
  const mine = departments.filter((d) => d.mine);

  // A follow-up: filled in from the main meeting (people, links, time), a week on.
  const supabase = await createClient();
  const main =
    follow_up && /^[0-9a-f-]{36}$/i.test(follow_up)
      ? ((await supabase.from("meetings").select("id, title, department_id, meeting_date, meeting_time").eq("id", follow_up).maybeSingle()).data as {
          id: string;
          title: string | null;
          department_id: string;
          meeting_date: string;
          meeting_time: string | null;
        } | null)
      : null;
  const [mainPeople, mainLinks] = main
    ? await Promise.all([
        supabase.from("meeting_attendees").select("user_id").eq("meeting_id", main.id),
        supabase.from("meeting_projects").select("project_id").eq("meeting_id", main.id).then((r) => (r.error ? { data: [] } : r)),
      ])
    : [{ data: [] }, { data: [] }];
  const home = (main && mine.find((d) => d.id === main.department_id)) || mine.find((d) => d.id === dept) || mine[0];
  const today = todayPKT();
  const weekOn = main ? addDaysISO(main.meeting_date > today ? main.meeting_date : today, 7) : today;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        breadcrumb={[{ label: "Meetings", href: "/meetings" }, main ? "Follow-up" : past ? "Past meeting" : "New meeting"]}
        title={main ? "Follow-up meeting" : past ? "Record a past meeting" : "New meeting"}
        description={
          main
            ? `Follow-up to ${main.title || "the meeting"} on ${formatDate(main.meeting_date, "EEE d MMM")}. Filled in from it: change anything, then pick when. Its open action items show on the follow-up.`
            : past
            ? "For a meeting that already happened. No invite is sent; you go straight to the minutes."
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
          initial={
            main
              ? {
                  title: `Follow-up: ${main.title || "meeting"}`.slice(0, 200),
                  department_id: home.id,
                  kind: "internal",
                  frequency: "once",
                  start_date: weekOn,
                  meeting_time: (main.meeting_time ?? "11:00").slice(0, 5),
                  duration_minutes: 60,
                  department_ids: [],
                  // The same people as the main meeting, minus you (you're always on what you set up).
                  user_ids: ((mainPeople.data ?? []) as { user_id: string }[]).map((r) => r.user_id).filter((u) => u !== viewer.id),
                  external_emails: [],
                  project_ids: ((mainLinks.data ?? []) as { project_id: string }[]).map((r) => r.project_id),
                  follow_up_of: main.id,
                }
              : {
                  title: "",
                  department_id: home.id,
                  kind: "internal",
                  frequency: past ? "once" : "weekly",
                  start_date: todayPKT(),
                  meeting_time: "11:00",
                  duration_minutes: 60,
                  // Nobody is invited until picked.
                  department_ids: [],
                  user_ids: [],
                  external_emails: [],
                  project_ids: [],
                }
          }
        />
      )}
    </div>
  );
}
