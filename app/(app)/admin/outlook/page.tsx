import { PageHeader } from "@/components/page-header";
import { OutlookPanel } from "@/components/admin/outlook-panel";
import { requireAdmin } from "@/lib/auth";
import { runChecks } from "@/lib/calendar/diagnostics";

export const metadata = { title: "Outlook · Highfy Tasks" };

export default async function OutlookAdminPage() {
  await requireAdmin();
  const checks = await runChecks();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumb={["Admin", "Outlook"]}
        title="Outlook calendar"
        description="Checks the connection to Microsoft and lets you run the sync on demand."
      />
      <OutlookPanel initial={checks} />
    </div>
  );
}
