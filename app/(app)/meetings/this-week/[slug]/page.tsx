import { notFound, redirect } from "next/navigation";
import { getDepartments, requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Older Outlook invites link here: open the department's main meeting instead. */
export default async function ThisWeekMeetingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireViewer();
  const dept = (await getDepartments()).find((d) => d.slug === slug);
  if (!dept) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from("meeting_series")
    .select("id")
    .eq("department_id", dept.id)
    .eq("archived", false)
    .order("created_at")
    .limit(1);
  redirect(data?.length ? `/meetings/series/${data[0].id}` : `/meetings?dept=${slug}`);
}
