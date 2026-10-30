import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calendarMailbox, graph, isCalendarConfigured, userPath } from "@/lib/calendar/graph";
import { siteUrl } from "@/lib/calendar/sync";
import type { PlacementRole } from "@/lib/placements";

/**
 * Email from the Highfy Tasks mailbox (the same one that sends Outlook
 * invites). Needs the Mail.Send application permission as well as
 * Calendars.ReadWrite. Without Outlook set up, nothing is sent.
 */

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const isEmailConfigured = isCalendarConfigured;

export async function sendEmail(to: string[], subject: string, html: string): Promise<void> {
  if (!to.length) return;
  await graph("POST", `${userPath(calendarMailbox())}/sendMail`, {
    message: {
      subject,
      body: { contentType: "HTML", content: html },
      toRecipients: to.map((address) => ({ emailAddress: { address } })),
    },
    saveToSentItems: false,
  });
}

/** Active members of the team that does this job. */
export async function teamEmails(role: PlacementRole): Promise<string[]> {
  const db = createAdminClient();
  const { data: settings } = await db.from("placement_settings").select("*").eq("id", 1).maybeSingle();
  const deptId = settings?.[`${role}_department_id`] as string | null | undefined;
  if (!deptId) return [];
  const { data } = await db.from("department_members").select("profiles!inner(email, status)").eq("department_id", deptId);
  return ((data ?? []) as unknown as { profiles: { email: string; status: string } }[])
    .filter((r) => r.profiles.status === "active")
    .map((r) => r.profiles.email);
}

/** A short email in the house style: a line, some details, a button. */
export function emailHtml({ intro, rows, link, linkLabel }: { intro: string; rows?: [string, string][]; link: string; linkLabel: string }) {
  const table = rows?.length
    ? `<table style="border-collapse:collapse;margin:12px 0">${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 16px 4px 0;color:#6b6475;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0;color:#1f1a24">${escapeHtml(v)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f1a24">
<p>${escapeHtml(intro)}</p>${table}
<p><a href="${link}" style="display:inline-block;background:#7e1a8f;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px">${escapeHtml(linkLabel)}</a></p>
<p style="color:#6b6475;font-size:13px">Sent by Highfy Tasks.</p></div>`;
}

export const placementsUrl = (id?: string) => `${siteUrl()}/placements?tab=web${id ? `&open=${id}` : ""}`;

/** Email a team after the response is sent; a failure is logged, never shown. */
export function emailTeamLater(role: PlacementRole, subject: string, html: string) {
  if (!isEmailConfigured()) return;
  after(async () => {
    try {
      await sendEmail(await teamEmails(role), subject, html);
    } catch (e) {
      console.error(`[email:${role}]`, e);
    }
  });
}

/** Email one person (by profile id) after the response is sent. */
export function emailPersonLater(userId: string | null | undefined, subject: string, html: string) {
  if (!userId || !isEmailConfigured()) return;
  after(async () => {
    try {
      const { data } = await createAdminClient().from("profiles").select("email, status").eq("id", userId).maybeSingle();
      if (data?.status === "active") await sendEmail([data.email as string], subject, html);
    } catch (e) {
      console.error("[email:person]", e);
    }
  });
}

export const requestUrl = (channel: string, id: string) => `${siteUrl()}/placements?tab=${channel}&open=${id}`;
