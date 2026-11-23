import "server-only";
import { siteUrl } from "@/lib/calendar/sync";
import { syncLater } from "@/lib/calendar/schedule";
import { syncTask } from "@/lib/calendar/sync";
import { DOMAINS } from "@/lib/domains";
import { personName } from "@/lib/labels";
import { addDaysISO, formatDate, todayPKT } from "@/lib/time";
import { PLACEMENT_COLUMNS, slotName, surfacesText, type Placement, type Section } from "@/lib/placements";
import { CHANNELS, CHANNEL_LABELS, CREATIVE_COLUMNS, STATUS_LABELS, type Channel, type CreativeRequest } from "@/lib/creative";
import { notifyPersonLater, notifyTeamLater, placementsPath, placementsUrl, requestPath, requestUrl } from "@/lib/notify";
import type { KeyUser } from "@/lib/mcp/keys";
import type { ProjectKind } from "@/lib/types";

/**
 * What Claude can do in Highfy Tasks: read and search, create and update.
 * Nothing here deletes. Every call runs as the person whose key it is, so the
 * database's own rules decide what they can see and change.
 */

import {
  UserError,
  OPEN,
  STATUSES,
  NEW_STATUSES,
  UUID,
  PRIORITIES,
  SELECT,
  link,
  line,
  list,
  str,
  date,
  oneOf,
  id,
  time,
  doneOn,
  webLink,
  findPart,
  richText,
  findPerson,
  findTeam,
  findProject,
  failed,
  setCollaborators,
  strings,
  createTaskFrom,
  READ,
  WRITE,
  KINDS,
  listOf,
  idsOf,
  projectLink,
  surfacesOf,
  findSection,
  addPeopleAndTeams,
  insertProject,
  type Args,
  type Tool,
  type Row,
} from "@/lib/mcp/helpers";

// ---------------------------------------------------------------------------
// Terms of a brand partnership: each period of the deal on its own, with a
// stage, dates, the standard fields and a description. Add and change only.
// ---------------------------------------------------------------------------

/** Fields a new task takes, shared by create_task and create_tasks. */
const NEW_TASK_PROPS = {
  title: { type: "string" },
  description: { type: "string", description: "Notes. Plain text is fine." },
  owner: { type: "string", description: "Email or name, or 'me'. Default: me." },
  owners: { type: "array", items: { type: "string" }, description: "Several owners: each gets their own copy, linked as a set, so each can tick it off." },
  due_date: { type: "string", description: "YYYY-MM-DD" },
  due_time: { type: "string", description: "HH:MM, 24-hour. Needs a due_date." },
  status: { type: "string", enum: NEW_STATUSES, description: "Default todo." },
  blocked_reason: { type: "string", description: "Why it's blocked (with status blocked)." },
  done_on: { type: "string", description: "YYYY-MM-DD, today or earlier: it's already done, on that day." },
  priority: { type: "string", enum: PRIORITIES, description: "Default medium." },
  team: { type: "string", description: "Team name, e.g. Marketing." },
  project: { type: "string", description: "Project, campaign or partnership name." },
  part: { type: "string", description: "A term or journey of that project, by name or id. Needs project." },
  private: { type: "boolean", description: "true: a private task with no team or project (only you, the owner and collaborators see it). Ignored when a team or project is given." },
  collaborators: { type: "array", items: { type: "string" }, description: "Emails or names." },
  parent_task_id: { type: "string", description: "Make it a subtask of this task." },
  meeting_id: { type: "string", description: "Make it an action item of this meeting." },
};

const TERM_STAGES = ["draft", "in_talks", "agreed", "live", "ended"];
const TERM_STAGE_LABEL: Record<string, string> = { draft: "Draft", in_talks: "In talks", agreed: "Signed / agreed", live: "Live", ended: "Ended" };
/** The app's standard term fields, in the order the Terms panel shows them. */
const TERM_FIELDS: [arg: string, label: string][] = [
  ["discount", "Discount"],
  ["commission", "Our commission"],
  ["what_we_give", "What we give"],
  ["what_they_give", "What they give"],
  ["promo_code", "Promo code"],
];
type TermField = { label: string; value: string };
type TermRow = {
  id: string;
  name: string;
  stage: string;
  starts_on: string | null;
  ends_on: string | null;
  description: string | null;
  fields: TermField[];
  renewed_from: string | null;
};
const TERM_SELECT = "id, name, stage, starts_on, ends_on, description, fields, renewed_from";

const termProps = {
  name: { type: "string", description: "e.g. Nov to Dec 2026, or 2027." },
  stage: { type: "string", enum: TERM_STAGES },
  start_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
  end_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
  discount: { type: "string" },
  commission: { type: "string", description: "Our commission." },
  what_we_give: { type: "string" },
  what_they_give: { type: "string" },
  promo_code: { type: "string" },
  other_fields: {
    type: "array",
    description: "Any other fields, as label and value. A label that already exists is replaced.",
    items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"] },
  },
  description: { type: "string", description: "Anything else worth knowing. Plain text." },
};

async function findPartnership(u: KeyUser, name: string): Promise<{ id: string; name: string; slug: string; kind: ProjectKind }> {
  const p = await findProject(u, name);
  if (p.kind !== "partnership") throw new UserError(`${p.name} isn't a brand partnership. Terms are only for partnerships.`);
  const { data } = await u.db.from("projects").select("slug").eq("id", p.id).single();
  return { ...p, slug: (data?.slug as string) ?? "" };
}

async function termsOf(u: KeyUser, projectId: string): Promise<TermRow[]> {
  const { data, error } = await u.db.from("project_parts").select(TERM_SELECT).eq("project_id", projectId).eq("kind", "term").order("sort");
  if (error) failed(error, "read the terms");
  return ((data ?? []) as TermRow[]).map((t) => ({ ...t, fields: Array.isArray(t.fields) ? t.fields : [] }));
}

function findTerm(terms: TermRow[], which: string): TermRow {
  const q = which.trim().toLowerCase();
  const hit = terms.filter((t) => t.id === q || t.name.toLowerCase() === q);
  const loose = hit.length ? hit : terms.filter((t) => t.name.toLowerCase().includes(q));
  if (loose.length === 1) return loose[0];
  const names = terms.map((t) => `"${t.name}"`).join(", ") || "none yet";
  if (!loose.length) throw new UserError(`No term called "${which}". Terms: ${names}.`);
  throw new UserError(`"${which}" matches several terms: ${loose.map((t) => `"${t.name}" (id ${t.id})`).join(", ")}. Use the id.`);
}

/** Apply the field arguments on top of what's there; labels match without caring about case. */
function mergeFields(current: TermField[], a: Args): TermField[] {
  const out = current.map((f) => ({ ...f }));
  const put = (label: string, value: string) => {
    const at = out.findIndex((f) => f.label.trim().toLowerCase() === label.trim().toLowerCase());
    if (at >= 0) out[at] = { label: out[at].label, value };
    else out.push({ label, value });
  };
  for (const [arg, label] of TERM_FIELDS) {
    if (typeof a[arg] === "string") put(label, (a[arg] as string).trim().slice(0, 2000));
    else if (a[arg] !== undefined && a[arg] !== null) throw new UserError(`"${arg}" should be text.`);
  }
  for (const f of listOf(a, "other_fields", 40)) {
    const label = typeof f.label === "string" ? f.label.trim().slice(0, 80) : "";
    if (!label || typeof f.value !== "string") throw new UserError('Each of "other_fields" needs a label and a value.');
    put(label, f.value.trim().slice(0, 2000));
  }
  if (out.length > 40) throw new UserError("A term can have at most 40 fields.");
  return out;
}

function termText(t: TermRow): string {
  const dates =
    t.starts_on && t.ends_on ? `${formatDate(t.starts_on, "d MMM yyyy")} to ${formatDate(t.ends_on, "d MMM yyyy")}`
    : t.starts_on ? `from ${formatDate(t.starts_on, "d MMM yyyy")}`
    : t.ends_on ? `until ${formatDate(t.ends_on, "d MMM yyyy")}`
    : "no dates yet";
  const lines = [`- ${t.name} (${TERM_STAGE_LABEL[t.stage] ?? t.stage} · ${dates})`, `  id: ${t.id}`];
  for (const f of t.fields) if (f.label || f.value) lines.push(`  ${f.label || "Field"}: ${f.value || "(empty)"}`);
  if (t.description) lines.push(`  Description: ${t.description.replace(/\n+/g, " / ")}`);
  return lines.join("\n");
}

const TERM_TOOLS: Tool[] = [
  {
    name: "list_terms",
    description: "The terms of a brand partnership: each period of the deal, with its stage, dates, fields and description.",
    inputSchema: { type: "object", properties: { partnership: { type: "string", description: "Its name, e.g. Mobilink." } }, required: ["partnership"] },
    annotations: READ,
    async run(u, a) {
      const p = await findPartnership(u, str(a, "partnership") ?? "");
      const terms = await termsOf(u, p.id);
      const url = projectLink(p);
      return terms.length ? `Terms for ${p.name} (${url}):\n${terms.map(termText).join("\n")}` : `${p.name} has no terms yet. ${url}`;
    },
  },
  {
    name: "add_term",
    description:
      "Add a term to a brand partnership: a period of the deal with its stage, dates, discount, our commission, what we give, what they give, promo code, other fields and a description. Starts as a draft unless you give a stage. renew_from copies an earlier term's fields first, for a renewal.",
    inputSchema: {
      type: "object",
      properties: {
        partnership: { type: "string", description: "Its name, e.g. Mobilink." },
        ...termProps,
        renew_from: { type: "string", description: "Name or id of the term this one renews. Its fields are copied, then yours apply." },
      },
      required: ["partnership", "name"],
    },
    annotations: WRITE,
    async run(u, a) {
      const p = await findPartnership(u, str(a, "partnership") ?? "");
      const name = str(a, "name", 120);
      if (!name) throw new UserError("Give the term a name, e.g. Nov to Dec 2026.");
      const terms = await termsOf(u, p.id);
      const from = str(a, "renew_from") ? findTerm(terms, str(a, "renew_from")!) : null;
      const starts = date(a, "start_date") ?? null;
      const ends = date(a, "end_date") ?? null;
      if (starts && ends && ends < starts) throw new UserError("It ends before it starts.");
      const base = from ? from.fields : TERM_FIELDS.map(([, label]) => ({ label, value: "" }));
      const description = str(a, "description", 20000);
      const { data: last } = await u.db.from("project_parts").select("sort").eq("project_id", p.id).eq("kind", "term").order("sort", { ascending: false }).limit(1);
      const { data, error } = await u.db
        .from("project_parts")
        .insert({
          project_id: p.id,
          kind: "term",
          name,
          stage: oneOf(a, "stage", TERM_STAGES) ?? "draft",
          starts_on: starts,
          ends_on: ends,
          description: description || null,
          fields: mergeFields(base, a).filter((f) => f.label || f.value),
          extra: {},
          sort: ((last?.[0]?.sort as number | undefined) ?? 0) + 10,
          renewed_from: from?.id ?? null,
        })
        .select(TERM_SELECT)
        .single();
      if (error || !data) failed(error, `add a term to ${p.name} (only the people in it can)`);
      return `Added the term to ${p.name}. ${projectLink(p)}\n${termText(data as TermRow)}`;
    },
  },
  {
    name: "update_term",
    description:
      "Change a term of a brand partnership: its name, stage, dates, any field or the description. Only send what changes; fields you leave out stay as they are.",
    inputSchema: {
      type: "object",
      properties: {
        partnership: { type: "string", description: "Its name, e.g. Mobilink." },
        term: { type: "string", description: "The term's current name or id (from list_terms)." },
        ...termProps,
      },
      required: ["partnership", "term"],
    },
    annotations: WRITE,
    async run(u, a) {
      const p = await findPartnership(u, str(a, "partnership") ?? "");
      const t = findTerm(await termsOf(u, p.id), str(a, "term") ?? "");
      const patch: Record<string, unknown> = {};
      const name = str(a, "name", 120);
      if (name) patch.name = name;
      const stage = oneOf(a, "stage", TERM_STAGES);
      if (stage) patch.stage = stage;
      const starts = date(a, "start_date");
      if (starts !== undefined) patch.starts_on = starts;
      const ends = date(a, "end_date");
      if (ends !== undefined) patch.ends_on = ends;
      const s = starts !== undefined ? starts : t.starts_on;
      const e = ends !== undefined ? ends : t.ends_on;
      if (s && e && e < s) throw new UserError("It would end before it starts.");
      if (typeof a.description === "string") patch.description = a.description.trim().slice(0, 20000) || null;
      const fields = mergeFields(t.fields, a);
      if (JSON.stringify(fields) !== JSON.stringify(t.fields)) patch.fields = fields.filter((f) => f.label || f.value);
      if (!Object.keys(patch).length) return `Nothing to change on "${t.name}".`;
      const { data, error } = await u.db.from("project_parts").update(patch).eq("id", t.id).select(TERM_SELECT);
      if (error) failed(error, "change the term");
      if (!data?.length) throw new UserError(`Only the people in ${p.name} can change its terms.`);
      return `Updated "${t.name}" on ${p.name}. ${projectLink(p)}\n${termText(data[0] as TermRow)}`;
    },
  },
];

const WORK_TOOLS: Tool[] = [
  {
    name: "create_project",
    description:
      "Create a project, campaign or partnership (you become an owner). Owners can lock it; teams decide whose lists it shows in; members are the people working on it. Brand partnerships can have a category: associations, referral or fintech. Dates are YYYY-MM-DD.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: KINDS },
        name: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        description: { type: "string", description: "The brief. Plain text is fine." },
        category: { type: "string", enum: ["associations", "referral", "fintech"], description: "Brand partnerships only." },
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
      const category = kind === "partnership" ? (oneOf(a, "category", ["associations", "referral", "fintech"]) ?? null) : null;
      const start = date(a, "start_date") ?? null;
      const end = date(a, "end_date") ?? null;
      if (start && end && end < start) throw new UserError("The end date is before the start.");
      const description = str(a, "description", 50000);
      const p = await insertProject(u, {
        name,
        kind,
        category,
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
      "Change a project, campaign or partnership: name, type (project, campaign or partnership), dates, brief, a partnership's categories, and add owners, members or teams. Only send what changes. add_owners also makes someone who's already a member an owner. Locked ones can only be changed by their owners.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Its current name." },
        name: { type: "string" },
        kind: { type: "string", enum: KINDS, description: "Change its type. Leaving partnership clears its categories." },
        start_date: { type: ["string", "null"] },
        end_date: { type: ["string", "null"] },
        description: { type: "string", description: "Replaces the brief." },
        category: { type: "string", enum: ["associations", "referral", "fintech"], description: "Partnerships: one category. For several, use categories." },
        categories: {
          type: "array",
          items: { type: "string", enum: ["associations", "referral", "fintech"] },
          description: "Partnerships: all the categories it's in (replaces the ones it has; its tags stay).",
        },
        add_owners: { type: "array", items: { type: "string" }, description: "New people, or members to make owners." },
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
      const kind = (oneOf(a, "kind", KINDS) as ProjectKind | undefined) ?? found.kind;
      if (kind !== found.kind) {
        patch.kind = kind;
        // As the app does: only a partnership has a category.
        if (kind !== "partnership") patch.category = null;
      }
      const category = oneOf(a, "category", ["associations", "referral", "fintech"]);
      if (category && kind === "partnership") patch.category = category;
      let categories: string[] | null = null;
      if (Array.isArray(a.categories)) {
        if (kind !== "partnership") throw new UserError("Only a brand partnership has categories.");
        categories = [...new Set(strings(a, "categories").map((c) => c.trim().toLowerCase()))];
        const bad = categories.filter((c) => !["associations", "referral", "fintech"].includes(c));
        if (bad.length) throw new UserError(`"categories" can only be: associations, referral, fintech.`);
      }
      if (Object.keys(patch).length) {
        const { data, error } = await u.db.from("projects").update(patch).eq("id", found.id).select("id");
        if (error) failed(error, "change it");
        if (!data?.length) throw new UserError("It's locked: only its owners can change it.");
      }
      if (categories) {
        // The app sets categories and tags together; keep the tags it has.
        const { data: tags } = await u.db.from("project_tags").select("tag_id").eq("project_id", found.id);
        const { error } = await u.db.rpc("set_partnership_labels", { p_project: found.id, p_categories: categories, p_tags: (tags ?? []).map((t) => t.tag_id as string) });
        if (error) failed(error, "change its categories");
      }
      await addPeopleAndTeams(u, found.id, strings(a, "add_owners"), strings(a, "add_members"), strings(a, "add_teams"));
      const { data: p } = await u.db.from("projects").select("slug, kind").eq("id", found.id).single();
      return `Updated ${found.name}. ${projectLink(p as { slug: string; kind: ProjectKind })}`;
    },
  },
  {
    name: "duplicate_campaign",
    description:
      "Make a new campaign (or project/partnership) from an existing one: same owners, teams, members, brief and type, plus copies of the tasks you pick (task_ids from search_tasks with project=...; leave out to copy all), with their subtasks. Copies start as To do, keep their owners, and their due dates move by the gap between the two start dates.",
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

      let q = u.db.from("tasks").select("id, title, description, owner_id, department_id, due_date, due_time").eq("project_id", src.id).is("parent_task_id", null).is("deleted_at", null).neq("status", "cancelled");
      if (Array.isArray(a.task_ids)) q = q.in("id", idsOf(a, "task_ids", 300));
      const { data: mains } = await q.limit(300);
      type T = { id: string; title: string; description: string | null; owner_id: string | null; department_id: string | null; due_date: string | null; due_time: string | null };
      const move = (d: string | null) => (d ? addDaysISO(d, shift) : null);
      let copied = 0;
      let subs = 0;
      const missed: string[] = [];
      for (const t of (mains ?? []) as T[]) {
        const { data: made, error } = await u.db
          .from("tasks")
          .insert({ title: t.title, description: t.description, owner_id: t.owner_id, department_id: t.department_id, project_id: p.id, due_date: move(t.due_date), due_time: t.due_time, created_by: u.userId })
          .select("id")
          .single();
        if (error || !made) {
          missed.push(`${t.title} (${error?.message ?? "not allowed"})`);
          continue;
        }
        copied++;
        const { data: children } = await u.db.from("tasks").select("title, description, owner_id, due_date, due_time").eq("parent_task_id", t.id).is("deleted_at", null).neq("status", "cancelled");
        for (const c of (children ?? []) as Omit<T, "id" | "department_id">[]) {
          const { error: ce } = await u.db.from("tasks").insert({ title: c.title, description: c.description, owner_id: c.owner_id, parent_task_id: made.id, due_date: move(c.due_date), due_time: c.due_time, created_by: u.userId });
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
          items: { type: "object", properties: NEW_TASK_PROPS, required: ["title"] },
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
        products: { type: "string", description: "Which products to show (category icons ask for this)." },
        notes: { type: "string", description: "For Design." },
        link: { type: "string", description: "Where the banner goes: a web address (http or https)." },
        project: { type: "string", description: "The project, campaign or partnership it's for (one you're in). Adds a done task there saying what was booked." },
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
      const products = str(a, "products", 1000) ?? (s.kind === "icons" ? text : null);
      const url = webLink(a, "link");
      const project = str(a, "project") ? await findProject(u, str(a, "project")!) : null;
      const { data, error } = await u.db
        .from("placements")
        .insert({
          section_key: s.key,
          position: slot,
          brand,
          comms: s.kind === "icons" ? null : text,
          products,
          notes: str(a, "notes", 2000) ?? null,
          starts_on: start,
          ends_on: end,
          shows_on: surfacesOf(a) ?? ["web", "app"],
          // Left out when not given, as the app does.
          ...(url ? { link: url } : {}),
          ...(project ? { project_id: project.id } : {}),
          created_by: u.userId,
        })
        .select("id")
        .single();
      if (error || !data) failed(error, "book that slot");
      notifyTeamLater("design", "design_new", {
        title: `${u.name} booked ${brand} in ${slotName(s, slot)} (via Claude): needs a banner`,
        body: [`From ${start}${end ? ` to ${end}` : ""}`, text].filter(Boolean).join(" · "),
        href: placementsPath(data!.id as string),
        actorId: u.userId,
      });
      return `Booked ${slotName(s, slot)} for ${brand} from ${formatDate(start, "d MMM")}${end ? ` to ${formatDate(end, "d MMM")}` : " (ongoing)"}${project ? `, for ${project.name}` : ""}. Design has been told. id ${data!.id} · ${placementsUrl(data!.id as string)}`;
    },
  },
  {
    name: "update_booking",
    description:
      "Change a homepage booking you made (or any, if you're in Commercial): brand, banner text, products, notes, link, the project it's for, dates or where it shows. If the banner was already made and the brand, text or products change, Design is asked to update it.",
    inputSchema: {
      type: "object",
      properties: {
        booking_id: { type: "string" },
        brand: { type: "string" },
        text: { type: "string" },
        products: { type: "string", description: "Which products to show; empty text clears it." },
        notes: { type: "string" },
        link: { type: "string", description: "Where the banner goes (http or https); empty text clears it." },
        project: { type: "string", description: "The project, campaign or partnership it's for (one you're in); empty text unlinks." },
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
      if (typeof a.products === "string") patch.products = a.products.trim().slice(0, 1000) || null;
      if (typeof a.notes === "string") patch.notes = a.notes.trim().slice(0, 2000) || null;
      if (a.link === "") patch.link = null;
      else if (a.link !== undefined) patch.link = webLink(a, "link");
      if (a.project === "") patch.project_id = null;
      else if (str(a, "project")) patch.project_id = (await findProject(u, str(a, "project")!)).id;
      const start = date(a, "start_date");
      if (start) patch.starts_on = start;
      const end = date(a, "end_date");
      if (end !== undefined) patch.ends_on = end;
      const shows = surfacesOf(a);
      if (shows) patch.shows_on = shows;
      if (!Object.keys(patch).length) throw new UserError("Nothing to change.");
      const textChanged =
        (patch.brand !== undefined && patch.brand !== p.brand) ||
        (patch.comms !== undefined && patch.comms !== p.comms) ||
        (patch.products !== undefined && patch.products !== p.products);
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
    description: "Add action items (tasks) to a meeting, each with an owner and due date. They go in the meeting's team.",
    inputSchema: {
      type: "object",
      properties: {
        meeting_id: { type: "string" },
        items: {
          type: "array",
          items: { type: "object", properties: { title: { type: "string" }, owner: { type: "string" }, due_date: { type: "string" } }, required: ["title"] },
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
  ...TERM_TOOLS,
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
      "Create a task. Give a team, or a project, campaign or partnership; with neither, set private: true for a private task (otherwise, if you're only in one team it goes there). Give parent_task_id to make it a subtask, meeting_id to make it a meeting action item, part for a term or journey of its project. Several owners get one copy each. done_on logs something already done. Dates are YYYY-MM-DD.",
    inputSchema: { type: "object", properties: NEW_TASK_PROPS, required: ["title"] },
    annotations: WRITE,
    async run(u, a) {
      return (await createTaskFrom(u, a)).text;
    },
  },
  {
    name: "update_task",
    description:
      "Change a task: title, notes, status, due date and time (null clears them), owner, priority, main team, project/campaign/partnership (empty text unlinks), its term or journey in that project, the meeting it came from, when it was done, or collaborators. Only send what changes. Locked tasks can only be changed by their owner.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        title: { type: "string" },
        description: { type: "string", description: "Replaces the notes." },
        status: { type: "string", enum: STATUSES },
        blocked_reason: { type: "string", description: "Why it's blocked (with status blocked)." },
        due_date: { type: ["string", "null"], description: "YYYY-MM-DD, or null to clear (clears the time too)." },
        due_time: { type: ["string", "null"], description: "HH:MM, 24-hour, or null to clear. Needs a due date." },
        owner: { type: "string", description: "Email or name, or 'me'." },
        priority: { type: "string", enum: PRIORITIES },
        team: { type: "string", description: "Its main team. For more teams, use set_task_teams." },
        project: { type: "string", description: "Project, campaign or partnership name; empty text to unlink." },
        part: { type: ["string", "null"], description: "A term or journey of the task's project, by name or id; empty text or null to take it out." },
        meeting_id: { type: ["string", "null"], description: "Link it to this meeting (from list_meetings); null to unlink." },
        done_on: { type: "string", description: "YYYY-MM-DD, today or earlier: the day it was done. Marks it done if it isn't. Only the task's owner can." },
        add_collaborators: { type: "array", items: { type: "string" } },
        remove_collaborators: { type: "array", items: { type: "string" } },
      },
      required: ["task_id"],
    },
    annotations: WRITE,
    async run(u, a) {
      const taskId = id(a, "task_id");
      const { data: cur } = await u.db.from("tasks").select("owner_id, project_id, due_date, status").eq("id", taskId).maybeSingle();
      if (!cur) throw new UserError("No task with that id that you can see.");
      const patch: Record<string, unknown> = {};
      const title = str(a, "title");
      if (title) patch.title = title;
      if (typeof a.description === "string") patch.description = a.description.trim() ? richText(a.description.slice(0, 20000)) : null;
      const status = oneOf(a, "status", STATUSES);
      if (status) {
        patch.status = status;
        if (status === "blocked") patch.blocked_reason = str(a, "blocked_reason", 1000) ?? null;
      }
      const due = date(a, "due_date");
      if (due !== undefined) {
        patch.due_date = due;
        if (due === null) patch.due_time = null;
      }
      const dueTime = time(a, "due_time");
      if (dueTime !== undefined && due !== null) {
        if (dueTime && !(due ?? cur.due_date)) throw new UserError("Give it a due date first, then a time.");
        patch.due_time = dueTime;
      }
      const owner = str(a, "owner");
      if (owner) patch.owner_id = (await findPerson(u, owner)).id;
      const priority = oneOf(a, "priority", PRIORITIES);
      if (priority) patch.priority = priority;
      const team = str(a, "team");
      if (team) patch.department_id = (await findTeam(u, team)).id;
      if (a.project === "") patch.project_id = null;
      else if (str(a, "project")) patch.project_id = (await findProject(u, str(a, "project")!)).id;
      if (a.part === "" || a.part === null) patch.part_id = null;
      else if (str(a, "part")) {
        const projectId = patch.project_id !== undefined ? (patch.project_id as string | null) : (cur.project_id as string | null);
        if (!projectId) throw new UserError("A term or journey belongs to a project; this task isn't in one.");
        patch.part_id = (await findPart(u, projectId, str(a, "part")!)).id;
      }
      if (a.meeting_id === null || a.meeting_id === "") patch.meeting_id = null;
      else if (a.meeting_id !== undefined) {
        const meetingId = str(a, "meeting_id", 60);
        if (!meetingId || !UUID.test(meetingId)) throw new UserError('"meeting_id" should be a meeting id (from list_meetings).');
        const { data: m } = await u.db.from("meetings").select("id").eq("id", meetingId).maybeSingle();
        if (!m) throw new UserError("No meeting with that id that you can see.");
        patch.meeting_id = meetingId;
      }
      const doneAt = doneOn(a);
      if (doneAt) {
        if (cur.owner_id !== u.userId) throw new UserError("Only the task's owner can say when it was done.");
        if (status && status !== "done") throw new UserError("done_on marks it done; leave out status or set it to done.");
        patch.status = "done";
        patch.completed_at = doneAt;
      }

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
    name: "set_task_teams",
    description:
      "More teams for a task, so it shows in each team's list too (besides its main team). add_teams adds to the ones it has; teams makes its extra teams exactly that list (at least one). To change its main team, use update_task.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        add_teams: { type: "array", items: { type: "string" }, description: "Team names to add." },
        teams: { type: "array", items: { type: "string" }, description: "The full list of extra teams it should have. At least one." },
      },
      required: ["task_id"],
    },
    annotations: WRITE,
    async run(u, a) {
      const taskId = id(a, "task_id");
      const add = strings(a, "add_teams");
      const replace = a.teams === undefined || a.teams === null ? null : strings(a, "teams");
      if (replace && !replace.length) throw new UserError('Give at least one team in "teams", or use add_teams.');
      if (!replace && !add.length) throw new UserError('Give "add_teams" or "teams".');
      const { data: task } = await u.db.from("tasks").select("department_id").eq("id", taskId).maybeSingle();
      if (!task) throw new UserError("No task with that id that you can see.");
      const { data: current, error: readErr } = await u.db.from("task_teams").select("department_id").eq("task_id", taskId);
      if (readErr) failed(readErr, "read its teams");
      const have = new Set((current ?? []).map((t) => t.department_id as string));
      const want = new Set(replace ? [] : have);
      for (const name of [...(replace ?? []), ...add]) {
        const t = await findTeam(u, name);
        if (t.id !== task.department_id) want.add(t.id);
      }
      if (!want.size) throw new UserError("That's already its main team.");
      const toAdd = [...want].filter((d) => !have.has(d));
      const toRemove = [...have].filter((d) => !want.has(d));
      if (want.size > 30) throw new UserError("At most 30 teams on a task.");
      if (toAdd.length) {
        const { error } = await u.db.from("task_teams").insert(toAdd.map((department_id) => ({ task_id: taskId, department_id })));
        if (error) failed(error, "add those teams");
      }
      if (toRemove.length) {
        const { error } = await u.db.from("task_teams").delete().eq("task_id", taskId).in("department_id", toRemove);
        if (error) failed(error, "change its teams");
      }
      const { data: teams } = await u.db.rpc("team_directory");
      const names = ((teams ?? []) as { id: string; name: string }[]).filter((t) => want.has(t.id)).map((t) => t.name);
      return `Its extra teams are now: ${names.join(", ")}. ${link(taskId)}`;
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to a task, as the signed-in person. Mention people (names or emails) to tag them, as the app's @mentions do: they become collaborators and get it in their inbox.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        text: { type: "string" },
        mention: { type: "array", items: { type: "string" }, description: "People to tag, by name or email." },
      },
      required: ["task_id", "text"],
    },
    annotations: WRITE,
    async run(u, a) {
      const taskId = id(a, "task_id");
      const text = str(a, "text", 10000);
      if (!text) throw new UserError("Write the comment in \"text\".");
      const tagged: { id: string; label: string }[] = [];
      for (const who of strings(a, "mention")) {
        const p = await findPerson(u, who);
        if (p.id !== u.userId && !tagged.some((t) => t.id === p.id)) tagged.push(p);
      }
      const { data, error } = await u.db.from("task_comments").insert({ task_id: taskId, author_id: u.userId, body: text }).select("id").single();
      if (error || !data) failed(error, "comment on that task");
      if (tagged.length) {
        // Tagged people become collaborators, so they can open the task, and get it in their inbox.
        const { error: mErr } = await u.db.rpc("add_comment_mentions", { p_comment_id: data!.id, p_user_ids: tagged.map((t) => t.id) });
        if (mErr) failed(mErr, "tag those people (the comment was added)");
      }
      return `Comment added${tagged.length ? `, tagging ${tagged.map((t) => t.label).join(", ")}` : ""}. ${link(taskId)}#comments`;
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

