"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { syncLater } from "@/lib/calendar/schedule";
import { syncSeriesForDepartment } from "@/lib/calendar/sync";

const uuid = z.string().uuid();

function done(departmentId?: string) {
  revalidatePath("/", "layout");
  // Members feed the Outlook invites of meetings that invite the department.
  if (departmentId) syncLater(() => syncSeriesForDepartment(departmentId));
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
  return done(departmentId);
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
  return done(departmentId);
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
  return done(departmentId);
}
