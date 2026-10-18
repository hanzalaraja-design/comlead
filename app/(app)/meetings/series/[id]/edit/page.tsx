import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SeriesForm } from "@/components/meetings/series-form";
import { getPeople, requireViewer } from "@/lib/auth";
import { departmentsForSetup } from "@/lib/meetings";
import type { Frequency } from "@/lib/series";
import { createClient } from "@/lib/supabase/server";
import { seriesOutlookStatus } from "@/lib/calendar/sync";
import { formatPKT } from "@/lib/time";

export const metadata = { title: "Edit meeting · Highfy Tasks" };

export default async function EditSeriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const viewer = await requireViewer();
  const supabase = await createClient();
  const [{ data: s }, { data: depts }, { data: ppl }, { data: canManage }, departments, people] = await Promise.all([
    supabase.from("meeting_series").select("*").eq("id", id).maybeSingle(),
    supabase.from("meeting_series_departments").select("department_id").eq("series_id", id),
    supabase.from("meeting_series_people").select("user_id").eq("series_id", id),
    supabase.rpc("can_manage_series", { p_series_id: id }),
    departmentsForSetup(viewer),
    getPeople(),
  ]);
  const outlook = await seriesOutlookStatus(id);
  if (!s || s.archived) notFound();
  if (!canManage) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader breadcrumb={[{ label: "Meetings", href: "/meetings" }, s.title, "Edit"]} title="Edit meeting" />
      {outlook && (
        <div
          className={
            outlook.sent && outlook.invitees.length
              ? "mb-4 rounded-[20px] bg-success-soft px-4 py-3 text-sm text-success-ink"
              : "mb-4 rounded-[20px] bg-warning-soft px-4 py-3 text-sm text-warning-ink"
          }
        >
          <p className="font-semibold">
            {!outlook.sent
              ? "Not in Outlook yet. Save again, or run Sync now under Admin → Outlook to see why."
              : outlook.invitees.length
                ? `In Outlook${outlook.sentAt ? ` (updated ${formatPKT(outlook.sentAt, "d MMM, h:mm a")})` : ""}. Invite goes to ${outlook.invitees.length} ${outlook.invitees.length === 1 ? "person" : "people"}:`
                : "In Outlook, but nobody is invited. Add people or a team with members below."}
          </p>
          {outlook.invitees.length > 0 && <p className="mt-1">{outlook.invitees.map((i) => i.name).join(", ")}</p>}
        </div>
      )}
      <SeriesForm
        id={id}
        departments={departments.map((d) => (d.id === s.department_id ? { ...d, mine: true } : d))}
        people={people}
        canCancel
        initial={{
          title: s.title,
          department_id: s.department_id,
          kind: s.kind,
          frequency: s.frequency as Frequency,
          start_date: s.start_date,
          meeting_time: String(s.meeting_time).slice(0, 5),
          duration_minutes: s.duration_minutes,
          department_ids: (depts ?? []).map((d) => d.department_id as string),
          user_ids: (ppl ?? []).map((p) => p.user_id as string),
          external_emails: s.external_emails ?? [],
        }}
      />
    </div>
  );
}
