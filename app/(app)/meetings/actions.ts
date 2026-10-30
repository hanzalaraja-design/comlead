"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { isBlankHtml, sanitizeRichText } from "@/lib/sanitize";
import { syncLater } from "@/lib/calendar/schedule";
import { syncTasksForMeeting } from "@/lib/calendar/sync";
import { emailMeetingMentions } from "@/lib/meetings/mentions";

const uuid = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/)
  .nullable();
const priority = z.enum(["urgent", "high", "medium", "low"]);

const actionItem = z.object({
  title: z.string().trim().min(1).max(300),
  owner_id: uuid.nullable(),
  due_date: dateStr.nullable(),
  priority,
});

const saveSchema = z.object({
  title: z.string().trim().max(200).nullable(),
  meeting_date: dateStr,
  meeting_time: timeStr,
  attendees: z.array(uuid).max(200),
  agenda: z.string().max(20_000).nullable(),
  minutes: z.string().max(200_000).nullable(),
  existingItems: z.array(actionItem.extend({ id: uuid })).max(200),
  // New items can go to several people: one task each, linked as a set.
  newItems: z.array(actionItem.omit({ owner_id: true }).extend({ owner_ids: z.array(uuid).max(50) })).max(100),
});

export type SaveMeetingInput = z.input<typeof saveSchema>;

/**
 * Save minutes. New action items become real tasks (Source = Meeting),
 * linked to this meeting; edits to existing action items update their tasks.
 */
export async function saveMeeting(meetingId: string, input: SaveMeetingInput): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (!uuid.safeParse(meetingId).success) return { ok: false, error: "Invalid meeting" };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.path.includes("title") && issue.path.length > 1 ? "Every action item needs some text." : "Some values aren't valid." };
  }
  const v = parsed.data;
  const supabase = await createClient();

  const { data: meeting } = await supabase.from("meetings").select("id, department_id").eq("id", meetingId).maybeSingle();
  if (!meeting) return { ok: false, error: "Meeting not found" };

  const { data: updated, error } = await supabase
    .from("meetings")
    .update({
      title: v.title || null,
      meeting_date: v.meeting_date,
      meeting_time: v.meeting_time,
      agenda: v.agenda?.trim() || null,
      minutes: isBlankHtml(v.minutes) ? null : sanitizeRichText(v.minutes),
    })
    .eq("id", meetingId)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!updated?.length) return { ok: false, error: "Only people in this meeting or its department admin can edit the minutes." };

  // Attendees
  const { data: current } = await supabase.from("meeting_attendees").select("user_id").eq("meeting_id", meetingId);
  const have = new Set((current ?? []).map((a) => a.user_id as string));
  const want = new Set(v.attendees);
  const add = [...want].filter((u) => !have.has(u));
  const remove = [...have].filter((u) => !want.has(u));
  if (add.length) {
    const { error: e } = await supabase.from("meeting_attendees").insert(add.map((user_id) => ({ meeting_id: meetingId, user_id })));
    if (e) return { ok: false, error: friendlyError(e) };
  }

  // Existing action items: only send changed fields so the log stays clean.
  if (v.existingItems.length) {
    const { data: rows } = await supabase
      .from("tasks")
      .select("id, title, owner_id, due_date, priority")
      .eq("meeting_id", meetingId)
      .in(
        "id",
        v.existingItems.map((i) => i.id),
      );
    const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));
    for (const item of v.existingItems) {
      const row = byId.get(item.id);
      if (!row) continue;
      const patch: Record<string, unknown> = {};
      if (row.title !== item.title) patch.title = item.title;
      if (row.owner_id !== item.owner_id) patch.owner_id = item.owner_id;
      if (row.due_date !== item.due_date) patch.due_date = item.due_date;
      if (row.priority !== item.priority) patch.priority = item.priority;
      if (Object.keys(patch).length) {
        const { error: e } = await supabase.from("tasks").update(patch).eq("id", item.id);
        if (e) return { ok: false, error: friendlyError(e) };
      }
    }
  }

  if (v.newItems.length) {
    const { error: e } = await supabase.from("tasks").insert(
      v.newItems.flatMap((item) => {
        const owners = item.owner_ids.length ? [...new Set(item.owner_ids)] : [null];
        const set_id = owners.length > 1 ? crypto.randomUUID() : null;
        return owners.map((owner_id) => ({
          title: item.title,
          owner_id,
          due_date: item.due_date,
          priority: item.priority,
          department_id: meeting.department_id,
          meeting_id: meetingId,
          source: "meeting",
          created_by: viewer.id,
          set_id,
        }));
      }),
    );
    if (e) return { ok: false, error: friendlyError(e) };
  }

  // Removals last: whoever is saving may be removing themselves, and attendees
  // are the people allowed to edit the meeting.
  if (remove.length) {
    const { error: e } = await supabase.from("meeting_attendees").delete().eq("meeting_id", meetingId).in("user_id", remove);
    if (e) return { ok: false, error: friendlyError(e) };
  }

  revalidatePath("/", "layout");
  syncLater(() => syncTasksForMeeting(meetingId));
  return { ok: true };
}

export async function deleteMeeting(meetingId: string): Promise<ActionResult> {
  await requireViewer();
  const supabase = await createClient();
  const { data, error } = await supabase.from("meetings").delete().eq("id", meetingId).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only whoever set up this meeting, or the team admin, can delete it." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Link a meeting to projects, campaigns and partnerships (exactly these). */
export async function setMeetingProjects(meetingId: string, projectIds: string[]): Promise<ActionResult> {
  await requireViewer();
  const ids = z.array(z.string().uuid()).max(20).safeParse(projectIds);
  if (!z.string().uuid().safeParse(meetingId).success || !ids.success) return { ok: false, error: "That change isn't valid." };
  const supabase = await createClient();
  const { data: current, error: readErr } = await supabase.from("meeting_projects").select("project_id").eq("meeting_id", meetingId);
  if (readErr) return { ok: false, error: friendlyError(readErr) };
  const have = new Set((current ?? []).map((r) => r.project_id as string));
  const want = new Set(ids.data);
  const add = [...want].filter((p) => !have.has(p));
  const remove = [...have].filter((p) => !want.has(p));
  if (add.length) {
    const { error } = await supabase.from("meeting_projects").insert(add.map((project_id) => ({ meeting_id: meetingId, project_id })));
    if (error) return { ok: false, error: friendlyError(error) };
  }
  if (remove.length) {
    const { error } = await supabase.from("meeting_projects").delete().eq("meeting_id", meetingId).in("project_id", remove);
    if (error) return { ok: false, error: friendlyError(error) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** A comment on a meeting; tagged people get it in their inbox and by email. */
export async function addMeetingComment(meetingId: string, body: string, mentionIds: string[] = []): Promise<ActionResult> {
  const viewer = await requireViewer();
  const text = body.trim();
  if (!uuid.safeParse(meetingId).success || !text) return { ok: false, error: "Write a comment first." };
  if (text.length > 10_000) return { ok: false, error: "Comment is too long." };
  const mentions = [...new Set(mentionIds)].filter((m) => uuid.safeParse(m).success && m !== viewer.id).slice(0, 20);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meeting_comments")
    .insert({ meeting_id: meetingId, author_id: viewer.id, body: text })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: friendlyError(error) };
  if (mentions.length) {
    const { error: mErr } = await supabase.rpc("add_meeting_mentions", { p_comment_id: data.id, p_user_ids: mentions });
    if (mErr) return { ok: false, error: friendlyError(mErr) };
    emailMeetingMentions(meetingId, mentions, viewer.id, text);
  }
  revalidatePath(`/meetings/${meetingId}`);
  if (mentions.length) revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteMeetingComment(commentId: string, meetingId: string): Promise<ActionResult> {
  await requireViewer();
  const supabase = await createClient();
  const { data, error } = await supabase.from("meeting_comments").delete().eq("id", commentId).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "You can only delete your own comments." };
  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true };
}
