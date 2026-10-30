"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

/** Clear mentions from My tasks: one, or all of them when no id is given. */
export async function markMentionsRead(id?: string): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (id && !z.string().uuid().safeParse(id).success) return { ok: false, error: "Mention not found." };
  const supabase = await createClient();
  // Task and meeting mentions share the inbox; an id belongs to one of them.
  const clear = (table: "task_mentions" | "meeting_mentions") => {
    let q = supabase.from(table).update({ seen_at: new Date().toISOString() }).eq("user_id", viewer.id).is("seen_at", null);
    if (id) q = q.eq("id", id);
    return q;
  };
  const [{ error }] = await Promise.all([clear("task_mentions"), clear("meeting_mentions")]);
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}
