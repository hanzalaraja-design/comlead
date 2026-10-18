import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SeriesForm } from "@/components/meetings/series-form";
import { getPeople, requireViewer } from "@/lib/auth";
import { departmentsForSetup } from "@/lib/meetings";
import type { Frequency } from "@/lib/series";
import { createClient } from "@/lib/supabase/server";

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
  if (!s || s.archived) notFound();
  if (!canManage) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader breadcrumb={[{ label: "Meetings", href: "/meetings" }, s.title, "Edit"]} title="Edit meeting" />
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
