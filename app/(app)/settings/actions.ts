"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { syncLater } from "@/lib/calendar/schedule";
import { siteUrl, syncUserTasks } from "@/lib/calendar/sync";
import { newKey } from "@/lib/mcp/keys";

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

/** A new personal link for the Claude connector. The full link is only ever shown now. */
export async function createClaudeKey(name: string): Promise<ActionResult<{ url: string }>> {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const { key, hash, prefix } = newKey();
  const label = name.trim().slice(0, 60) || "Claude";
  const { error } = await supabase.from("api_keys").insert({ user_id: viewer.id, name: label, prefix, key_hash: hash });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/settings");
  return { ok: true, data: { url: `${siteUrl()}/api/mcp?key=${key}` } };
}

export async function revokeClaudeKey(id: string): Promise<ActionResult> {
  await requireViewer();
  const supabase = await createClient();
  const { error } = await supabase.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null);
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/settings");
  return { ok: true };
}
