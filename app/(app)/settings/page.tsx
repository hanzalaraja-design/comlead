import { PageHeader } from "@/components/page-header";
import { ClaudeConnector, type ClaudeKey } from "@/components/settings/claude-connector";
import { OutlookTasksToggle } from "@/components/settings/outlook-toggle";
import { NotificationSettings, type NotificationSettingsValue } from "@/components/settings/notification-settings";
import { PUSH_OFF_DEFAULT } from "@/lib/notification-kinds";
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
  const [{ data: ns }, { count: devices }] = await Promise.all([
    supabase.from("notification_settings").select("feed_off, push_off, quiet_from, quiet_to, quiet_days, paused_until").eq("user_id", viewer.id).maybeSingle(),
    supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", viewer.id),
  ]);
  const notifications: NotificationSettingsValue = (ns as NotificationSettingsValue | null) ?? {
    feed_off: [],
    push_off: PUSH_OFF_DEFAULT,
    quiet_from: null,
    quiet_to: null,
    quiet_days: [],
    paused_until: null,
  };
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
      <section id="notifications" className="surface scroll-mt-6 space-y-4 p-4 md:p-6">
        <div>
          <h2 className="kicker">Notifications</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Choose what shows on the Notifications page and what pushes to your phone or browser. Highfy Tasks doesn&apos;t send emails.
          </p>
        </div>
        <NotificationSettings initial={notifications} vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} devices={devices ?? 0} />
      </section>
      <section className="surface mt-4 space-y-6 p-4 md:p-6">
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
