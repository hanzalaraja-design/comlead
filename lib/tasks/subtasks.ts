import "server-only";
import { after } from "next/server";
import { siteUrl } from "@/lib/calendar/sync";
import { personName } from "@/lib/labels";
import { emailHtml, isEmailConfigured, sendEmail } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/time";

type Person = { email: string; full_name: string | null; status: string };

async function people(ids: string[]): Promise<Map<string, Person>> {
  const { data } = await createAdminClient().from("profiles").select("id, email, full_name, status").in("id", ids);
  return new Map((data ?? []).map((p) => [p.id as string, p as Person]));
}

function later(label: string, work: () => Promise<void>) {
  if (!isEmailConfigured()) return;
  after(async () => {
    try {
      await work();
    } catch (e) {
      console.error(`[email:${label}]`, e);
    }
  });
}

/** Tell someone a subtask was given to them. */
export function emailSubtaskGiven(s: { id: string; title: string; due_date: string | null; owner_id: string }, parentTitle: string, byId: string) {
  if (s.owner_id === byId) return;
  later("subtask-given", async () => {
    const p = await people([s.owner_id, byId]);
    const to = p.get(s.owner_id);
    if (!to || to.status !== "active") return;
    const by = personName(p.get(byId) ?? null);
    await sendEmail(
      [to.email],
      `${by} needs something from you: ${s.title}`,
      emailHtml({
        intro: `${by} needs this from you for “${parentTitle}”.`,
        rows: [
          ["What", s.title],
          ["By", s.due_date ? formatDate(s.due_date, "EEE d MMM") : "No date set"],
        ],
        link: `${siteUrl()}/tasks/${s.id}`,
        linkLabel: "Open it",
      }),
    );
  });
}

/** Tell the main task's owner a subtask is done. */
export function emailSubtaskDone(s: { title: string; parent_task_id: string }, byId: string) {
  later("subtask-done", async () => {
    const db = createAdminClient();
    const [{ data: parent }, { data: open }] = await Promise.all([
      db.from("tasks").select("id, title, owner_id").eq("id", s.parent_task_id).maybeSingle(),
      db.from("tasks").select("id").eq("parent_task_id", s.parent_task_id).is("deleted_at", null).in("status", ["todo", "in_progress", "blocked"]),
    ]);
    if (!parent?.owner_id || parent.owner_id === byId) return;
    const p = await people([parent.owner_id as string, byId]);
    const to = p.get(parent.owner_id as string);
    if (!to || to.status !== "active") return;
    const by = personName(p.get(byId) ?? null);
    const left = open?.length ?? 0;
    await sendEmail(
      [to.email],
      `${by} finished: ${s.title}`,
      emailHtml({
        intro: `${by} finished their part of “${parent.title}”. ${left ? `${left} still open.` : "Everything you were waiting on is in."}`,
        rows: [["Done", s.title]],
        link: `${siteUrl()}/tasks/${parent.id}`,
        linkLabel: "Open the task",
      }),
    );
  });
}
