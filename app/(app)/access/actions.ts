"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { flushPush } from "@/lib/push";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const typeSchema = z.enum(["task", "project", "placement_tab"]);

/** Ask the owner for access to a task, project, campaign or partnership. */
export async function requestAccess(type: string, key: string, reason: string): Promise<ActionResult> {
  await requireViewer();
  const t = typeSchema.safeParse(type);
  if (!t.success || !key || key.length > 200) return { ok: false, error: "That isn't something you can ask for." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_access", { p_type: t.data, p_key: key, p_reason: reason.slice(0, 500) || null });
  if (error) return { ok: false, error: friendlyError(error) };
  await flushPush();
  revalidatePath("/request-access");
  if (t.data === "placement_tab") revalidatePath("/placements");
  return { ok: true };
}

/** The owner gives access, or declines. */
export async function decideAccess(requestId: string, give: boolean): Promise<ActionResult> {
  await requireViewer();
  if (!z.string().uuid().safeParse(requestId).success) return { ok: false, error: "That request isn't valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_access", { p_request: requestId, p_give: give });
  if (error) return { ok: false, error: friendlyError(error) };
  await flushPush();
  revalidatePath(`/access/${requestId}`);
  return { ok: true };
}
