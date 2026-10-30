import "server-only";
import { after } from "next/server";
import { siteUrl } from "@/lib/calendar/sync";
import { personName } from "@/lib/labels";
import { emailHtml, isEmailConfigured, sendEmail } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";

/** Email the people tagged in a task comment, with a link straight to it. */
export function emailCommentMentions(taskId: string, userIds: string[], byId: string, body: string) {
  if (!userIds.length || !isEmailConfigured()) return;
  after(async () => {
    try {
      const db = createAdminClient();
      const [{ data: task }, { data: people }] = await Promise.all([
        db.from("tasks").select("title").eq("id", taskId).maybeSingle(),
        db.from("profiles").select("id, email, full_name, status").in("id", [...userIds, byId]),
      ]);
      if (!task) return;
      const by = personName((people ?? []).find((p) => p.id === byId) ?? null);
      const to = (people ?? []).filter((p) => p.id !== byId && userIds.includes(p.id as string) && p.status === "active").map((p) => p.email as string);
      if (!to.length) return;
      await sendEmail(
        to,
        `${by} mentioned you: ${task.title}`,
        emailHtml({
          intro: `${by} mentioned you in a comment on “${task.title}”:`,
          rows: [["", body.length > 400 ? `${body.slice(0, 400)}…` : body]],
          link: `${siteUrl()}/tasks/${taskId}#comments`,
          linkLabel: "Open the comment",
        }),
      );
    } catch (e) {
      console.error("[email:comment-mention]", e);
    }
  });
}
