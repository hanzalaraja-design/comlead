"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const uuid = z.string().uuid();

function done() {
  revalidatePath("/", "layout");
  return { ok: true } as const;
}

/** Leads may add Members to their department; Admin may add anyone as anything. */
export async function addMember(departmentId: string, userId: string, role: "lead" | "member" = "member"): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(departmentId).success || !uuid.safeParse(userId).success) return { ok: false, error: "Invalid input" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("department_members")
    .insert({ department_id: departmentId, user_id: userId, role: role === "lead" ? "lead" : "member" });
  if (error) return { ok: false, error: friendlyError(error) };
  return done();
}

export async function removeMember(departmentId: string, userId: string): Promise<ActionResult> {
  await requireViewer();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("department_members")
    .delete()
    .eq("department_id", departmentId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "You can't remove this person." };
  return done();
}

export async function setMemberRole(departmentId: string, userId: string, role: "lead" | "member"): Promise<ActionResult> {
  await requireViewer();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("department_members")
    .update({ role: role === "lead" ? "lead" : "member" })
    .eq("department_id", departmentId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only Admin can change roles." };
  return done();
}

const scheduleSchema = z.object({
  departmentId: uuid,
  weekday: z.number().int().min(1).max(7).nullable(),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .nullable(),
});

export async function setMeetingSchedule(departmentId: string, weekday: number | null, time: string | null): Promise<ActionResult> {
  await requireViewer();
  const parsed = scheduleSchema.safeParse({ departmentId, weekday, time: time || null });
  if (!parsed.success) return { ok: false, error: "Pick a valid day and time." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("departments")
    .update({ meeting_weekday: parsed.data.weekday, meeting_time: parsed.data.time })
    .eq("id", departmentId)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only the department Lead or Admin can change the schedule." };
  return done();
}
