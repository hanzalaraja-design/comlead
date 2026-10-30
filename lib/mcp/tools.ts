import "server-only";
import { siteUrl } from "@/lib/calendar/sync";
import { syncLater } from "@/lib/calendar/schedule";
import { syncTask } from "@/lib/calendar/sync";
import { DOMAINS } from "@/lib/domains";
import { personName } from "@/lib/labels";
import { sanitizeRichText } from "@/lib/sanitize";
import { emailSubtaskGiven } from "@/lib/tasks/subtasks";
import { formatDate, todayPKT } from "@/lib/time";
import type { KeyUser } from "@/lib/mcp/keys";
import type { ProjectKind } from "@/lib/types";

/**
 * What Claude can do in Highfy Tasks: read and search, create and update.
 * Nothing here deletes. Every call runs as the person whose key it is, so the
 * database's own rules decide what they can see and change.
 */

type Args = Record<string, unknown>;
type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  run: (u: KeyUser, a: Args) => Promise<string>;
};

class UserError extends Error {}

const OPEN = ["todo", "in_progress", "blocked"];
const STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"];
const PRIORITIES = ["urgent", "high", "medium", "low"];
const STATUS_LABEL: Record<string, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done", cancelled: "Cancelled" };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT = `id, title, status, priority, due_date, completed_at, overdue, owner_id, department_id, project_id, meeting_id, parent_task_id,
  owner:profiles!tasks_owner_id_fkey(email, full_name),
  department:departments!tasks_department_id_fkey(name),
  project:projects(name, kind),
  parent:parent_task_id(id, title)`;

type Row = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  completed_at: string | null;
  overdue: boolean;
  owner: { email: string; full_name: string | null } | null;
  department: { name: string } | null;
  project: { name: string; kind: ProjectKind } | null;
  parent: { id: string; title: string } | null;
};

const link = (id: string) => `${siteUrl()}/tasks/${id}`;

function line(t: Row): string {
  const bits = [
    STATUS_LABEL[t.status] ?? t.status,
    t.overdue ? "OVERDUE" : null,
    `${t.priority} priority`,
    t.owner ? `owner ${personName(t.owner)} <${t.owner.email}>` : "unassigned",
    t.due_date ? `due ${formatDate(t.due_date, "EEE d MMM yyyy")}` : "no due date",
    t.department?.name ?? null,
    t.project ? `${DOMAINS[t.project.kind].label}: ${t.project.name}` : null,
    t.parent ? `subtask of "${t.parent.title}"` : null,
  ].filter(Boolean);
  return `- ${t.title} (${bits.join(" · ")})\n  id: ${t.id} · ${link(t.id)}`;
}

const list = (rows: Row[], empty: string) => (rows.length ? rows.map(line).join("\n") : empty);

function str(a: Args, k: string, max = 300): string | undefined {
  const v = a[k];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new UserError(`"${k}" should be text.`);
  return v.trim().slice(0, max);
}

function date(a: Args, k: string): string | null | undefined {
  if (a[k] === null) return null;
  const v = str(a, k, 10);
  if (v === undefined) return undefined;
  if (!ISO.test(v)) throw new UserError(`"${k}" should be a date like 2026-11-05.`);
  return v;
}

function oneOf(a: Args, k: string, allowed: string[]): string | undefined {
  const v = str(a, k, 30);
  if (v === undefined) return undefined;
  const norm = v.toLowerCase().replace(/[\s-]+/g, "_");
  if (!allowed.includes(norm)) throw new UserError(`"${k}" must be one of: ${allowed.join(", ")}.`);
  return norm;
}

function id(a: Args, k: string): string {
  const v = str(a, k, 60);
  if (!v || !UUID.test(v)) throw new UserError(`"${k}" should be a task id (from a list or search).`);
  return v;
}

/** Plain text (or simple HTML) into the app's rich text. */
function richText(text: string): string {
  if (/<[a-z][\s\S]*>/i.test(text)) return sanitizeRichText(text);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

async function findPerson(u: KeyUser, who: string): Promise<{ id: string; label: string }> {
  const q = who.trim().toLowerCase();
  if (q === "me" || q === u.email.toLowerCase()) return { id: u.userId, label: "you" };
  const { data } = await u.db.from("profiles").select("id, email, full_name").eq("status", "active").limit(500);
  const people = (data ?? []) as { id: string; email: string; full_name: string | null }[];
  const exact = people.filter((p) => p.email.toLowerCase() === q || (p.full_name ?? "").toLowerCase() === q);
  const loose = exact.length ? exact : people.filter((p) => p.email.toLowerCase().startsWith(q) || (p.full_name ?? "").toLowerCase().includes(q));
  if (loose.length === 1) return { id: loose[0].id, label: personName(loose[0]) };
  if (!loose.length) throw new UserError(`No one called "${who}". Use list_people to find the right person.`);
  throw new UserError(`"${who}" matches several people: ${loose.slice(0, 6).map((p) => `${personName(p)} <${p.email}>`).join(", ")}. Use their email.`);
}

async function findTeam(u: KeyUser, name: string): Promise<{ id: string; name: string }> {
  const q = name.trim().toLowerCase();
  const { data } = await u.db.rpc("team_directory");
  const teams = (data ?? []) as { id: string; name: string; slug: string }[];
  const hit = teams.find((t) => t.name.toLowerCase() === q || t.slug === q) ?? teams.filter((t) => t.name.toLowerCase().includes(q))[0];
  if (!hit) throw new UserError(`No team called "${name}". Teams: ${teams.map((t) => t.name).join(", ")}.`);
  return hit;
}

async function findProject(u: KeyUser, name: string): Promise<{ id: string; name: string; kind: ProjectKind }> {
  const q = name.trim().toLowerCase();
  const { data } = await u.db.from("projects").select("id, name, slug, kind").eq("archived", false).limit(500);
  const all = (data ?? []) as { id: string; name: string; slug: string; kind: ProjectKind }[];
  const exact = all.filter((p) => p.name.toLowerCase() === q || p.slug === q);
  const loose = exact.length ? exact : all.filter((p) => p.name.toLowerCase().includes(q));
  if (loose.length === 1) return loose[0];
  if (!loose.length) throw new UserError(`No project, campaign or partnership called "${name}" that you're in. Use list_projects.`);
  throw new UserError(`"${name}" matches several: ${loose.slice(0, 6).map((p) => `${p.name} (${p.kind})`).join(", ")}. Be more specific.`);
}

function failed(e: { message?: string } | null, what: string): never {
  const msg = e?.message ?? "";
  if (/row-level security|permission/i.test(msg)) throw new UserError(`You don't have permission to ${what}.`);
  throw new UserError(msg ? `Couldn't ${what}: ${msg}` : `Couldn't ${what}.`);
}

async function setCollaborators(u: KeyUser, taskId: string, add: string[], remove: string[]) {
  for (const who of add) {
    const p = await findPerson(u, who);
    const { error } = await u.db.from("task_collaborators").upsert({ task_id: taskId, user_id: p.id }, { onConflict: "task_id,user_id", ignoreDuplicates: true });
    if (error) failed(error, `add ${who} as a collaborator`);
  }
  for (const who of remove) {
    const p = await findPerson(u, who);
    const { error } = await u.db.from("task_collaborators").delete().eq("task_id", taskId).eq("user_id", p.id);
    if (error) failed(error, `remove ${who}`);
  }
}

const strings = (a: Args, k: string): string[] => {
  const v = a[k];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new UserError(`"${k}" should be a list of names or emails.`);
  return (v as string[]).slice(0, 20);
};

const READ = { readOnlyHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false };

export const TOOLS: Tool[] = [
  {
    name: "list_my_tasks",
    description:
      "The signed-in person's open tasks (and subtasks given to them), soonest due first. role: 'own' (tasks they own), 'collab' (tasks they help on as a collaborator) or 'both'.",
    inputSchema: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["own", "collab", "both"], description: "Default both." },
        include_done: { type: "boolean", description: "Also list what they finished in the last 14 days." },
      },
    },
    annotations: READ,
    async run(u, a) {
      const role = oneOf(a, "role", ["own", "collab", "both"]) ?? "both";
      const out: string[] = [`Tasks for ${u.name} <${u.email}> · today is ${formatDate(todayPKT(), "EEE d MMM yyyy")}`];
      if (role !== "collab") {
        const { data, error } = await u.db.from("tasks").select(SELECT).eq("owner_id", u.userId).in("status", OPEN)
          .order("due_date", { ascending: true, nullsFirst: false }).limit(100);
        if (error) failed(error, "read your tasks");
        out.push(`\nOwned (${data!.length}):\n${list(data as unknown as Row[], "Nothing open.")}`);
      }
      if (role !== "own") {
        const { data: links } = await u.db.from("task_collaborators").select("task_id").eq("user_id", u.userId).limit(200);
        const ids = (links ?? []).map((l) => l.task_id as string);
        const { data } = ids.length
          ? await u.db.from("tasks").select(SELECT).in("id", ids).in("status", OPEN).order("due_date", { ascending: true, nullsFirst: false })
          : { data: [] };
        out.push(`\nCollaborating on (${(data ?? []).length}):\n${list((data ?? []) as unknown as Row[], "Nothing open.")}`);
      }
      if (a.include_done === true) {
        const since = new Date(Date.now() - 14 * 86400_000).toISOString();
        const { data } = await u.db.from("tasks").select(SELECT).eq("owner_id", u.userId).eq("status", "done").gte("completed_at", since)
          .order("completed_at", { ascending: false }).limit(50);
        out.push(`\nFinished in the last 14 days:\n${list((data ?? []) as unknown as Row[], "Nothing.")}`);
      }
      return out.join("\n");
    },
  },
  {
    name: "search_tasks",
    description:
      "Search tasks the person can see across teams, projects, campaigns and partnerships. All filters optional. Returns up to 50, soonest due first.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words in the title." },
        team: { type: "string", description: "Team name, e.g. Marketing." },
        project: { type: "string", description: "Project, campaign or partnership name, e.g. 11.11." },
        owner: { type: "string", description: "Email or name of the owner, or 'me'." },
        status: { type: "string", enum: ["open", ...STATUSES], description: "Default open (to do, in progress, blocked)." },
        overdue: { type: "boolean" },
        due_from: { type: "string", description: "YYYY-MM-DD" },
        due_to: { type: "string", description: "YYYY-MM-DD" },
        limit: { type: "number", description: "Up to 50." },
      },
    },
    annotations: READ,
    async run(u, a) {
      let q = u.db.from("tasks").select(SELECT);
      const status = oneOf(a, "status", ["open", ...STATUSES]) ?? "open";
      q = status === "open" ? q.in("status", OPEN) : q.eq("status", status);
      const text = str(a, "query", 100);
      if (text) q = q.ilike("title", `%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
      const team = str(a, "team");
      if (team) q = q.eq("department_id", (await findTeam(u, team)).id);
      const project = str(a, "project");
      if (project) q = q.eq("project_id", (await findProject(u, project)).id);
      const owner = str(a, "owner");
      if (owner) q = q.eq("owner_id", (await findPerson(u, owner)).id);
      if (a.overdue === true) q = q.eq("overdue", true);
      const from = date(a, "due_from");
      const to = date(a, "due_to");
      if (from) q = q.gte("due_date", from);
      if (to) q = q.lte("due_date", to);
      const limit = Math.min(50, Math.max(1, Number(a.limit) || 25));
      const { data, error } = await q.order("due_date", { ascending: true, nullsFirst: false }).limit(limit);
      if (error) failed(error, "search");
      return list(data as unknown as Row[], "No tasks match.");
    },
  },
  {
    name: "get_task",
    description: "One task in full: notes, owner, collaborators, subtasks and recent comments.",
    inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] },
    annotations: READ,
    async run(u, a) {
      const taskId = id(a, "task_id");
      const { data, error } = await u.db.from("tasks").select(`${SELECT}, description, blocked_reason, meeting:meetings!tasks_meeting_id_fkey(title, meeting_date)`).eq("id", taskId).maybeSingle();
      if (error) failed(error, "read that task");
      if (!data) throw new UserError("No task with that id that you can see.");
      const t = data as unknown as Row & { description: string | null; blocked_reason: string | null; meeting: { title: string | null; meeting_date: string } | null };
      const [collabs, subs, comments] = await Promise.all([
        u.db.from("task_collaborators").select("profile:profiles(email, full_name)").eq("task_id", taskId),
        u.db.from("tasks").select(SELECT).eq("parent_task_id", taskId).order("due_date", { ascending: true, nullsFirst: false }),
        u.db.from("task_comments").select("body, created_at, author:profiles(email, full_name)").eq("task_id", taskId).order("created_at", { ascending: false }).limit(10),
      ]);
      const notes = (t.description ?? "").replace(/<\/(p|li|tr|h2|h3)>/g, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim();
      return [
        line(t),
        t.blocked_reason ? `Blocked because: ${t.blocked_reason}` : null,
        t.meeting ? `From meeting: ${t.meeting.title || "Meeting"} (${formatDate(t.meeting.meeting_date, "d MMM")})` : null,
        `Collaborators: ${((collabs.data ?? []) as unknown as { profile: { email: string; full_name: string | null } }[]).map((c) => `${personName(c.profile)} <${c.profile.email}>`).join(", ") || "none"}`,
        `Notes:\n${notes || "(none)"}`,
        `Subtasks:\n${list((subs.data ?? []) as unknown as Row[], "(none)")}`,
        `Recent comments:\n${
          ((comments.data ?? []) as unknown as { body: string; created_at: string; author: { email: string; full_name: string | null } | null }[])
            .map((c) => `- ${personName(c.author)} (${formatDate(c.created_at.slice(0, 10), "d MMM")}): ${c.body}`)
            .join("\n") || "(none)"
        }`,
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
  {
    name: "create_task",
    description:
      "Create a task. Every task needs a team (or a project, campaign or partnership); if you're only in one team it goes there. Give parent_task_id to make it a subtask, meeting_id to make it a meeting action item. Dates are YYYY-MM-DD.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string", description: "Notes. Plain text is fine." },
        owner: { type: "string", description: "Email or name, or 'me'. Default: me." },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        priority: { type: "string", enum: PRIORITIES, description: "Default medium." },
        team: { type: "string", description: "Team name, e.g. Marketing." },
        project: { type: "string", description: "Project, campaign or partnership name." },
        collaborators: { type: "array", items: { type: "string" }, description: "Emails or names." },
        parent_task_id: { type: "string", description: "Make it a subtask of this task." },
        meeting_id: { type: "string", description: "Make it an action item of this meeting." },
      },
      required: ["title"],
    },
    annotations: WRITE,
    async run(u, a) {
      const title = str(a, "title");
      if (!title) throw new UserError("A task needs a title.");
      const owner = await findPerson(u, str(a, "owner") ?? "me");
      const team = str(a, "team") ? await findTeam(u, str(a, "team")!) : null;
      const project = str(a, "project") ? await findProject(u, str(a, "project")!) : null;
      const parentId = a.parent_task_id ? id(a, "parent_task_id") : null;
      const meetingId = a.meeting_id ? id(a, "meeting_id") : null;
      let departmentId = team?.id ?? null;
      if (meetingId && !departmentId) {
        const { data: m } = await u.db.from("meetings").select("department_id").eq("id", meetingId).maybeSingle();
        if (!m) throw new UserError("No meeting with that id that you can see.");
        departmentId = m.department_id as string;
      }
      if (!parentId && !departmentId && !project) {
        // Every task has a team: yours when there's only one, otherwise ask.
        const { data: mine } = await u.db.from("department_members").select("department:departments(id, name)").eq("user_id", u.userId);
        const teams = ((mine ?? []) as unknown as { department: { id: string; name: string } | null }[]).map((m) => m.department).filter((d) => !!d);
        if (teams.length !== 1)
          throw new UserError(`Which team is this for? Give "team"${teams.length ? `: ${teams.map((t) => t!.name).join(", ")}` : ""}.`);
        departmentId = teams[0]!.id;
      }
      const description = str(a, "description", 20000);
      const row = {
        title,
        description: description ? richText(description) : null,
        owner_id: owner.id,
        due_date: date(a, "due_date") ?? null,
        priority: oneOf(a, "priority", PRIORITIES) ?? "medium",
        // A subtask stays outside teams and projects; it follows its main task.
        department_id: parentId ? null : departmentId,
        project_id: parentId ? null : project?.id ?? null,
        parent_task_id: parentId,
        meeting_id: parentId ? null : meetingId,
        source: meetingId ? "meeting" : "manual",
        created_by: u.userId,
      };
      const { data, error } = await u.db.from("tasks").insert(row).select("id, title").single();
      if (error || !data) failed(error, "create the task");
      await setCollaborators(u, data!.id as string, strings(a, "collaborators"), []);
      if (parentId && owner.id !== u.userId) {
        const { data: parent } = await u.db.from("tasks").select("title").eq("id", parentId).maybeSingle();
        emailSubtaskGiven({ id: data!.id as string, title, due_date: row.due_date, owner_id: owner.id }, (parent?.title as string) ?? "a task", u.userId);
      }
      syncLater(() => syncTask(data!.id as string));
      return `Created "${title}" for ${owner.label}${row.due_date ? `, due ${formatDate(row.due_date, "EEE d MMM")}` : ""}.\nid: ${data!.id} · ${link(data!.id as string)}`;
    },
  },
  {
    name: "update_task",
    description:
      "Change a task: title, notes, status, priority, due date (null clears it), owner, project/campaign/partnership (empty text unlinks), or collaborators. Only send what changes. Locked tasks can only be changed by their owner.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        title: { type: "string" },
        description: { type: "string", description: "Replaces the notes." },
        status: { type: "string", enum: STATUSES },
        blocked_reason: { type: "string", description: "Why it's blocked (with status blocked)." },
        priority: { type: "string", enum: PRIORITIES },
        due_date: { type: ["string", "null"], description: "YYYY-MM-DD, or null to clear." },
        owner: { type: "string", description: "Email or name, or 'me'." },
        project: { type: "string", description: "Project, campaign or partnership name; empty text to unlink." },
        add_collaborators: { type: "array", items: { type: "string" } },
        remove_collaborators: { type: "array", items: { type: "string" } },
      },
      required: ["task_id"],
    },
    annotations: WRITE,
    async run(u, a) {
      const taskId = id(a, "task_id");
      const patch: Record<string, unknown> = {};
      const title = str(a, "title");
      if (title) patch.title = title;
      if (typeof a.description === "string") patch.description = a.description.trim() ? richText(a.description.slice(0, 20000)) : null;
      const status = oneOf(a, "status", STATUSES);
      if (status) {
        patch.status = status;
        if (status === "blocked") patch.blocked_reason = str(a, "blocked_reason", 1000) ?? null;
      }
      const priority = oneOf(a, "priority", PRIORITIES);
      if (priority) patch.priority = priority;
      const due = date(a, "due_date");
      if (due !== undefined) {
        patch.due_date = due;
        if (due === null) patch.due_time = null;
      }
      const owner = str(a, "owner");
      if (owner) patch.owner_id = (await findPerson(u, owner)).id;
      if (a.project === "") patch.project_id = null;
      else if (str(a, "project")) patch.project_id = (await findProject(u, str(a, "project")!)).id;

      if (Object.keys(patch).length) {
        const { data, error } = await u.db.from("tasks").update(patch).eq("id", taskId).select("id");
        if (error) failed(error, "update that task");
        if (!data?.length) throw new UserError("You can't change that task (it may be locked, or not yours to edit).");
      }
      await setCollaborators(u, taskId, strings(a, "add_collaborators"), strings(a, "remove_collaborators"));
      syncLater(() => syncTask(taskId));
      const { data: after } = await u.db.from("tasks").select(SELECT).eq("id", taskId).maybeSingle();
      return after ? `Updated:\n${line(after as unknown as Row)}` : "Updated.";
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to a task, as the signed-in person.",
    inputSchema: { type: "object", properties: { task_id: { type: "string" }, text: { type: "string" } }, required: ["task_id", "text"] },
    annotations: WRITE,
    async run(u, a) {
      const taskId = id(a, "task_id");
      const text = str(a, "text", 10000);
      if (!text) throw new UserError("Write the comment in \"text\".");
      const { error } = await u.db.from("task_comments").insert({ task_id: taskId, author_id: u.userId, body: text });
      if (error) failed(error, "comment on that task");
      return `Comment added. ${link(taskId)}#comments`;
    },
  },
  {
    name: "list_projects",
    description: "Projects, campaigns and partnerships the person is in, with dates and how many tasks are open.",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["project", "campaign", "partnership"] } } },
    annotations: READ,
    async run(u, a) {
      const kind = oneOf(a, "kind", ["project", "campaign", "partnership"]);
      let q = u.db.from("projects").select("id, name, slug, kind, category, locked, start_date, end_date").eq("archived", false).order("name");
      if (kind) q = q.eq("kind", kind);
      const { data, error } = await q.limit(200);
      if (error) failed(error, "list projects");
      const rows = (data ?? []) as { id: string; name: string; slug: string; kind: ProjectKind; category: string | null; locked: boolean; start_date: string | null; end_date: string | null }[];
      if (!rows.length) return "None you're in.";
      const { data: tasks } = await u.db.from("tasks").select("project_id").in("project_id", rows.map((r) => r.id)).in("status", OPEN).limit(5000);
      const open = new Map<string, number>();
      for (const t of tasks ?? []) open.set(t.project_id as string, (open.get(t.project_id as string) ?? 0) + 1);
      return rows
        .map((p) =>
          [
            `- ${p.name} (${DOMAINS[p.kind].label}${p.category ? `, ${p.category === "beauty" ? "beauty brand" : "non-beauty brand"}` : ""}${p.locked ? ", locked" : ""})`,
            p.start_date || p.end_date ? `${p.start_date ?? "?"} to ${p.end_date ?? "?"}` : null,
            `${open.get(p.id) ?? 0} open tasks`,
            `${siteUrl()}${DOMAINS[p.kind].path}/${p.slug}`,
          ]
            .filter(Boolean)
            .join(" · "),
        )
        .join("\n");
    },
  },
  {
    name: "list_meetings",
    description: "Recent meetings the person can see, newest first.",
    inputSchema: { type: "object", properties: { team: { type: "string" }, limit: { type: "number", description: "Up to 30." } } },
    annotations: READ,
    async run(u, a) {
      let q = u.db.from("meetings").select("id, title, meeting_date, department:departments(name)").order("meeting_date", { ascending: false });
      const team = str(a, "team");
      if (team) q = q.eq("department_id", (await findTeam(u, team)).id);
      const { data, error } = await q.limit(Math.min(30, Math.max(1, Number(a.limit) || 15)));
      if (error) failed(error, "list meetings");
      const rows = (data ?? []) as unknown as { id: string; title: string | null; meeting_date: string; department: { name: string } | null }[];
      return rows.length
        ? rows.map((m) => `- ${m.title || "Meeting"} · ${formatDate(m.meeting_date, "EEE d MMM yyyy")} · ${m.department?.name ?? ""}\n  id: ${m.id} · ${siteUrl()}/meetings/${m.id}`).join("\n")
        : "No meetings.";
    },
  },
  {
    name: "get_meeting",
    description: "A meeting's agenda, minutes and action items.",
    inputSchema: { type: "object", properties: { meeting_id: { type: "string" } }, required: ["meeting_id"] },
    annotations: READ,
    async run(u, a) {
      const meetingId = id(a, "meeting_id");
      const { data: m, error } = await u.db.from("meetings").select("id, title, meeting_date, agenda, minutes").eq("id", meetingId).maybeSingle();
      if (error) failed(error, "read that meeting");
      if (!m) throw new UserError("No meeting with that id that you can see.");
      const plain = (h: string | null) => (h ?? "").replace(/<\/(p|li|tr|h2|h3)>/g, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim();
      const { data: items } = await u.db.from("tasks").select(SELECT).eq("meeting_id", meetingId).order("created_at");
      return [
        `${m.title || "Meeting"} · ${formatDate(m.meeting_date as string, "EEE d MMM yyyy")} · ${siteUrl()}/meetings/${m.id}`,
        `Agenda:\n${plain(m.agenda as string | null) || "(none)"}`,
        `Minutes:\n${plain(m.minutes as string | null) || "(none)"}`,
        `Action items:\n${list((items ?? []) as unknown as Row[], "(none)")}`,
      ].join("\n\n");
    },
  },
  {
    name: "list_people",
    description: "People in Highfy Tasks, to find someone's email before giving them a task.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Part of a name or email." } } },
    annotations: READ,
    async run(u, a) {
      const q = str(a, "query", 60)?.toLowerCase();
      const { data } = await u.db.from("profiles").select("email, full_name").eq("status", "active").order("full_name").limit(500);
      const rows = ((data ?? []) as { email: string; full_name: string | null }[]).filter(
        (p) => !q || p.email.toLowerCase().includes(q) || (p.full_name ?? "").toLowerCase().includes(q),
      );
      return rows.length ? rows.slice(0, 50).map((p) => `- ${personName(p)} <${p.email}>`).join("\n") : "No one matches.";
    },
  },
  {
    name: "list_teams",
    description: "Every team in Highfy Tasks.",
    inputSchema: { type: "object", properties: {} },
    annotations: READ,
    async run(u) {
      const { data } = await u.db.rpc("team_directory");
      return ((data ?? []) as { name: string }[]).map((t) => `- ${t.name}`).join("\n") || "No teams.";
    },
  },
];

/** Run a tool; problems the person can fix come back as a readable message. */
export async function callTool(u: KeyUser, name: string, args: Args): Promise<{ text: string; isError: boolean }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { text: `There's no tool called ${name}.`, isError: true };
  try {
    return { text: await tool.run(u, args ?? {}), isError: false };
  } catch (e) {
    if (e instanceof UserError) return { text: e.message, isError: true };
    console.error(`[mcp:${name}]`, e);
    return { text: "Something went wrong on the Highfy Tasks side. Try again in a moment.", isError: true };
  }
}
