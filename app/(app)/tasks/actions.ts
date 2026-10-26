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
import { emailSubtaskDone, emailSubtaskGiven } from "@/lib/tasks/subtasks";
import { OPEN_SUBTASKS } from "@/lib/tasks/open-subtasks";

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
  // New team tasks only: one copy for each person, linked as a set.
  owner_ids: z.array(uuid).max(50),
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
  project_id: optionalUuid,
  collaborators: z.array(uuid).max(50),
});

function readTaskForm(formData: FormData) {
  return taskSchema.safeParse({
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? undefined,
    department_id: formData.get("department_id") ?? "",
    owner_id: formData.get("owner_id") ?? undefined,
    owner_ids: formData.getAll("owner_ids").map(String).filter(Boolean),
    status: formData.get("status") ?? "todo",
    priority: formData.get("priority") ?? "medium",
    due_date: formData.get("due_date") ?? undefined,
    due_time: formData.get("due_time") ?? undefined,
    tags: formData.get("tags") ?? undefined,
    blocked_reason: formData.get("blocked_reason") ?? undefined,
    meeting_id: formData.get("meeting_id") ?? undefined,
    project_id: formData.get("project_id") ?? undefined,
    collaborators: formData.getAll("collaborators").map(String).filter(Boolean),
  });
}

/** Only team tasks sit in a meeting; a subtask stays with its main task, outside any team or project. */
function shape<T extends { department_id: string | null; project_id: string | null; meeting_id: string | null }>(v: T, isSubtask = false): T {
  if (v.department_id) return v;
  if (isSubtask) return { ...v, department_id: null, project_id: null, meeting_id: null };
  // No team: yours (private) or someone else's (a direct task from you).
  return { ...v, meeting_id: null };
}

function revalidateTaskViews(taskId?: string) {
  revalidatePath("/", "layout");
  if (taskId) revalidatePath(`/tasks/${taskId}`);
}

export async function createTask(formData: FormData): Promise<ActionResult<{ id: string; count: number }>> {
  const viewer = await requireViewer();
  const parsed = readTaskForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid task" };
  const v = shape(parsed.data);
  // Several owners: everyone gets their own task, so each can tick it off.
  const owners = v.owner_ids.length ? [...new Set(v.owner_ids)] : [v.owner_id];
  const setId = owners.length > 1 ? crypto.randomUUID() : null;

  const supabase = await createClient();
  const row = {
    title: v.title,
    description: isBlankHtml(v.description) ? null : sanitizeRichText(v.description),
    department_id: v.department_id,
    status: v.status,
    priority: v.priority,
    due_date: v.due_date,
    due_time: v.due_date ? v.due_time : null,
    tags: v.tags,
    blocked_reason: v.status === "blocked" ? v.blocked_reason || null : null,
    meeting_id: v.meeting_id,
    project_id: v.project_id,
    created_by: viewer.id,
    set_id: setId,
  };
  const { data, error } = await supabase
    .from("tasks")
    .insert(owners.map((owner_id) => ({ ...row, owner_id })))
    .select("id, owner_id");
  if (error || !data?.length) return { ok: false, error: friendlyError(error) };

  const links = data.flatMap((t) =>
    v.collaborators.filter((c) => c !== t.owner_id).map((user_id) => ({ task_id: t.id as string, user_id })),
  );
  if (links.length) {
    const { error: cErr } = await supabase.from("task_collaborators").insert(links);
    if (cErr) return { ok: false, error: friendlyError(cErr) };
  }

  // "Needed from others", added while creating: only for a single task.
  if (data.length === 1) {
    const subs = readSubtaskRows(formData);
    if (subs.length) {
      const { data: made, error: sErr } = await supabase
        .from("tasks")
        .insert(subs.map((s) => ({ ...s, parent_task_id: data[0].id, created_by: viewer.id })))
        .select("id, title, due_date, owner_id");
      if (sErr) return { ok: false, error: `The task was created, but its subtasks weren't: ${friendlyError(sErr)}` };
      for (const s of made ?? []) {
        emailSubtaskGiven(s as { id: string; title: string; due_date: string | null; owner_id: string }, v.title, viewer.id);
        syncLater(() => syncTask(s.id as string));
      }
    }
  }

  revalidateTaskViews(data[0].id as string);
  for (const t of data) syncLater(() => syncTask(t.id as string));
  return { ok: true, data: { id: data[0].id as string, count: data.length } };
}

export async function updateTask(taskId: string, formData: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (!uuid.safeParse(taskId).success) return { ok: false, error: "Invalid task" };
  const parsed = readTaskForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid task" };
  const v = shape(parsed.data, formData.get("subtask") === "1");

  const supabase = await createClient();
  const before = await closingWithOpenSubtasks(supabase, taskId, v.status, formData.get("subtasks"));
  if (before) return before;
  const { data: updated, error } = await supabase
    .from("tasks")
    .update({
      title: v.title,
      description: isBlankHtml(v.description) ? null : sanitizeRichText(v.description),
      department_id: v.department_id,
      project_id: v.project_id,
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

  if (v.status === "done") await afterDone(supabase, taskId, formData.get("subtasks"), viewer.id);
  revalidateTaskViews(taskId);
  syncLater(() => syncTask(taskId));
  return { ok: true };
}

/**
 * Marking a main task done while its subtasks are open: ask first. The client
 * asks and calls again with "close" (close them too) or "keep".
 */
async function closingWithOpenSubtasks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: string,
  status: string,
  choice: unknown,
): Promise<{ ok: false; error: string } | null> {
  if (status !== "done" || choice === "close" || choice === "keep") return null;
  const { data: current } = await supabase.from("tasks").select("status").eq("id", taskId).maybeSingle();
  if (current?.status === "done") return null;
  const { count } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("parent_task_id", taskId)
    .in("status", ["todo", "in_progress", "blocked"]);
  return count ? { ok: false, error: `${OPEN_SUBTASKS}${count}` } : null;
}

/** After a task is done: close its subtasks if asked; tell the main task's owner if it was a subtask. */
async function afterDone(supabase: Awaited<ReturnType<typeof createClient>>, taskId: string, choice: unknown, viewerId: string) {
  if (choice === "close") {
    const { data: closed } = await supabase
      .from("tasks")
      .update({ status: "done" })
      .eq("parent_task_id", taskId)
      .in("status", ["todo", "in_progress", "blocked"])
      .select("id");
    for (const s of closed ?? []) syncLater(() => syncTask(s.id as string));
  }
  const { data: t } = await supabase.from("tasks").select("title, parent_task_id").eq("id", taskId).maybeSingle();
  if (t?.parent_task_id) emailSubtaskDone(t as { title: string; parent_task_id: string }, viewerId);
}

/** "Needed from others" rows from the new task form. */
function readSubtaskRows(formData: FormData) {
  const titles = formData.getAll("subtask_title").map(String);
  const owners = formData.getAll("subtask_owner").map(String);
  const dues = formData.getAll("subtask_due").map(String);
  return titles
    .map((title, i) => ({ title: title.trim().slice(0, 300), owner_id: owners[i] || null, due_date: dues[i] || null }))
    .filter((s) => s.title && s.owner_id && uuid.safeParse(s.owner_id).success && (!s.due_date || /^\d{4}-\d{2}-\d{2}$/.test(s.due_date)))
    .slice(0, 20);
}

const subtaskSchema = z.object({
  parentId: uuid,
  title: z.string().trim().min(1, "Say what's needed").max(300),
  owner_id: uuid,
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

/** Give part of a task to someone, from any team, with their own deadline. */
export async function addSubtask(
  parentId: string,
  input: { title: string; owner_id: string; due_date: string | null },
): Promise<ActionResult<{ id: string }>> {
  const viewer = await requireViewer();
  const parsed = subtaskSchema.safeParse({ parentId, ...input });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details" };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: parent } = await supabase.from("tasks").select("title, parent_task_id").eq("id", v.parentId).maybeSingle();
  if (!parent) return { ok: false, error: "That task wasn't found." };
  if (parent.parent_task_id) return { ok: false, error: "A subtask can't have subtasks of its own." };

  const { data, error } = await supabase
    .from("tasks")
    .insert({ title: v.title, owner_id: v.owner_id, due_date: v.due_date, parent_task_id: v.parentId, created_by: viewer.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: friendlyError(error) };

  emailSubtaskGiven({ id: data.id as string, title: v.title, due_date: v.due_date, owner_id: v.owner_id }, parent.title as string, viewer.id);
  revalidateTaskViews(v.parentId);
  syncLater(() => syncTask(data.id as string));
  return { ok: true, data: { id: data.id as string } };
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
  projectId?: string,
): Promise<ActionResult<{ id: string; owner: string | null }>> {
  const viewer = await requireViewer();
  let title = input.trim().replace(/\s+/g, " ");
  const dept = departmentId || null;
  if (dept && !uuid.safeParse(dept).success) return { ok: false, error: "Pick a team for this task." };
  const project = projectId || null;
  if (project && !uuid.safeParse(project).success) return { ok: false, error: "That project wasn't found." };

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
  // In a project, what you add is yours.
  if (dept && !project && !viewer.leadDeptIds.includes(dept)) {
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
    .insert({ title, department_id: dept, project_id: project, owner_id: owner, priority, due_date: due, created_by: viewer.id })
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
  /** When it has open subtasks: close them too, or keep them open. */
  subtasks?: "close" | "keep",
): Promise<ActionResult> {
  const viewer = await requireViewer();
  const parsed = statusSchema.safeParse({ taskId, status, blockedReason });
  if (!parsed.success) return { ok: false, error: "Invalid status" };

  const supabase = await createClient();
  const ask = await closingWithOpenSubtasks(supabase, parsed.data.taskId, parsed.data.status, subtasks);
  if (ask) return ask;
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

  if (parsed.data.status === "done") await afterDone(supabase, parsed.data.taskId, subtasks, viewer.id);
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

const inlineSchema = z.object({
  taskId: uuid,
  owner_id: uuid.nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
});

/** One field changed straight from a list: owner, due date or priority. */
export async function updateTaskInline(
  taskId: string,
  patch: { owner_id?: string | null; due_date?: string | null; priority?: string },
): Promise<ActionResult> {
  await requireViewer();
  const parsed = inlineSchema.safeParse({ taskId, ...patch });
  if (!parsed.success) return { ok: false, error: "That change isn't valid." };
  const { taskId: id, ...fields } = parsed.data;
  // Clearing the date clears its time too.
  const update = fields.due_date === null ? { ...fields, due_time: null } : fields;

  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").update(update).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "You don't have permission to change this task." };

  revalidateTaskViews(id);
  syncLater(() => syncTask(id));
  return { ok: true };
}
