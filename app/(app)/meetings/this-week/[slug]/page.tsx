import { addDays, format, startOfWeek } from "date-fns";
import { notFound, redirect } from "next/navigation";
import { getDepartments, isMemberOf, requireViewer } from "@/lib/auth";
import { insertMeeting } from "@/lib/meetings";
import { createClient } from "@/lib/supabase/server";
import { nowPKT } from "@/lib/time";

/**
 * Target of the "Open this week's minutes" link in Outlook invites: opens this
 * week's meeting for the department, creating it if nobody has yet.
 */
export default async function ThisWeekMeetingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await requireViewer();
  const dept = (await getDepartments()).find((d) => d.slug === slug);
  if (!dept) notFound();

  const monday = startOfWeek(nowPKT(), { weekStartsOn: 1 });
  const from = format(monday, "yyyy-MM-dd");
  const to = format(addDays(monday, 6), "yyyy-MM-dd");

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("meetings")
    .select("id")
    .eq("department_id", dept.id)
    .gte("meeting_date", from)
    .lte("meeting_date", to)
    .order("meeting_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (existing?.length) redirect(`/meetings/${existing[0].id}`);

  if (!isMemberOf(viewer, dept.id)) redirect(`/meetings?dept=${slug}`);
  const date = dept.meeting_weekday ? format(addDays(monday, dept.meeting_weekday - 1), "yyyy-MM-dd") : format(nowPKT(), "yyyy-MM-dd");
  const { id } = await insertMeeting(supabase, viewer.id, {
    department_id: dept.id,
    meeting_date: date,
    meeting_time: dept.meeting_time,
    title: `${dept.name} weekly`,
  });
  redirect(id ? `/meetings/${id}?edit=1` : `/meetings?dept=${slug}`);
}
