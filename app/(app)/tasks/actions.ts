"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { isBlankHtml, sanitizeRichText } from "@/lib/sanitize";
import { syncLater } from "@/lib/calendar/schedule";
import { syncTask } from "@/lib/calendar/sync";
import { addDaysISO, parseISODate, todayPKT } from "@/lib/time";
import { personName } from "@/lib/labels";

const uuid = z.string().uuid();
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(uuid.nullable());

const taskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  description: z.string().max(100_000).optional(),
  // "private" (or empty) = a private task: no team, only its owner sees it.
  department_id: z
    .string()
    .transform((v) => (v && v !== "private" ? v : null))
    .pipe(uuid.nullable()),
  owner_id: optionalUuid,
  status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]),
  priority: z.enum(["urgent", "high", "medium", "low"]),
  due_date: z
    .string()
    .optional()
    .transform((v) => v || null)
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()),
  due_time: z
    .string()
    .optional()
    .transform((v) => v || null)
    .pipe(z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable()),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20),
    ),
  blocked_reason: z.string().trim().max(1000).optional(),
  meeting_id: optionalUuid,
  collaborators: z.array(uuid).max(50),
});

function readTaskForm(formData: FormData) {
  return taskSchema.safeParse({
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? undefined,
    department_id: formData.get("department_id") ?? "",
    owner_id: formData.get("owner_id") ?? undefined,
    status: formData.get("status") ?? "todo",
    priority: formData.get("priority") ?? "medium",
    due_date: formData.get("due_date") ?? undefined,
    due_time: formData.get("due_time") ?? undefined,
    tags: formData.get("tags") ?? undefined,
    blocked_reason: formData.get("blocked_reason") ?? undefined,
    meeting_id: formData.get("meeting_id") ?? undefined,
    collaborators: formData.getAll("collaborators").map(String).filter(Boolean),
  });
}

/** Private tasks always belong to whoever saves them and never sit in a meeting. */
function shape<T extends { department_id: string | null; owner_id: string | null; meeting_id: string | null }>(v: T, viewerId: string): T {
  return v.department_id ? v : { ...v, owner_id: viewerId, meeting_id: null };
}

function revalidateTaskViews(taskId?: string) {
  revalidatePath("/", "layout");
  if (taskId) revalidatePath(`/tasks/${taskId}`);
}

export async function createTask(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const viewer = await requireViewer();
  const parsed = readTaskForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid task" };
  const v = shape(parsed.data, viewer.id);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: v.title,
      description: isBlankHtml(v.description) ? null : sanitizeRichText(v.description),
      department_id: v.department_id,
      owner_id: v.owner_id,
      status: v.status,
      priority: v.priority,
      due_date: v.due_date,
      due_time: v.due_date ? v.due_time : null,
      tags: v.tags,
      blocked_reason: v.status === "blocked" ? v.blocked_reason || null : null,
      meeting_id: v.meeting_id,
      created_by: viewer.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendlyError(error) };

  const collaborators = v.collaborators.filter((c) => c !== v.owner_id);
  if (collaborators.length) {
    const { error: cErr } = await supabase
      .from("task_collaborators")
      .insert(collaborators.map((user_id) => ({ task_id: data.id, user_id })));
    if (cErr) return { ok: false, error: friendlyError(cErr) };
  }

  revalidateTaskViews(data.id);
  syncLater(() => syncTask(data.id));
  return { ok: true, data: { id: data.id } };
}

export async function updateTask(taskId: string, formData: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (!uuid.safeParse(taskId).success) return { ok: false, error: "Invalid task" };
  const parsed = readTaskForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid task" };
  const v = shape(parsed.data, viewer.id);

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("tasks")
    .update({
      title: v.title,
      description: isBlankHtml(v.description) ? null : sanitizeRichText(v.description),
      department_id: v.department_id,
      owner_id: v.owner_id,
      status: v.status,
      priority: v.priority,
      due_date: v.due_date,
      due_time: v.due_date ? v.due_time : null,
      tags: v.tags,
      blocked_reason: v.status === "blocked" ? v.blocked_reason || null : null,
    })
    .eq("id", taskId)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!updated?.length) return { ok: false, error: "You don't have permission to edit this task." };

  // Sync collaborators.
  const { data: current } = await supabase.from("task_collaborators").select("user_id").eq("task_id", taskId);
  const have = new Set((current ?? []).map((c) => c.user_id as string));
  const want = new Set(v.collaborators.filter((c) => c !== v.owner_id));
  const toAdd = [...want].filter((u) => !have.has(u));
  const toRemove = [...have].filter((u) => !want.has(u));
  if (toAdd.length) {
    const { error: e } = await supabase
      .from("task_collaborators")
      .insert(toAdd.map((user_id) => ({ task_id: taskId, user_id })));
    if (e) return { ok: false, error: friendlyError(e) };
  }
  if (toRemove.length) {
    const { error: e } = await supabase
      .from("task_collaborators")
      .delete()
      .eq("task_id", taskId)
      .in("user_id", toRemove);
    if (e) return { ok: false, error: friendlyError(e) };
  }

  revalidateTaskViews(taskId);
  syncLater(() => syncTask(taskId));
  return { ok: true };
}

const statusSchema = z.object({
  taskId: uuid,
  status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]),
  blockedReason: z.string().trim().max(1000).optional(),
});

/**
 * Quick add: a title and Enter. A few words at the end set details:
 * "today" / "tomorrow" / "fri" for the due date, "!" for high or "!!" for urgent.
 * The task is assigned to whoever adds it. No team = a private task only they see.
 */
export async function quickAddTask(
  input: string,
  departmentId: string | null,
): Promise<ActionResult<{ id: string; owner: string | null }>> {
  const viewer = await requireViewer();
  let title = input.trim().replace(/\s+/g, " ");
  const dept = departmentId || null;
  if (dept && !uuid.safeParse(dept).success) return { ok: false, error: "Pick a team for this task." };

  let priority: "urgent" | "high" | "medium" = "medium";
  const bang = /\s*(!{1,2})$/.exec(title);
  if (bang) {
    priority = bang[1].length === 2 ? "urgent" : "high";
    title = title.slice(0, bang.index).trim();
  }
  let due: string | null = null;
  const today = todayPKT();
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const word = /\s+(today|tomorrow|tmrw|mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?$/i.exec(title);
  if (word) {
    const w = word[1].toLowerCase();
    if (w === "today") due = today;
    else if (w === "tomorrow" || w === "tmrw") due = addDaysISO(today, 1);
    else {
      const now = parseISODate(today).getDay();
      due = addDaysISO(today, ((days.indexOf(w) - now + 7) % 7) || 7);
    }
    title = title.slice(0, word.index).trim();
  }
  if (!title) return { ok: false, error: "Type what needs doing first." };
  if (title.length > 300) return { ok: false, error: "That's a bit long for a title." };

  const supabase = await createClient();
  // Private tasks are yours. Team tasks go to the team's admin (the one who joined first)
  // to hand out; if you're one of its admins, to you; with no admin, unassigned.
  let owner: string | null = viewer.id;
  let ownerName: string | null = null;
  if (dept && !viewer.leadDeptIds.includes(dept)) {
    const { data: lead } = await supabase
      .from("department_members")
      .select("user_id, profile:profiles(full_name, email)")
      .eq("department_id", dept)
      .eq("role", "lead")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    owner = (lead?.user_id as string | undefined) ?? null;
    const p = lead?.profile as unknown as { full_name: string | null; email: string } | null;
    ownerName = p ? personName(p) : null;
  }
  const { data, error } = await supabase
    .from("tasks")
    .insert({ title, department_id: dept, owner_id: owner, priority, due_date: due, created_by: viewer.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: friendlyError(error) };
  revalidateTaskViews(data.id);
  syncLater(() => syncTask(data.id));
  return { ok: true, data: { id: data.id as string, owner: owner === viewer.id ? "you" : ownerName } };
}

export async function setTaskStatus(
  taskId: string,
  status: string,
  blockedReason?: string,
): Promise<ActionResult> {
  await requireViewer();
  const parsed = statusSchema.safeParse({ taskId, status, blockedReason });
  if (!parsed.success) return { ok: false, error: "Invalid status" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({
      status: parsed.data.status,
      ...(parsed.data.status === "blocked" ? { blocked_reason: parsed.data.blockedReason || null } : {}),
    })
    .eq("id", parsed.data.taskId)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "You can only update tasks you own, collaborate on or created." };

  revalidateTaskViews(taskId);
  syncLater(() => syncTask(taskId));
  return { ok: true };
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(taskId).success) return { ok: false, error: "Invalid task" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_task", { p_task_id: taskId });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidateTaskViews(taskId);
  syncLater(() => syncTask(taskId));
  return { ok: true };
}

export async function addComment(taskId: string, body: string, mentionIds: string[] = []): Promise<ActionResult> {
  const viewer = await requireViewer();
  const text = body.trim();
  if (!uuid.safeParse(taskId).success || !text) return { ok: false, error: "Write a comment first." };
  if (text.length > 10_000) return { ok: false, error: "Comment is too long." };
  const mentions = [...new Set(mentionIds)].filter((m) => uuid.safeParse(m).success && m !== viewer.id).slice(0, 20);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_comments")
    .insert({ task_id: taskId, author_id: viewer.id, body: text })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: friendlyError(error) };
  if (mentions.length) {
    // Tagged people become collaborators, so they can open the task, and get it in their inbox.
    const { error: mErr } = await supabase.rpc("add_comment_mentions", { p_comment_id: data.id, p_user_ids: mentions });
    if (mErr) return { ok: false, error: friendlyError(mErr) };
  }
  revalidatePath(`/tasks/${taskId}`);
  if (mentions.length) revalidatePath("/my");
  return { ok: true };
}

export async function deleteComment(commentId: string, taskId: string): Promise<ActionResult> {
  await requireViewer();
  const supabase = await createClient();
  const { data, error } = await supabase.from("task_comments").delete().eq("id", commentId).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "You can only delete your own comments." };
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

/** Called after the browser has uploaded the file to Storage. */
export async function recordAttachment(input: {
  taskId: string;
  path: string;
  fileName: string;
  size: number;
  mimeType: string;
}): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (!uuid.safeParse(input.taskId).success || !input.path.startsWith(`${input.taskId}/`)) {
    return { ok: false, error: "Invalid attachment" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("task_attachments").insert({
    task_id: input.taskId,
    storage_path: input.path,
    file_name: input.fileName.slice(0, 255),
    size_bytes: input.size,
    mime_type: input.mimeType.slice(0, 255) || null,
    uploaded_by: viewer.id,
  });
  if (error) {
    await supabase.storage.from("task-attachments").remove([input.path]);
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/tasks/${input.taskId}`);
  return { ok: true };
}

export async function deleteAttachment(attachmentId: string, taskId: string): Promise<ActionResult> {
  await requireViewer();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_attachments")
    .delete()
    .eq("id", attachmentId)
    .select("storage_path");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "You can't delete this file." };
  await supabase.storage.from("task-attachments").remove(data.map((d) => d.storage_path as string));
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

export async function getAttachmentUrl(path: string): Promise<ActionResult<{ url: string }>> {
  await requireViewer();
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("task-attachments").createSignedUrl(path, 60, { download: true });
  if (error || !data) return { ok: false, error: "Couldn't open that file." };
  return { ok: true, data: { url: data.signedUrl } };
}

export async function saveView(name: string, path: string): Promise<ActionResult> {
  const viewer = await requireViewer();
  const n = name.trim();
  if (!n || n.length > 80) return { ok: false, error: "Give the view a short name." };
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 2000) return { ok: false, error: "Invalid view" };
  const supabase = await createClient();
  const { error } = await supabase.from("saved_views").insert({ user_id: viewer.id, name: n, path });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteView(id: string): Promise<ActionResult> {
  await requireViewer();
  const supabase = await createClient();
  const { error } = await supabase.from("saved_views").delete().eq("id", id);
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}
