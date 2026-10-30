import "server-only";
import { after } from "next/server";
import { siteUrl } from "@/lib/calendar/sync";
import { personName } from "@/lib/labels";
import { emailHtml, isEmailConfigured, sendEmail } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/time";

/** Email the people tagged in a meeting comment, with a link straight to it. */
export function emailMeetingMentions(meetingId: string, userIds: string[], byId: string, body: string) {
  if (!userIds.length || !isEmailConfigured()) return;
  after(async () => {
    try {
      const db = createAdminClient();
      const [{ data: meeting }, { data: people }] = await Promise.all([
        db.from("meetings").select("title, meeting_date").eq("id", meetingId).maybeSingle(),
        db.from("profiles").select("id, email, full_name, status").in("id", [...userIds, byId]),
      ]);
      if (!meeting) return;
      const by = personName((people ?? []).find((p) => p.id === byId) ?? null);
      const name = `${meeting.title || "Meeting"} · ${formatDate(meeting.meeting_date as string, "d MMM")}`;
      const to = (people ?? []).filter((p) => p.id !== byId && userIds.includes(p.id as string) && p.status === "active").map((p) => p.email as string);
      if (!to.length) return;
      await sendEmail(
        to,
        `${by} mentioned you in ${name}`,
        emailHtml({
          intro: `${by} mentioned you in the comments on ${name}:`,
          rows: [["", body.length > 400 ? `${body.slice(0, 400)}…` : body]],
          link: `${siteUrl()}/meetings/${meetingId}?tab=comments`,
          linkLabel: "Open the meeting",
        }),
      );
    } catch (e) {
      console.error("[email:meeting-mention]", e);
    }
  });
}
