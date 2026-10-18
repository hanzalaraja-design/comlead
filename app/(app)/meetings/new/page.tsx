import { EmptyState, PageHeader } from "@/components/page-header";
import { SeriesForm } from "@/components/meetings/series-form";
import { getPeople, requireViewer } from "@/lib/auth";
import { departmentsForSetup } from "@/lib/meetings";
import { todayPKT } from "@/lib/time";

export const metadata = { title: "New meeting · Highfy Tasks" };

export default async function NewMeetingPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const viewer = await requireViewer();
  const [{ dept }, departments, people] = await Promise.all([searchParams, departmentsForSetup(viewer), getPeople()]);
  const mine = departments.filter((d) => d.mine);
  const home = mine.find((d) => d.id === dept) ?? mine[0];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        breadcrumb={[{ label: "Meetings", href: "/meetings" }, "New meeting"]}
        title="New meeting"
        description="Set it once. It goes to everyone's Outlook, and the agenda and minutes live here."
      />
      {!home ? (
        <EmptyState>You need to be in a department to set up a meeting. Ask an Admin to add you.</EmptyState>
      ) : (
        <SeriesForm
          id={null}
          departments={departments}
          people={people}
          canCancel={false}
          initial={{
            title: "",
            department_id: home.id,
            kind: "internal",
            frequency: "weekly",
            start_date: todayPKT(),
            meeting_time: "11:00",
            duration_minutes: 60,
            department_ids: [home.id],
            user_ids: [],
            external_emails: [],
          }}
        />
      )}
    </div>
  );
}
