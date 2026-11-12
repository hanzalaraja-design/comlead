import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/calendar/sync";
import type { PlacementRole } from "@/lib/placements";
import { flushPush } from "@/lib/push";

/**
 * Notifications: the Notifications page and push to phones and browsers.
 * Task events are raised by the database; this is for everything else
 * (placements, design requests, reminders). Each person's settings decide
 * whether it shows and whether it pushes.
 */

export type NotifyKind =
  | "assigned"
  | "collaborator"
  | "mention"
  | "comment"
  | "finished"
  | "status"
  | "due"
  | "edits"
  | "roundup"
  | "due_tomorrow"
  | "project_task"
  | "project_added"
  | "meeting"
  | "design_new"
  | "my_requests"
  | "revision"
  | "ending"
  | "homepage_today";

export type NotifyMessage = { title: string; body?: string | null; href: string; actorId?: string | null; taskId?: string | null };

/** Active members of the team that does this job. */
export async function teamMembers(role: PlacementRole): Promise<string[]> {
  const db = createAdminClient();
  const { data: settings } = await db.from("placement_settings").select("*").eq("id", 1).maybeSingle();
  const deptId = settings?.[`${role}_department_id`] as string | null | undefined;
  if (!deptId) return [];
  const { data } = await db.from("department_members").select("user_id, profiles!inner(status)").eq("department_id", deptId);
  return ((data ?? []) as unknown as { user_id: string; profiles: { status: string } }[]).filter((r) => r.profiles.status === "active").map((r) => r.user_id);
}

/** Notify now (inside a cron or after()). */
export async function notify(userIds: (string | null | undefined)[], kind: NotifyKind, m: NotifyMessage) {
  const db = createAdminClient();
  for (const id of new Set(userIds.filter((x): x is string => !!x))) {
    const { error } = await db.rpc("notify", {
      p_user: id,
      p_kind: kind,
      p_actor: m.actorId ?? null,
      p_title: m.title,
      p_body: m.body ?? null,
      p_href: m.href,
      p_task: m.taskId ?? null,
    });
    if (error) console.error("[notify]", error.message);
  }
}

/** Notify after the response is sent; a failure is logged, never shown. */
export function notifyLater(userIds: (string | null | undefined)[], kind: NotifyKind, m: NotifyMessage) {
  after(async () => {
    try {
      await notify(userIds, kind, m);
      await flushPush();
    } catch (e) {
      console.error(`[notify:${kind}]`, e);
    }
  });
}

export function notifyTeamLater(role: PlacementRole, kind: NotifyKind, m: NotifyMessage) {
  after(async () => {
    try {
      await notify(await teamMembers(role), kind, m);
      await flushPush();
    } catch (e) {
      console.error(`[notify:${role}]`, e);
    }
  });
}

export const notifyPersonLater = (userId: string | null | undefined, kind: NotifyKind, m: NotifyMessage) => notifyLater([userId], kind, m);

/** Paths inside the app; links in Claude's answers use the full URL. */
export const placementsPath = (id?: string) => `/placements?tab=web${id ? `&open=${id}` : ""}`;
export const requestPath = (channel: string, id: string) => `/placements?tab=${channel}&open=${id}`;
export const placementsUrl = (id?: string) => `${siteUrl()}${placementsPath(id)}`;
export const requestUrl = (channel: string, id: string) => `${siteUrl()}${requestPath(channel, id)}`;
