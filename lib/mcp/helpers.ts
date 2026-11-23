import "server-only";
import { siteUrl } from "@/lib/calendar/sync";
import { syncLater } from "@/lib/calendar/schedule";
import { syncTask } from "@/lib/calendar/sync";
import { DOMAINS } from "@/lib/domains";
import { personName } from "@/lib/labels";
import { sanitizeRichText } from "@/lib/sanitize";
import { formatDate, todayPKT } from "@/lib/time";
import { domainHref } from "@/lib/domains";
import { projectSlug } from "@/lib/projects";
import { type Section, type Surface } from "@/lib/placements";
import type { KeyUser } from "@/lib/mcp/keys";
import type { ProjectKind } from "@/lib/types";

/** Shared helpers for the connector tools (lib/mcp/tools*.ts). */

export type Args = Record<string, unknown>;
export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  run: (u: KeyUser, a: Args) => Promise<string>;
};

export class UserError extends Error {}

export const OPEN = ["todo", "in_progress", "blocked"];
export const STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"];
export const STATUS_LABEL: Record<string, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done", cancelled: "Cancelled" };
/** What a new task can start as (never cancelled). */
export const NEW_STATUSES = ["todo", "in_progress", "blocked", "done"];
export const PRIORITIES = ["urgent", "high", "medium", "low"];
export const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SELECT = `id, title, status, due_date, completed_at, overdue, owner_id, department_id, project_id, meeting_id, parent_task_id,
  owner:profiles!tasks_owner_id_fkey(email, full_name),
  department:departments!tasks_department_id_fkey(name),
  project:projects(name, kind),
  parent:parent_task_id(id, title)`;

export type Row = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  overdue: boolean;
  owner: { email: string; full_name: string | null } | null;
  department: { name: string } | null;
  project: { name: string; kind: ProjectKind } | null;
  parent: { id: string; title: string } | null;
};

export const link = (id: string) => `${siteUrl()}/tasks/${id}`;

export function line(t: Row): string {
  const bits = [
    STATUS_LABEL[t.status] ?? t.status,
    t.overdue ? "OVERDUE" : null,
    t.owner ? `owner ${personName(t.owner)} <${t.owner.email}>` : "unassigned",
    t.due_date ? `due ${formatDate(t.due_date, "EEE d MMM yyyy")}` : "no due date",
    t.department?.name ?? null,
    t.project ? `${DOMAINS[t.project.kind].label}: ${t.project.name}` : null,
    t.parent ? `subtask of "${t.parent.title}"` : null,
  ].filter(Boolean);
  return `- ${t.title} (${bits.join(" · ")})\n  id: ${t.id} · ${link(t.id)}`;
}

export const list = (rows: Row[], empty: string) => (rows.length ? rows.map(line).join("\n") : empty);

export function str(a: Args, k: string, max = 300): string | undefined {
  const v = a[k];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new UserError(`"${k}" should be text.`);
  return v.trim().slice(0, max);
}

export function date(a: Args, k: string): string | null | undefined {
  if (a[k] === null) return null;
  const v = str(a, k, 10);
  if (v === undefined) return undefined;
  if (!ISO.test(v)) throw new UserError(`"${k}" should be a date like 2026-11-05.`);
  return v;
}

export function oneOf(a: Args, k: string, allowed: string[]): string | undefined {
  const v = str(a, k, 30);
  if (v === undefined) return undefined;
  const norm = v.toLowerCase().replace(/[\s-]+/g, "_");
  if (!allowed.includes(norm)) throw new UserError(`"${k}" must be one of: ${allowed.join(", ")}.`);
  return norm;
}

export function id(a: Args, k: string): string {
  const v = str(a, k, 60);
  if (!v || !UUID.test(v)) throw new UserError(`"${k}" should be a task id (from a list or search).`);
  return v;
}

/** A time of day, HH:MM in 24 hours; null clears it. */
export function time(a: Args, k: string): string | null | undefined {
  if (a[k] === null) return null;
  const v = str(a, k, 5);
  if (v === undefined) return undefined;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new UserError(`"${k}" should be a time like 14:30.`);
  return v;
}

/** "The day it was done": a past day (or today), stored as midday Pakistan time like the app does. */
export function doneOn(a: Args, k = "done_on"): string | undefined {
  const d = date(a, k);
  if (!d) return undefined;
  if (d > todayPKT()) throw new UserError("That day hasn't happened yet.");
  return new Date(`${d}T12:00:00+05:00`).toISOString();
}

/** A web address for a booking: http or https, up to 500 characters. Without one, https:// is added. */
export function webLink(a: Args, k: string): string | undefined {
  const v = str(a, k, 600);
  if (v === undefined) return undefined;
  if (v.length > 500) throw new UserError(`"${k}" is too long (500 characters at most).`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^https?:\/\//i.test(v)) throw new UserError(`"${k}" should be a web address starting with http:// or https://.`);
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/** A term or journey of a project, by name or id. */
export async function findPart(u: KeyUser, projectId: string, which: string): Promise<{ id: string; name: string; kind: string }> {
  const q = which.trim().toLowerCase();
  const { data, error } = await u.db.from("project_parts").select("id, name, kind").eq("project_id", projectId).in("kind", ["term", "journey"]).order("sort");
  if (error) failed(error, "read its terms and journeys");
  const all = (data ?? []) as { id: string; name: string; kind: string }[];
  const exact = all.filter((p) => p.id === q || p.name.toLowerCase() === q);
  const loose = exact.length ? exact : all.filter((p) => p.name.toLowerCase().includes(q));
  if (loose.length === 1) return loose[0];
  const names = all.map((p) => `"${p.name}" (${p.kind})`).join(", ") || "none";
  if (!loose.length) throw new UserError(`No term or journey called "${which}" in that project. It has: ${names}.`);
  throw new UserError(`"${which}" matches several: ${loose.map((p) => `"${p.name}" (${p.kind}, id ${p.id})`).join(", ")}. Use the id.`);
}

/** Plain text (or simple HTML) into the app's rich text. */
export function richText(text: string): string {
  if (/<[a-z][\s\S]*>/i.test(text)) return sanitizeRichText(text);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export async function findPerson(u: KeyUser, who: string): Promise<{ id: string; label: string }> {
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

export async function findTeam(u: KeyUser, name: string): Promise<{ id: string; name: string }> {
  const q = name.trim().toLowerCase();
  const { data } = await u.db.rpc("team_directory");
  const teams = (data ?? []) as { id: string; name: string; slug: string }[];
  const hit = teams.find((t) => t.name.toLowerCase() === q || t.slug === q) ?? teams.filter((t) => t.name.toLowerCase().includes(q))[0];
  if (!hit) throw new UserError(`No team called "${name}". Teams: ${teams.map((t) => t.name).join(", ")}.`);
  return hit;
}

export async function findProject(u: KeyUser, name: string): Promise<{ id: string; name: string; kind: ProjectKind }> {
  const q = name.trim().toLowerCase();
  const { data } = await u.db.from("projects").select("id, name, slug, kind").eq("archived", false).limit(500);
  const all = (data ?? []) as { id: string; name: string; slug: string; kind: ProjectKind }[];
  const exact = all.filter((p) => p.name.toLowerCase() === q || p.slug === q);
  const loose = exact.length ? exact : all.filter((p) => p.name.toLowerCase().includes(q));
  if (loose.length === 1) return loose[0];
  if (!loose.length) throw new UserError(`No project, campaign or partnership called "${name}" that you're in. Use list_projects.`);
  throw new UserError(`"${name}" matches several: ${loose.slice(0, 6).map((p) => `${p.name} (${p.kind})`).join(", ")}. Be more specific.`);
}

export function failed(e: { message?: string } | null, what: string): never {
  const msg = e?.message ?? "";
  if (/row-level security|permission/i.test(msg)) throw new UserError(`You don't have permission to ${what}.`);
  throw new UserError(msg ? `Couldn't ${what}: ${msg}` : `Couldn't ${what}.`);
}

export async function setCollaborators(u: KeyUser, taskId: string, add: string[], remove: string[]) {
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

export const strings = (a: Args, k: string): string[] => {
  const v = a[k];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new UserError(`"${k}" should be a list of names or emails.`);
  return (v as string[]).slice(0, 20);
};

/** Create one task from create_task's arguments (also used for many at once). Several owners: one copy each, linked as a set. */
export async function createTaskFrom(u: KeyUser, a: Args): Promise<{ id: string; text: string }> {
  const title = str(a, "title");
  if (!title) throw new UserError("A task needs a title.");
  const named = [...(str(a, "owner") ? [str(a, "owner")!] : []), ...strings(a, "owners")];
  const owners: { id: string; label: string }[] = [];
  for (const who of named.length ? named : ["me"]) {
    const p = await findPerson(u, who);
    if (!owners.some((o) => o.id === p.id)) owners.push(p);
  }
  const team = str(a, "team") ? await findTeam(u, str(a, "team")!) : null;
  const project = str(a, "project") ? await findProject(u, str(a, "project")!) : null;
  const parentId = a.parent_task_id ? id(a, "parent_task_id") : null;
  if (parentId && owners.length > 1) throw new UserError("A subtask has one owner.");
  const meetingId = a.meeting_id ? id(a, "meeting_id") : null;
  let departmentId = team?.id ?? null;
  if (meetingId && !departmentId) {
    const { data: m } = await u.db.from("meetings").select("department_id").eq("id", meetingId).maybeSingle();
    if (!m) throw new UserError("No meeting with that id that you can see.");
    departmentId = m.department_id as string;
  }
  // Private: no team and no project, only the people on it can see it (WhatsApp's default).
  const isPrivate = a.private === true && !parentId && !departmentId && !project;
  if (!isPrivate && !parentId && !departmentId && !project) {
    // Every task has a team: yours when there's only one, otherwise ask.
    const { data: mine } = await u.db.from("department_members").select("department:departments(id, name)").eq("user_id", u.userId);
    const teams = ((mine ?? []) as unknown as { department: { id: string; name: string } | null }[]).map((m) => m.department).filter((d) => !!d);
    if (teams.length !== 1)
      throw new UserError(`Which team is this for? Give "team"${teams.length ? `: ${teams.map((t) => t!.name).join(", ")}` : ""}.`);
    departmentId = teams[0]!.id;
  }
  const part = str(a, "part");
  if (part && (parentId || !project)) throw new UserError('A term or journey ("part") needs the project it belongs to, and can\'t be on a subtask.');
  const partRow = part ? await findPart(u, project!.id, part) : null;
  const dueDate = date(a, "due_date") ?? null;
  const dueTime = time(a, "due_time") ?? null;
  if (dueTime && !dueDate) throw new UserError("Give a due_date to go with the due_time.");
  const doneAt = doneOn(a);
  const asked = oneOf(a, "status", NEW_STATUSES);
  if (doneAt && asked && asked !== "done") throw new UserError("A task with done_on is done; leave out status or set it to done.");
  const status = doneAt ? "done" : (asked ?? "todo");
  const description = str(a, "description", 20000);
  const row = {
    title,
    description: description ? richText(description) : null,
    due_date: dueDate,
    due_time: dueTime,
    status,
    completed_at: doneAt ?? null,
    blocked_reason: status === "blocked" ? (str(a, "blocked_reason", 1000) ?? null) : null,
    priority: oneOf(a, "priority", PRIORITIES) ?? "medium",
    // A subtask stays outside teams and projects; it follows its main task.
    department_id: parentId ? null : departmentId,
    project_id: parentId ? null : project?.id ?? null,
    part_id: partRow?.id ?? null,
    parent_task_id: parentId,
    meeting_id: parentId ? null : meetingId,
    source: meetingId ? "meeting" : "manual",
    created_by: u.userId,
    set_id: owners.length > 1 ? crypto.randomUUID() : null,
  };
  const { data, error } = await u.db
    .from("tasks")
    .insert(owners.map((o) => ({ ...row, owner_id: o.id })))
    .select("id, owner_id");
  if (error || !data?.length) failed(error, "create the task");
  const made = data as { id: string; owner_id: string }[];
  const collaborators = strings(a, "collaborators");
  for (const t of made) {
    if (collaborators.length) {
      const others: string[] = [];
      for (const who of collaborators) if ((await findPerson(u, who)).id !== t.owner_id) others.push(who);
      await setCollaborators(u, t.id, others, []);
    }
    syncLater(() => syncTask(t.id));
  }
  const who = owners.map((o) => o.label).join(", ");
  const extras = [
    row.due_date ? `due ${formatDate(row.due_date, "EEE d MMM")}${row.due_time ? ` at ${row.due_time}` : ""}` : null,
    status !== "todo" ? (doneAt ? `done on ${formatDate(date(a, "done_on")!, "EEE d MMM")}` : status.replace("_", " ")) : null,
    row.priority !== "medium" ? `${row.priority} priority` : null,
    partRow ? `in ${partRow.name}` : null,
  ].filter(Boolean);
  const ids = made.map((t) => `id: ${t.id} · ${link(t.id)}`).join("\n");
  return {
    id: made[0].id,
    text: `Created "${title}" for ${who}${made.length > 1 ? ` (one copy each, ${made.length} tasks)` : ""}${extras.length ? `, ${extras.join(", ")}` : ""}.\n${ids}`,
  };
}

export const READ = { readOnlyHint: true };
export const WRITE = { readOnlyHint: false, destructiveHint: false };

// ---------------------------------------------------------------------------
// Manual work: campaigns, many tasks, daily deals, the homepage, design
// requests and meetings. Still nothing that deletes or cancels.
// ---------------------------------------------------------------------------

export const KINDS = ["project", "campaign", "partnership"];
export const listOf = (a: Args, k: string, max = 50): Args[] => {
  const v = a[k];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "object" || x === null)) throw new UserError(`"${k}" should be a list of objects.`);
  if (v.length > max) throw new UserError(`At most ${max} in "${k}" at a time.`);
  return v as Args[];
};
export const idsOf = (a: Args, k: string, max = 50): string[] => {
  const v = a[k];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !UUID.test(x))) throw new UserError(`"${k}" should be a list of ids.`);
  if (v.length > max) throw new UserError(`At most ${max} at a time.`);
  return v as string[];
};
export const projectLink = (p: { slug: string; kind: ProjectKind }) => `${siteUrl()}${domainHref(p)}`;
export const surfacesOf = (a: Args): Surface[] | undefined => {
  const v = oneOf(a, "shows_on", ["website", "app", "both"]);
  return v === undefined ? undefined : v === "both" ? ["web", "app"] : v === "app" ? ["app"] : ["web"];
};

export async function findSection(u: KeyUser, name: string): Promise<Section> {
  const q = name.trim().toLowerCase();
  const { data } = await u.db.from("placement_sections").select("*").eq("archived", false).order("sort");
  const all = (data ?? []) as Section[];
  const hit = all.find((s) => s.key === q || s.name.toLowerCase() === q) ?? all.find((s) => s.name.toLowerCase().includes(q));
  if (!hit) throw new UserError(`No homepage section called "${name}". Sections: ${all.map((s) => s.name).join(", ")}.`);
  return hit;
}

/** The project's owners, teams and members, to copy or extend. */
export async function addPeopleAndTeams(u: KeyUser, projectId: string, owners: string[], members: string[], teams: string[]) {
  for (const who of owners) {
    const p = await findPerson(u, who);
    const { error } = await u.db.from("project_members").upsert({ project_id: projectId, user_id: p.id, role: "lead" }, { onConflict: "project_id,user_id" });
    if (error) failed(error, `make ${who} an owner`);
  }
  for (const who of members) {
    const p = await findPerson(u, who);
    const { error } = await u.db.from("project_members").upsert({ project_id: projectId, user_id: p.id, role: "member" }, { onConflict: "project_id,user_id", ignoreDuplicates: true });
    if (error) failed(error, `add ${who}`);
  }
  for (const name of teams) {
    const t = await findTeam(u, name);
    const { error } = await u.db.from("project_teams").upsert({ project_id: projectId, department_id: t.id }, { onConflict: "project_id,department_id", ignoreDuplicates: true });
    if (error) failed(error, `add the ${t.name} team`);
  }
}

/** Insert a project with a free slug; the caller becomes its first owner. */
export async function insertProject(u: KeyUser, row: Record<string, unknown>): Promise<{ id: string; slug: string; kind: ProjectKind; name: string }> {
  const base = projectSlug(String(row.name));
  for (let i = 0; i < 6; i++) {
    const slug = i === 0 ? base : `${base}-${i === 1 ? new Date().getFullYear() : Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await u.db.from("projects").insert({ ...row, slug, created_by: u.userId }).select("id, slug, kind, name").single();
    if (data) {
      const { error: own } = await u.db.from("project_members").insert({ project_id: data.id, user_id: u.userId, role: "lead" });
      if (own) failed(own, "make you its owner");
      return data as { id: string; slug: string; kind: ProjectKind; name: string };
    }
    if (error?.code !== "23505") failed(error, "create it");
  }
  throw new UserError("Try a different name.");
}

