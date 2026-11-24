import { EmptyState, PageHeader } from "@/components/page-header";
import { SeriesForm } from "@/components/meetings/series-form";
import { getPeople, requireViewer } from "@/lib/auth";
import { getProjects } from "@/lib/projects";
import { departmentsForSetup } from "@/lib/meetings";
import { todayPKT } from "@/lib/time";

export const metadata = { title: "New meeting · Highfy Tasks" };

export default async function NewMeetingPage({ searchParams }: { searchParams: Promise<{ dept?: string; past?: string }> }) {
  const viewer = await requireViewer();
  const [{ dept, past: pastParam }, departments, people, projects] = await Promise.all([searchParams, departmentsForSetup(viewer), getPeople(), getProjects()]);
  const past = pastParam === "1";
  const mine = departments.filter((d) => d.mine);
  const home = mine.find((d) => d.id === dept) ?? mine[0];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        breadcrumb={[{ label: "Meetings", href: "/meetings" }, past ? "Past meeting" : "New meeting"]}
        title={past ? "Record a past meeting" : "New meeting"}
        description={
          past
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
          initial={{
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
          }}
        />
      )}
    </div>
  );
}
