import "server-only";
import { siteUrl } from "@/lib/calendar/sync";
import { syncLater } from "@/lib/calendar/schedule";
import { syncTask } from "@/lib/calendar/sync";
import { DOMAINS } from "@/lib/domains";
import { personName } from "@/lib/labels";
import { sanitizeRichText } from "@/lib/sanitize";
import { addDaysISO, formatDate, todayPKT } from "@/lib/time";
import { domainHref } from "@/lib/domains";
import { projectSlug } from "@/lib/projects";
import { PLACEMENT_COLUMNS, slotName, surfacesText, type Placement, type Section, type Surface } from "@/lib/placements";
import { CHANNELS, CHANNEL_LABELS, CREATIVE_COLUMNS, STATUS_LABELS, type Channel, type CreativeRequest } from "@/lib/creative";
import { notifyPersonLater, notifyTeamLater, placementsPath, placementsUrl, requestPath, requestUrl } from "@/lib/notify";
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

/** Create one task from create_task's arguments (also used for many at once). */
async function createTaskFrom(u: KeyUser, a: Args): Promise<{ id: string; text: string }> {
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
  syncLater(() => syncTask(data!.id as string));
  return {
    id: data!.id as string,
    text: `Created "${title}" for ${owner.label}${row.due_date ? `, due ${formatDate(row.due_date, "EEE d MMM")}` : ""}.\nid: ${data!.id} · ${link(data!.id as string)}`,
  };
}

const READ = { readOnlyHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false };

// ---------------------------------------------------------------------------
// Manual work: campaigns, many tasks, daily deals, the homepage, design
// requests and meetings. Still nothing that deletes or cancels.
// ---------------------------------------------------------------------------

const KINDS = ["project", "campaign", "partnership"];
const listOf = (a: Args, k: string, max = 50): Args[] => {
  const v = a[k];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "object" || x === null)) throw new UserError(`"${k}" should be a list of objects.`);
  if (v.length > max) throw new UserError(`At most ${max} in "${k}" at a time.`);
  return v as Args[];
};
const idsOf = (a: Args, k: string, max = 50): string[] => {
  const v = a[k];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !UUID.test(x))) throw new UserError(`"${k}" should be a list of ids.`);
  if (v.length > max) throw new UserError(`At most ${max} at a time.`);
  return v as string[];
};
const projectLink = (p: { slug: string; kind: ProjectKind }) => `${siteUrl()}${domainHref(p)}`;
const surfacesOf = (a: Args): Surface[] | undefined => {
  const v = oneOf(a, "shows_on", ["website", "app", "both"]);
  return v === undefined ? undefined : v === "both" ? ["web", "app"] : v === "app" ? ["app"] : ["web"];
};

async function findSection(u: KeyUser, name: string): Promise<Section> {
  const q = name.trim().toLowerCase();
  const { data } = await u.db.from("placement_sections").select("*").eq("archived", false).order("sort");
  const all = (data ?? []) as Section[];
  const hit = all.find((s) => s.key === q || s.name.toLowerCase() === q) ?? all.find((s) => s.name.toLowerCase().includes(q));
  if (!hit) throw new UserError(`No homepage section called "${name}". Sections: ${all.map((s) => s.name).join(", ")}.`);
  return hit;
}

/** The project's owners, teams and members, to copy or extend. */
async function addPeopleAndTeams(u: KeyUser, projectId: string, owners: string[], members: string[], teams: string[]) {
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
async function insertProject(u: KeyUser, row: Record<string, unknown>): Promise<{ id: string; slug: string; kind: ProjectKind; name: string }> {
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

const WORK_TOOLS: Tool[] = [
  {
    name: "create_project",
    description:
      "Create a project, campaign or partnership (you become an owner). Owners can lock it; teams decide whose lists it shows in; members are the people working on it. Partnerships are 'strategic' or 'beauty'. Dates are YYYY-MM-DD.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: KINDS },
        name: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        description: { type: "string", description: "The brief. Plain text is fine." },
        category: { type: "string", enum: ["strategic", "beauty"], description: "Partnerships only." },
        owners: { type: "array", items: { type: "string" }, description: "Emails or names besides you." },
        members: { type: "array", items: { type: "string" } },
        teams: { type: "array", items: { type: "string" } },
      },
      required: ["kind", "name"],
    },
    annotations: WRITE,
    async run(u, a) {
      const kind = oneOf(a, "kind", KINDS) as ProjectKind;
      const name = str(a, "name", 120);
      if (!name) throw new UserError("Give it a name.");
      const category = kind === "partnership" ? (oneOf(a, "category", ["strategic", "beauty"]) ?? "strategic") : null;
      const start = date(a, "start_date") ?? null;
      const end = date(a, "end_date") ?? null;
      if (start && end && end < start) throw new UserError("The end date is before the start.");
      const description = str(a, "description", 50000);
      const p = await insertProject(u, {
        name,
        kind,
        category: category === "beauty" ? "beauty" : category ? "non_beauty" : null,
        start_date: start,
        end_date: end,
        description: description ? richText(description) : null,
      });
      await addPeopleAndTeams(u, p.id, strings(a, "owners"), strings(a, "members"), strings(a, "teams"));
      return `Created the ${DOMAINS[kind].label.toLowerCase()} "${name}". ${projectLink(p)}`;
    },
  },
  {
    name: "update_project",
    description:
      "Change a project, campaign or partnership: name, dates, brief, strategic/beauty, and add owners, members or teams. Only send what changes. Locked ones can only be changed by their owners.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Its current name." },
        name: { type: "string" },
        start_date: { type: ["string", "null"] },
        end_date: { type: ["string", "null"] },
        description: { type: "string", description: "Replaces the brief." },
        category: { type: "string", enum: ["strategic", "beauty"] },
        add_owners: { type: "array", items: { type: "string" } },
        add_members: { type: "array", items: { type: "string" } },
        add_teams: { type: "array", items: { type: "string" } },
      },
      required: ["project"],
    },
    annotations: WRITE,
    async run(u, a) {
      const found = await findProject(u, str(a, "project")!);
      const patch: Record<string, unknown> = {};
      const name = str(a, "name", 120);
      if (name) patch.name = name;
      const start = date(a, "start_date");
      if (start !== undefined) patch.start_date = start;
      const end = date(a, "end_date");
      if (end !== undefined) patch.end_date = end;
      if (typeof a.description === "string") patch.description = a.description.trim() ? richText(a.description.slice(0, 50000)) : null;
      const category = oneOf(a, "category", ["strategic", "beauty"]);
      if (category && found.kind === "partnership") patch.category = category === "beauty" ? "beauty" : "non_beauty";
      if (Object.keys(patch).length) {
        const { data, error } = await u.db.from("projects").update(patch).eq("id", found.id).select("id");
        if (error) failed(error, "change it");
        if (!data?.length) throw new UserError("It's locked: only its owners can change it.");
      }
      await addPeopleAndTeams(u, found.id, strings(a, "add_owners"), strings(a, "add_members"), strings(a, "add_teams"));
      const { data: p } = await u.db.from("projects").select("slug, kind").eq("id", found.id).single();
      return `Updated ${found.name}. ${projectLink(p as { slug: string; kind: ProjectKind })}`;
    },
  },
  {
    name: "duplicate_campaign",
    description:
      "Make a new campaign (or project/partnership) from an existing one: same owners, teams, members, brief and type, plus copies of the tasks you pick (task_ids from search_tasks with project=...; leave out to copy all), with their subtasks. Copies start as To do, keep their owners and priority, and their due dates move by the gap between the two start dates.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "The one to copy, e.g. 11.11." },
        name: { type: "string", description: "The new one, e.g. Blessed Friday." },
        start_date: { type: "string" },
        end_date: { type: "string" },
        task_ids: { type: "array", items: { type: "string" }, description: "Main tasks to copy. Leave out to copy all of them." },
      },
      required: ["from", "name", "start_date"],
    },
    annotations: WRITE,
    async run(u, a) {
      const src = await findProject(u, str(a, "from")!);
      const name = str(a, "name", 120);
      const start = date(a, "start_date");
      if (!name || !start) throw new UserError("Give the new name and start_date.");
      const end = date(a, "end_date") ?? null;
      const { data: s } = await u.db.from("projects").select("kind, category, description, start_date, end_date").eq("id", src.id).single();
      const old = s as { kind: ProjectKind; category: string | null; description: string | null; start_date: string | null; end_date: string | null };
      const shift = old.start_date ? Math.round((Date.parse(start) - Date.parse(old.start_date)) / 86400_000) : 0;
      const newEnd = end ?? (old.end_date ? addDaysISO(old.end_date, shift) : null);
      const p = await insertProject(u, { name, kind: old.kind, category: old.category, description: old.description, start_date: start, end_date: newEnd });

      const [{ data: people }, { data: teams }] = await Promise.all([
        u.db.from("project_members").select("user_id, role").eq("project_id", src.id),
        u.db.from("project_teams").select("department_id").eq("project_id", src.id),
      ]);
      const pm = ((people ?? []) as { user_id: string; role: string }[]).filter((m) => m.user_id !== u.userId);
      if (pm.length) await u.db.from("project_members").upsert(pm.map((m) => ({ project_id: p.id, user_id: m.user_id, role: m.role })), { onConflict: "project_id,user_id" });
      const pt = (teams ?? []) as { department_id: string }[];
      if (pt.length) await u.db.from("project_teams").insert(pt.map((t) => ({ project_id: p.id, department_id: t.department_id })));

      let q = u.db.from("tasks").select("id, title, description, priority, owner_id, department_id, due_date, due_time").eq("project_id", src.id).is("parent_task_id", null).is("deleted_at", null).neq("status", "cancelled");
      if (Array.isArray(a.task_ids)) q = q.in("id", idsOf(a, "task_ids", 300));
      const { data: mains } = await q.limit(300);
      type T = { id: string; title: string; description: string | null; priority: string; owner_id: string | null; department_id: string | null; due_date: string | null; due_time: string | null };
      const move = (d: string | null) => (d ? addDaysISO(d, shift) : null);
      let copied = 0;
      let subs = 0;
      const missed: string[] = [];
      for (const t of (mains ?? []) as T[]) {
        const { data: made, error } = await u.db
          .from("tasks")
          .insert({ title: t.title, description: t.description, priority: t.priority, owner_id: t.owner_id, department_id: t.department_id, project_id: p.id, due_date: move(t.due_date), due_time: t.due_time, created_by: u.userId })
          .select("id")
          .single();
        if (error || !made) {
          missed.push(`${t.title} (${error?.message ?? "not allowed"})`);
          continue;
        }
        copied++;
        const { data: children } = await u.db.from("tasks").select("title, description, priority, owner_id, due_date, due_time").eq("parent_task_id", t.id).is("deleted_at", null).neq("status", "cancelled");
        for (const c of (children ?? []) as Omit<T, "id" | "department_id">[]) {
          const { error: ce } = await u.db.from("tasks").insert({ title: c.title, description: c.description, priority: c.priority, owner_id: c.owner_id, parent_task_id: made.id, due_date: move(c.due_date), due_time: c.due_time, created_by: u.userId });
          if (ce) missed.push(`${c.title} (${ce.message})`);
          else subs++;
        }
      }
      return `Created "${name}" from ${src.name}: ${copied} task${copied === 1 ? "" : "s"}${subs ? ` and ${subs} subtask${subs === 1 ? "" : "s"}` : ""} copied${shift ? `, dates moved by ${shift} day${Math.abs(shift) === 1 ? "" : "s"}` : ""}. ${projectLink(p)}${missed.length ? `\nNot copied: ${missed.join("; ")}` : ""}`;
    },
  },
  {
    name: "create_tasks",
    description: "Create several tasks at once (up to 50). Each item takes the same fields as create_task.",
    inputSchema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              owner: { type: "string" },
              due_date: { type: "string" },
              priority: { type: "string", enum: PRIORITIES },
              team: { type: "string" },
              project: { type: "string" },
              collaborators: { type: "array", items: { type: "string" } },
              parent_task_id: { type: "string" },
              meeting_id: { type: "string" },
            },
            required: ["title"],
          },
        },
      },
      required: ["tasks"],
    },
    annotations: WRITE,
    async run(u, a) {
      const items = listOf(a, "tasks");
      if (!items.length) throw new UserError("Give at least one task.");
      const out: string[] = [];
      for (const [i, t] of items.entries()) {
        try {
          out.push((await createTaskFrom(u, t)).text);
        } catch (e) {
          out.push(`#${i + 1} "${typeof t.title === "string" ? t.title : "?"}" not created: ${e instanceof Error ? e.message : "error"}`);
        }
      }
      return out.join("\n");
    },
  },
  {
    name: "complete_tasks",
    description: "Mark several tasks done at once (up to 50), by id.",
    inputSchema: { type: "object", properties: { task_ids: { type: "array", items: { type: "string" } } }, required: ["task_ids"] },
    annotations: WRITE,
    async run(u, a) {
      const ids = idsOf(a, "task_ids");
      const out: string[] = [];
      for (const t of ids) {
        const { data, error } = await u.db.from("tasks").update({ status: "done" }).eq("id", t).select("id, title");
        if (error || !data?.length) out.push(`${t}: couldn't (locked or not yours to edit)`);
        else {
          out.push(`Done: ${data[0].title}`);
          syncLater(() => syncTask(t));
        }
      }
      return out.join("\n");
    },
  },
  {
    name: "get_daily_deals",
    description: "The Daily deals sheet for a month: for each day the announcement bar and hero banners 1 and 2, or the campaign running that day.",
    inputSchema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM. Default this month." } } },
    annotations: READ,
    async run(u, a) {
      const month = str(a, "month", 7) ?? todayPKT().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) throw new UserError('"month" should look like 2026-11.');
      const [y, m] = month.split("-").map(Number);
      const first = `${month}-01`;
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const [{ data: b }, { data: c }] = await Promise.all([
        u.db
          .from("placements")
          .select("id, section_key, position, brand, starts_on, ends_on, stage")
          .or("and(section_key.eq.announcement,position.eq.1),and(section_key.eq.hero,position.in.(1,2))")
          .neq("stage", "ended")
          .lte("starts_on", last)
          .or(`ends_on.is.null,ends_on.gte.${first}`),
        u.db.from("projects").select("name, start_date, end_date").eq("kind", "campaign").eq("archived", false).lte("start_date", last),
      ]);
      const bookings = (b ?? []) as { id: string; section_key: string; position: number; brand: string; starts_on: string; ends_on: string | null; stage: string }[];
      const camps = ((c ?? []) as { name: string; start_date: string; end_date: string | null }[]).filter((x) => (x.end_date ?? x.start_date) >= first);
      const at = (d: string, key: string, pos: number) => bookings.find((x) => x.section_key === key && x.position === pos && x.starts_on <= d && (x.ends_on ?? "9999") >= d);
      const lines: string[] = [];
      for (let d = first; d <= last; d = addDaysISO(d, 1)) {
        const running = camps.filter((x) => x.start_date <= d && (x.end_date ?? x.start_date) >= d).map((x) => x.name);
        const cell = (x?: { brand: string; stage: string }) => (x ? `${x.brand} [${x.stage === "booked" ? "to design" : x.stage === "ready" ? "on Figma" : x.stage}]` : "—");
        lines.push(
          `${formatDate(d, "EEE d MMM")}: ${running.length ? `campaign ${running.join(" + ")}; ` : ""}announcement ${cell(at(d, "announcement", 1))}; hero 1 ${cell(at(d, "hero", 1))}; hero 2 ${cell(at(d, "hero", 2))}`,
        );
      }
      return `Daily deals, ${formatDate(first, "MMMM yyyy")} · ${siteUrl()}/daily-deals?month=${month}\n${lines.join("\n")}`;
    },
  },
  {
    name: "set_daily_deals",
    description:
      "Fill or change days on the Daily deals sheet (up to 62 days). Each row: date, and any of announcement, hero1, hero2 (the text for that banner). It books that day on the homepage (website + app) and Design sees it. Cells you leave out are untouched; this never clears a day. Days already booked for several days have to be changed with update_booking.",
    inputSchema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: { type: "object", properties: { date: { type: "string" }, announcement: { type: "string" }, hero1: { type: "string" }, hero2: { type: "string" } }, required: ["date"] },
        },
      },
      required: ["rows"],
    },
    annotations: WRITE,
    async run(u, a) {
      const rows = listOf(a, "rows", 62);
      const slots = { announcement: ["announcement", 1], hero1: ["hero", 1], hero2: ["hero", 2] } as const;
      const out: string[] = [];
      let made = 0;
      for (const r of rows) {
        const d = date(r, "date");
        if (!d) {
          out.push(`Skipped a row without a date.`);
          continue;
        }
        for (const k of ["announcement", "hero1", "hero2"] as const) {
          const text = str(r, k, 120);
          if (!text) continue;
          const [key, pos] = slots[k];
          const { data: cur } = await u.db
            .from("placements")
            .select("id, starts_on, ends_on, brand, stage, changed_from")
            .eq("section_key", key)
            .eq("position", pos)
            .neq("stage", "ended")
            .lte("starts_on", d)
            .or(`ends_on.is.null,ends_on.gte.${d}`)
            .limit(1)
            .maybeSingle();
          if (cur && (cur.starts_on !== cur.ends_on)) {
            out.push(`${d} ${k}: "${cur.brand}" runs over several days; change it with update_booking (id ${cur.id}).`);
            continue;
          }
          if (cur) {
            if (cur.brand === text) continue;
            const madeAlready = cur.stage === "ready" || cur.stage === "live";
            const { error } = await u.db
              .from("placements")
              .update({ brand: text, comms: null, ...(madeAlready && !cur.changed_from ? { changed_from: { comms: cur.brand } } : {}) })
              .eq("id", cur.id);
            out.push(error ? `${d} ${k}: ${error.message}` : `${d} ${k}: changed to "${text}"`);
          } else {
            const { error } = await u.db.from("placements").insert({ section_key: key, position: pos, brand: text, starts_on: d, ends_on: d, shows_on: ["web", "app"], created_by: u.userId });
            if (error) out.push(`${d} ${k}: ${error.message}`);
            else {
              made++;
              out.push(`${d} ${k}: "${text}"`);
            }
          }
        }
      }
      if (made)
        notifyTeamLater("design", "design_new", {
          title: `${u.name} added ${made} daily deal${made === 1 ? "" : "s"} (via Claude): they're in your Design list`,
          href: "/placements?tab=design",
          actorId: u.userId,
        });
      return out.length ? out.join("\n") : "Nothing to change.";
    },
  },
  {
    name: "get_homepage",
    description: "What's booked on the homepage (website and app) on a day, slot by slot, with each booking's id, stage and where it shows.",
    inputSchema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD. Default today." } } },
    annotations: READ,
    async run(u, a) {
      const d = date(a, "date") ?? todayPKT();
      const [{ data: secs }, { data: b }] = await Promise.all([
        u.db.from("placement_sections").select("*").eq("archived", false).eq("surface", "web").order("sort"),
        u.db.from("placements").select(PLACEMENT_COLUMNS).neq("stage", "ended").lte("starts_on", d).or(`ends_on.is.null,ends_on.gte.${d}`),
      ]);
      const bookings = (b ?? []) as unknown as Placement[];
      const lines: string[] = [];
      for (const s of (secs ?? []) as Section[]) {
        for (let n = 1; n <= s.slots; n++) {
          const p = bookings.find((x) => x.section_key === s.key && x.position === n);
          if (p) lines.push(`- ${slotName(s, n)}: ${p.brand}${p.comms ? ` ("${p.comms}")` : ""} · ${surfacesText(p.shows_on?.length ? p.shows_on : ["web"])} · ${p.stage === "booked" ? "to design" : p.stage === "ready" ? "on Figma, to put live" : "live"} · ${formatDate(p.starts_on, "d MMM")}${p.ends_on ? `–${formatDate(p.ends_on, "d MMM")}` : " onwards"} · id ${p.id}`);
          else if (s.slots <= 3) lines.push(`- ${slotName(s, n)}: empty${s.optional ? " (optional)" : ""}`);
        }
      }
      return `Homepage on ${formatDate(d, "EEE d MMM yyyy")} · ${siteUrl()}/placements?tab=web&date=${d}\n${lines.join("\n")}`;
    },
  },
  {
    name: "book_slot",
    description:
      "Book a homepage slot: section (e.g. 'Hero carousel', 'Announcement bar', 'Partnership strip'), slot number (default 1), brand, banner text, dates and where it shows (website, app or both). Design is told. One booking per slot at a time.",
    inputSchema: {
      type: "object",
      properties: {
        section: { type: "string" },
        slot: { type: "number", description: "Slide or tile number, default 1." },
        brand: { type: "string" },
        text: { type: "string", description: "What the banner says." },
        notes: { type: "string", description: "For Design." },
        start_date: { type: "string" },
        end_date: { type: ["string", "null"], description: "Leave out or null for ongoing." },
        shows_on: { type: "string", enum: ["website", "app", "both"], description: "Default both." },
      },
      required: ["section", "brand", "start_date"],
    },
    annotations: WRITE,
    async run(u, a) {
      const s = await findSection(u, str(a, "section")!);
      const slot = typeof a.slot === "number" ? Math.round(a.slot) : 1;
      if (slot < 1 || slot > s.slots) throw new UserError(`${s.name} has ${s.slots} slot${s.slots === 1 ? "" : "s"}.`);
      const brand = str(a, "brand", 120);
      const start = date(a, "start_date");
      if (!brand || !start) throw new UserError("Give the brand and start_date.");
      const end = date(a, "end_date") ?? null;
      if (end && end < start) throw new UserError("The end date is before the start.");
      const text = str(a, "text", 300) ?? null;
      const { data, error } = await u.db
        .from("placements")
        .insert({ section_key: s.key, position: slot, brand, comms: s.kind === "icons" ? null : text, products: s.kind === "icons" ? text : null, notes: str(a, "notes", 2000) ?? null, starts_on: start, ends_on: end, shows_on: surfacesOf(a) ?? ["web", "app"], created_by: u.userId })
        .select("id")
        .single();
      if (error || !data) failed(error, "book that slot");
      notifyTeamLater("design", "design_new", {
        title: `${u.name} booked ${brand} in ${slotName(s, slot)} (via Claude): needs a banner`,
        body: [`From ${start}${end ? ` to ${end}` : ""}`, text].filter(Boolean).join(" · "),
        href: placementsPath(data!.id as string),
        actorId: u.userId,
      });
      return `Booked ${slotName(s, slot)} for ${brand} from ${formatDate(start, "d MMM")}${end ? ` to ${formatDate(end, "d MMM")}` : " (ongoing)"}. Design has been told. id ${data!.id} · ${placementsUrl(data!.id as string)}`;
    },
  },
  {
    name: "update_booking",
    description: "Change a homepage booking you made (or any, if you're in Commercial): brand, banner text, notes, dates or where it shows. If the banner was already made and the text changes, Design is asked to update it.",
    inputSchema: {
      type: "object",
      properties: {
        booking_id: { type: "string" },
        brand: { type: "string" },
        text: { type: "string" },
        notes: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: ["string", "null"] },
        shows_on: { type: "string", enum: ["website", "app", "both"] },
      },
      required: ["booking_id"],
    },
    annotations: WRITE,
    async run(u, a) {
      const bid = id(a, "booking_id");
      const { data: cur } = await u.db.from("placements").select(PLACEMENT_COLUMNS).eq("id", bid).maybeSingle();
      if (!cur) throw new UserError("No booking with that id. Use get_homepage.");
      const p = cur as unknown as Placement;
      const patch: Record<string, unknown> = {};
      const brand = str(a, "brand", 120);
      if (brand) patch.brand = brand;
      if (typeof a.text === "string") patch.comms = a.text.trim().slice(0, 300) || null;
      if (typeof a.notes === "string") patch.notes = a.notes.trim().slice(0, 2000) || null;
      const start = date(a, "start_date");
      if (start) patch.starts_on = start;
      const end = date(a, "end_date");
      if (end !== undefined) patch.ends_on = end;
      const shows = surfacesOf(a);
      if (shows) patch.shows_on = shows;
      if (!Object.keys(patch).length) throw new UserError("Nothing to change.");
      const textChanged = (patch.brand !== undefined && patch.brand !== p.brand) || (patch.comms !== undefined && patch.comms !== p.comms);
      if (textChanged && (p.stage === "ready" || p.stage === "live") && !p.changed_from) patch.changed_from = { comms: p.comms ?? p.brand, products: p.products };
      const { data, error } = await u.db.from("placements").update(patch).eq("id", bid).select("id");
      if (error) failed(error, "change that booking");
      if (!data?.length) throw new UserError("Only whoever booked it (or Commercial) can change it.");
      return `Updated the booking.${patch.changed_from ? " Design has been asked to update the banner." : ""} ${placementsUrl(bid)}`;
    },
  },
  {
    name: "list_requests",
    description: "Design requests from the Social, Ads, CRM and Partnerships tabs: status, who asked, who's designing, deadlines.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", enum: CHANNELS.map((c) => c.key) },
        status: { type: "string", enum: ["open", "all", "requested", "in_design", "in_review", "approved", "done", "live"], description: "Default open." },
        mine: { type: "boolean", description: "Only ones you asked for." },
      },
    },
    annotations: READ,
    async run(u, a) {
      const channel = oneOf(a, "channel", CHANNELS.map((c) => c.key));
      const status = oneOf(a, "status", ["open", "all", "requested", "in_design", "in_review", "approved", "done", "live"]) ?? "open";
      let q = u.db.from("creative_requests").select(CREATIVE_COLUMNS).neq("status", "cancelled").order("needed_by", { ascending: true, nullsFirst: false }).limit(100);
      if (channel) q = q.eq("channel", channel);
      if (status === "open") q = q.in("status", ["requested", "in_design", "in_review", "approved"]);
      else if (status !== "all") q = q.eq("status", status);
      if (a.mine === true) q = q.eq("requested_by", u.userId);
      const { data, error } = await q;
      if (error) failed(error, "read the requests");
      const rows = (data ?? []) as unknown as CreativeRequest[];
      if (!rows.length) return "No requests match.";
      const { data: people } = await u.db.from("profiles").select("id, email, full_name").in("id", [...new Set(rows.flatMap((r) => [r.requested_by, r.designer_id].filter(Boolean) as string[]))]);
      const nameOf = (pid: string | null) => {
        const p = (people ?? []).find((x) => x.id === pid);
        return p ? personName(p as { email: string; full_name: string | null }) : "nobody yet";
      };
      return rows
        .map((r) => `- [${CHANNEL_LABELS[r.channel]}] ${r.title} · ${STATUS_LABELS[r.status]}${r.change_note && r.status === "in_design" ? ` (revision: "${r.change_note}")` : ""} · asked by ${nameOf(r.requested_by)} · designer ${nameOf(r.designer_id)}${r.needed_by ? ` · needed ${formatDate(r.needed_by, "d MMM")}` : ""}\n  id: ${r.id} · ${requestUrl(r.channel, r.id)}`)
        .join("\n");
    },
  },
  {
    name: "create_request",
    description: "Ask Design for something on the Social, Ads, CRM or Partnerships tab. Optionally link it to a campaign, project or partnership. Design is told.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", enum: CHANNELS.map((c) => c.key) },
        title: { type: "string", description: "What's needed." },
        formats: { type: "string", description: "e.g. Post 1:1 ×3, Story ×3" },
        brief: { type: "string" },
        link: { type: "string", description: "Campaign, project or partnership name." },
        needed_by: { type: "string" },
        live_from: { type: "string" },
        live_to: { type: "string" },
      },
      required: ["channel", "title", "needed_by"],
    },
    annotations: WRITE,
    async run(u, a) {
      const channel = oneOf(a, "channel", CHANNELS.map((c) => c.key)) as Channel;
      const title = str(a, "title", 200);
      if (!title) throw new UserError("Say what's needed in \"title\".");
      const project = str(a, "link") ? await findProject(u, str(a, "link")!) : null;
      const row = {
        channel,
        title,
        formats: str(a, "formats", 500) ?? null,
        brief: str(a, "brief", 5000) ?? null,
        project_id: project?.id ?? null,
        needed_by: date(a, "needed_by") ?? null,
        live_from: date(a, "live_from") ?? null,
        live_to: date(a, "live_to") ?? null,
        requested_by: u.userId,
      };
      const { data, error } = await u.db.from("creative_requests").insert(row).select("id").single();
      if (error || !data) failed(error, "send that request");
      notifyTeamLater("design", "design_new", {
        title: `${u.name} needs ${title} (${CHANNEL_LABELS[channel]}, via Claude)`,
        body: [row.formats, row.needed_by && `needed ${row.needed_by}`].filter(Boolean).join(" · "),
        href: requestPath(channel, data!.id as string),
        actorId: u.userId,
      });
      return `Sent to Design: ${title} (${CHANNEL_LABELS[channel]}). id ${data!.id} · ${requestUrl(channel, data!.id as string)}`;
    },
  },
  {
    name: "update_request",
    description: "Change a design request you asked for: title, formats, brief, link, needed by, live dates. Only send what changes.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string" },
        title: { type: "string" },
        formats: { type: "string" },
        brief: { type: "string" },
        link: { type: "string", description: "Campaign, project or partnership name; empty text to unlink." },
        needed_by: { type: "string" },
        live_from: { type: ["string", "null"] },
        live_to: { type: ["string", "null"] },
      },
      required: ["request_id"],
    },
    annotations: WRITE,
    async run(u, a) {
      const rid = id(a, "request_id");
      const patch: Record<string, unknown> = {};
      for (const [k, max] of [["title", 200], ["formats", 500], ["brief", 5000]] as const) if (typeof a[k] === "string") patch[k] = (a[k] as string).trim().slice(0, max) || (k === "title" ? undefined : null);
      if (a.link === "") patch.project_id = null;
      else if (str(a, "link")) patch.project_id = (await findProject(u, str(a, "link")!)).id;
      for (const k of ["needed_by", "live_from", "live_to"]) {
        const d = date(a, k);
        if (d !== undefined) patch[k] = d;
      }
      if (!Object.keys(patch).length) throw new UserError("Nothing to change.");
      const { data, error } = await u.db.from("creative_requests").update(patch).eq("id", rid).select("id, channel");
      if (error) failed(error, "change that request");
      if (!data?.length) throw new UserError("Only whoever asked can change it.");
      return `Updated. ${requestUrl(data[0].channel as string, rid)}`;
    },
  },
  {
    name: "comment_request",
    description: "Comment on a design request. Whoever asked and the designer are told.",
    inputSchema: { type: "object", properties: { request_id: { type: "string" }, text: { type: "string" } }, required: ["request_id", "text"] },
    annotations: WRITE,
    async run(u, a) {
      const rid = id(a, "request_id");
      const text = str(a, "text", 10000);
      if (!text) throw new UserError("Write the comment in \"text\".");
      const { error } = await u.db.from("creative_request_comments").insert({ request_id: rid, author_id: u.userId, body: text });
      if (error) failed(error, "comment on that request");
      const { data: r } = await u.db.from("creative_requests").select("title, channel, requested_by, designer_id").eq("id", rid).maybeSingle();
      if (r)
        for (const who of new Set([r.requested_by, r.designer_id].filter((x): x is string => !!x && x !== u.userId)))
          notifyPersonLater(who, who === r.designer_id ? "revision" : "my_requests", { title: `${u.name} commented on ${r.title}`, body: text, href: requestPath(r.channel as string, rid), actorId: u.userId });
      return "Comment added.";
    },
  },
  {
    name: "approve_request",
    description: "Approve a design request that's in review (only whoever asked for it).",
    inputSchema: { type: "object", properties: { request_id: { type: "string" } }, required: ["request_id"] },
    annotations: WRITE,
    async run(u, a) {
      const rid = id(a, "request_id");
      const { data, error } = await u.db.from("creative_requests").update({ status: "approved" }).eq("id", rid).eq("status", "in_review").select("id");
      if (error) failed(error, "approve it");
      if (!data?.length) throw new UserError("Only whoever asked can approve it, and only while it's in review.");
      return "Approved.";
    },
  },
  {
    name: "ask_revision",
    description: "Send a design request back to Design with what needs to change (only whoever asked). Works after review, approval, completion or going live.",
    inputSchema: { type: "object", properties: { request_id: { type: "string" }, note: { type: "string" } }, required: ["request_id", "note"] },
    annotations: WRITE,
    async run(u, a) {
      const rid = id(a, "request_id");
      const note = str(a, "note", 2000);
      if (!note) throw new UserError("Say what needs to change in \"note\".");
      const { data, error } = await u.db
        .from("creative_requests")
        .update({ status: "in_design", change_note: note })
        .eq("id", rid)
        .in("status", ["in_review", "approved", "done", "live"])
        .select("title, channel, designer_id");
      if (error) failed(error, "send it back");
      if (!data?.length) throw new UserError("Only whoever asked can ask for a revision, after Design has sent it.");
      notifyPersonLater(data[0].designer_id as string | null, "revision", { title: `${u.name} asked for a revision on ${data[0].title}`, body: note, href: requestPath(data[0].channel as string, rid), actorId: u.userId });
      return "Sent back to Design.";
    },
  },
  {
    name: "log_meeting",
    description: "Record a meeting in a team (e.g. one you forgot to log): date, time, title, attendees and minutes. No Outlook invite is sent. Add action items with add_action_items.",
    inputSchema: {
      type: "object",
      properties: {
        team: { type: "string" },
        date: { type: "string" },
        time: { type: "string", description: "HH:MM, 24-hour." },
        title: { type: "string" },
        minutes: { type: "string", description: "Plain text is fine." },
        attendees: { type: "array", items: { type: "string" } },
      },
      required: ["team", "date", "title"],
    },
    annotations: WRITE,
    async run(u, a) {
      const team = await findTeam(u, str(a, "team")!);
      const d = date(a, "date");
      const title = str(a, "title", 200);
      if (!d || !title) throw new UserError("Give the date and title.");
      const time = str(a, "time", 5);
      if (time && !/^\d{2}:\d{2}$/.test(time)) throw new UserError('"time" should look like 14:30.');
      const minutes = str(a, "minutes", 50000);
      const { data, error } = await u.db
        .from("meetings")
        .insert({ department_id: team.id, title, meeting_date: d, meeting_time: time ?? null, minutes: minutes ? richText(minutes) : null, created_by: u.userId })
        .select("id")
        .single();
      if (error || !data) failed(error, `log a meeting in ${team.name}`);
      const people = strings(a, "attendees");
      for (const who of people) {
        const p = await findPerson(u, who);
        await u.db.from("meeting_attendees").upsert({ meeting_id: data!.id, user_id: p.id }, { onConflict: "meeting_id,user_id", ignoreDuplicates: true });
      }
      return `Logged "${title}" in ${team.name} on ${formatDate(d, "EEE d MMM")}. meeting_id ${data!.id} · ${siteUrl()}/meetings/${data!.id}`;
    },
  },
  {
    name: "add_action_items",
    description: "Add action items (tasks) to a meeting, each with an owner, due date and priority. They go in the meeting's team.",
    inputSchema: {
      type: "object",
      properties: {
        meeting_id: { type: "string" },
        items: {
          type: "array",
          items: { type: "object", properties: { title: { type: "string" }, owner: { type: "string" }, due_date: { type: "string" }, priority: { type: "string", enum: PRIORITIES } }, required: ["title"] },
        },
      },
      required: ["meeting_id", "items"],
    },
    annotations: WRITE,
    async run(u, a) {
      const meetingId = id(a, "meeting_id");
      const items = listOf(a, "items");
      const out: string[] = [];
      for (const it of items) {
        try {
          out.push((await createTaskFrom(u, { ...it, meeting_id: meetingId })).text);
        } catch (e) {
          out.push(`"${typeof it.title === "string" ? it.title : "?"}" not added: ${e instanceof Error ? e.message : "error"}`);
        }
      }
      return out.join("\n");
    },
  },
];

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
      return (await createTaskFrom(u, a)).text;
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
  ...WORK_TOOLS,
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
