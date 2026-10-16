"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { syncLater } from "@/lib/calendar/schedule";
import { syncUserTasks } from "@/lib/calendar/sync";

export async function setOutlookTasks(enabled: boolean): Promise<ActionResult> {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_outlook_tasks", { p_enabled: !!enabled });
  if (error) return { ok: false, error: friendlyError(error) };
  // Adds (or removes) the events for every task this person owns.
  syncLater(() => syncUserTasks(viewer.id));
  revalidatePath("/settings");
  return { ok: true };
}
