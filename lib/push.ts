import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Web push to phones (Highfy Tasks on the home screen) and browsers. Needs
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY; without them the
 * Notifications page still works and nothing is pushed.
 */

export const isPushConfigured = () => !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let ready = false;
function setup() {
  if (ready) return true;
  if (!isPushConfigured()) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://tasks.highfy.pk", process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  ready = true;
  return true;
}

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

async function sendTo(subs: Sub[], payload: { title: string; body?: string | null; url: string; tag?: string }) {
  const db = createAdminClient();
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 12 });
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // The phone or browser turned it off, or the subscription expired.
        if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        else console.error("[push]", code, (e as Error).message);
      }
    }),
  );
}

/** Send every push that's waiting. Safe to call often and from many places at once. */
export async function flushPush() {
  if (!setup()) return;
  const db = createAdminClient();
  const { data, error } = await db.rpc("claim_pushes");
  if (error) return console.error("[push:claim]", error.message);
  const items = (data ?? []) as { id: string; user_id: string; title: string; body: string | null; href: string | null }[];
  if (!items.length) return;
  const { data: subs } = await db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", [...new Set(items.map((i) => i.user_id))]);
  for (const n of items) {
    const mine = ((subs ?? []) as Sub[]).filter((s) => s.user_id === n.user_id);
    if (mine.length) await sendTo(mine, { title: n.title, body: n.body, url: `/notifications/${n.id}`, tag: n.id });
  }
}

/** The "Send a test" button. */
export async function pushTest(userId: string): Promise<number> {
  if (!setup()) return 0;
  const { data } = await createAdminClient().from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").eq("user_id", userId);
  const subs = (data ?? []) as Sub[];
  await sendTo(subs, { title: "Highfy Tasks", body: "Notifications are on. This is how they'll look.", url: "/notifications" });
  return subs.length;
}
