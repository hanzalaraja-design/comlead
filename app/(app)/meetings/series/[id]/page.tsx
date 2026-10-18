import { notFound, redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { currentOccurrence, type Frequency } from "@/lib/series";
import { createClient } from "@/lib/supabase/server";
import { isISODate, todayPKT } from "@/lib/time";

/**
 * The link in every Outlook invite: opens this occurrence's agenda and
 * minutes, starting them if nobody has yet.
 */
export default async function OpenSeriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const [{ id }, { date }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await requireViewer();
  const supabase = await createClient();
  const { data: s } = await supabase.from("meeting_series").select("frequency, start_date").eq("id", id).maybeSingle();
  if (!s) notFound();

  const day = isISODate(date) ? date : currentOccurrence({ frequency: s.frequency as Frequency, start_date: s.start_date }, todayPKT());
  const { data: meetingId, error } = await supabase.rpc("open_series_meeting", { p_series_id: id, p_date: day });
  if (error || !meetingId) notFound();

  const { data: m } = await supabase.from("meetings").select("minutes, agenda").eq("id", meetingId).maybeSingle();
  redirect(`/meetings/${meetingId}${!m?.minutes && !m?.agenda ? "?edit=1" : ""}`);
}
