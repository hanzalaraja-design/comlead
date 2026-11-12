"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { NOTIFY_GROUPS } from "@/lib/notification-kinds";
import { isPushConfigured, pushTest } from "@/lib/push";

const KEYS = NOTIFY_GROUPS.flatMap((g) => g.kinds.map((k) => k.key));

/** One notification, or all of them when no id is given. */
export async function markNotificationsRead(id?: string): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (id && !z.string().uuid().safeParse(id).success) return { ok: false, error: "Notification not found." };
  const supabase = await createClient();
  let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", viewer.id).is("read_at", null);
  if (id) q = q.eq("id", id);
  const { error } = await q;
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

const time = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .nullable();
const settingsSchema = z.object({
  feed_off: z.array(z.enum(KEYS as [string, ...string[]])).max(40),
  push_off: z.array(z.enum(KEYS as [string, ...string[]])).max(40),
  quiet_from: time,
  quiet_to: time,
  quiet_days: z.array(z.number().int().min(0).max(6)).max(7),
  pause_hours: z.number().int().min(0).max(24 * 14).nullable().optional(),
});
export type NotificationSettingsInput = z.input<typeof settingsSchema>;

export async function saveNotificationSettings(input: NotificationSettingsInput): Promise<ActionResult> {
  const viewer = await requireViewer();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some values aren't valid." };
  const { pause_hours, ...rest } = parsed.data;
  const row: Record<string, unknown> = { user_id: viewer.id, ...rest, quiet_days: [...new Set(rest.quiet_days)], updated_at: new Date().toISOString() };
  if (pause_hours !== undefined) row.paused_until = pause_hours ? new Date(Date.now() + pause_hours * 3600_000).toISOString() : null;
  if ((rest.quiet_from && !rest.quiet_to) || (!rest.quiet_from && rest.quiet_to)) return { ok: false, error: "Pick both times for quiet hours, or neither." };
  const supabase = await createClient();
  const { error } = await supabase.from("notification_settings").upsert(row, { onConflict: "user_id" });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/settings");
  return { ok: true };
}

const subSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});

/** This phone or browser turned push on. */
export async function savePushSubscription(sub: unknown, device: string): Promise<ActionResult> {
  const viewer = await requireViewer();
  const parsed = subSchema.safeParse(sub);
  if (!parsed.success) return { ok: false, error: "This browser sent something unexpected. Try again." };
  const supabase = await createClient();
  // Someone else used this browser before: it's theirs no more.
  await supabase.from("push_subscriptions").delete().eq("endpoint", parsed.data.endpoint);
  const { error } = await supabase.from("push_subscriptions").insert({
    user_id: viewer.id,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    device: device.slice(0, 120),
  });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/settings");
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  await requireViewer();
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/settings");
  return { ok: true };
}

export async function sendTestPush(): Promise<ActionResult<{ devices: number }>> {
  const viewer = await requireViewer();
  if (!isPushConfigured()) return { ok: false, error: "Push isn't set up on this site yet (the two VAPID keys in Vercel)." };
  return { ok: true, data: { devices: await pushTest(viewer.id) } };
}
