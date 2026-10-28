import { PageHeader } from "@/components/page-header";
import { ClaudeConnector, type ClaudeKey } from "@/components/settings/claude-connector";
import { OutlookTasksToggle } from "@/components/settings/outlook-toggle";
import { requireViewer } from "@/lib/auth";
import { isCalendarConfigured } from "@/lib/calendar/graph";
import { createClient } from "@/lib/supabase/server";
import { formatPKT } from "@/lib/time";

export const metadata = { title: "My settings · Highfy Tasks" };

export default async function SettingsPage() {
  const viewer = await requireViewer();
  const supabase = await createClient();
  // Until the keys table exists this simply shows no links.
  const { data } = await supabase
    .from("api_keys")
    .select("id, name, prefix, created_at, last_used_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .then((r) => (r.error ? { data: [] } : r));
  const keys: ClaudeKey[] = (data ?? []).map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    created: formatPKT(k.created_at, "d MMM yyyy"),
    lastUsed: k.last_used_at ? formatPKT(k.last_used_at, "d MMM, h:mm a") : null,
  }));
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
      <section className="surface mt-4 space-y-6 p-4 md:p-6">
        <h2 className="kicker">Connect to Claude</h2>
        <ClaudeConnector keys={keys} />
      </section>
    </div>
  );
}
