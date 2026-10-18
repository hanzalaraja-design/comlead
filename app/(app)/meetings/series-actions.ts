"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { syncLater } from "@/lib/calendar/schedule";
import { syncSeries } from "@/lib/calendar/sync";

const uuid = z.string().uuid();

const seriesSchema = z.object({
  title: z.string().trim().min(1, "Give the meeting a name.").max(200),
  department_id: uuid,
  kind: z.enum(["internal", "external"]),
  frequency: z.enum(["once", "weekly", "fortnightly", "monthly"]),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  meeting_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Pick a time."),
  duration_minutes: z.number().int().min(15).max(480),
  department_ids: z.array(uuid).max(50),
  user_ids: z.array(uuid).max(300),
  external_emails: z.array(z.string().trim().toLowerCase().email("One of the email addresses isn't valid.")).max(100),
});

export type SeriesInput = z.input<typeof seriesSchema>;

/** Create or update a meeting, its invite list and its Outlook invite. */
export async function saveSeries(id: string | null, input: SeriesInput): Promise<ActionResult<{ id: string }>> {
  const viewer = await requireViewer();
  if (id && !uuid.safeParse(id).success) return { ok: false, error: "Meeting not found." };
  const parsed = seriesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Some values aren't valid." };
  const { department_ids, user_ids, ...fields } = parsed.data;
  const row = { ...fields, external_emails: fields.kind === "external" ? [...new Set(fields.external_emails)] : [] };
  const supabase = await createClient();

  let seriesId = id;
  if (seriesId) {
    const { data, error } = await supabase.from("meeting_series").update(row).eq("id", seriesId).select("id");
    if (error) return { ok: false, error: friendlyError(error) };
    if (!data?.length) return { ok: false, error: "Only whoever set this meeting up, or a department admin, can change it." };
  } else {
    const { data, error } = await supabase
      .from("meeting_series")
      .insert({ ...row, created_by: viewer.id })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: friendlyError(error) };
    seriesId = data.id as string;
  }

  // Replace the invite list with what was sent.
  const [{ data: haveDepts }, { data: havePeople }] = await Promise.all([
    supabase.from("meeting_series_departments").select("department_id").eq("series_id", seriesId),
    supabase.from("meeting_series_people").select("user_id").eq("series_id", seriesId),
  ]);
  const wantDepts = new Set(department_ids);
  const wantPeople = new Set(user_ids);
  const oldDepts = (haveDepts ?? []).map((r) => r.department_id as string);
  const oldPeople = (havePeople ?? []).map((r) => r.user_id as string);
  const steps = [
    oldDepts.some((d) => !wantDepts.has(d)) &&
      supabase.from("meeting_series_departments").delete().eq("series_id", seriesId).in("department_id", oldDepts.filter((d) => !wantDepts.has(d))),
    oldPeople.some((u) => !wantPeople.has(u)) &&
      supabase.from("meeting_series_people").delete().eq("series_id", seriesId).in("user_id", oldPeople.filter((u) => !wantPeople.has(u))),
    [...wantDepts].some((d) => !oldDepts.includes(d)) &&
      supabase.from("meeting_series_departments").insert([...wantDepts].filter((d) => !oldDepts.includes(d)).map((department_id) => ({ series_id: seriesId, department_id }))),
    [...wantPeople].some((u) => !oldPeople.includes(u)) &&
      supabase.from("meeting_series_people").insert([...wantPeople].filter((u) => !oldPeople.includes(u)).map((user_id) => ({ series_id: seriesId, user_id }))),
  ].filter(Boolean);
  for (const step of steps) {
    const { error } = await (step as PromiseLike<{ error: { message?: string; code?: string } | null }>);
    if (error) return { ok: false, error: friendlyError(error) };
  }

  revalidatePath("/meetings");
  const finalId = seriesId;
  syncLater(() => syncSeries(finalId));
  return { ok: true, data: { id: finalId } };
}

/** Cancel a meeting: it stops repeating and everyone gets an Outlook cancellation. Past minutes stay. */
export async function cancelSeries(id: string): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Meeting not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("meeting_series").update({ archived: true }).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only whoever set this meeting up, or a department admin, can cancel it." };
  revalidatePath("/meetings");
  syncLater(() => syncSeries(id));
  return { ok: true };
}
