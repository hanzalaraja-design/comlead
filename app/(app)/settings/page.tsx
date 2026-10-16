import { PageHeader } from "@/components/page-header";
import { OutlookTasksToggle } from "@/components/settings/outlook-toggle";
import { requireViewer } from "@/lib/auth";
import { isCalendarConfigured } from "@/lib/calendar/graph";

export const metadata = { title: "My settings · Highfy Tasks" };

export default async function SettingsPage() {
  const viewer = await requireViewer();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader breadcrumb={["Settings", "My settings"]} title="My settings" description={viewer.email} />
      <section className="surface space-y-6 p-4 md:p-6">
        <h2 className="kicker">Outlook calendar</h2>
        <p className="text-[13px] text-ink-muted">
          Your department&apos;s weekly meeting arrives as an Outlook invite from {process.env.MS_CALENDAR_MAILBOX ?? "the team mailbox"}.
          Nothing to switch on for that.
        </p>
        <OutlookTasksToggle enabled={!!viewer.profile.outlook_tasks_enabled} available={isCalendarConfigured()} />
      </section>
    </div>
  );
}
