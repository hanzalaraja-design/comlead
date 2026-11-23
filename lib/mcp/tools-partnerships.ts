import "server-only";
import { CATEGORIES, CATEGORY_LABELS, DOMAINS } from "@/lib/domains";
import { personName } from "@/lib/labels";
import { formatDate } from "@/lib/time";
import type { KeyUser } from "@/lib/mcp/keys";
import type { PartnerCategory, ProjectKind } from "@/lib/types";
import { UserError, str, date, oneOf, findProject, failed, strings, listOf, projectLink, READ, WRITE, type Args, type Tool } from "@/lib/mcp/helpers";

/**
 * Partnership categories and tags, journeys, and comments on a project,
 * campaign or partnership. Add and change only: tags are only ever added,
 * never taken off. Notifications (a journey moving on, a new comment) are
 * raised by the database; the connector route sends the pushes after each call.
 */

type Project = { id: string; name: string; slug: string; kind: ProjectKind };

async function findWithSlug(u: KeyUser, name: string): Promise<Project> {
  const p = await findProject(u, name);
  const { data } = await u.db.from("projects").select("slug").eq("id", p.id).single();
  return { ...p, slug: (data?.slug as string) ?? "" };
}

// ---------------------------------------------------------------------------
// Partnership categories and tags
// ---------------------------------------------------------------------------

type TagColor = "gray" | "purple" | "blue" | "green" | "amber" | "pink" | "teal";
/** The app's order for new tag colours (app/(app)/partnerships/actions.ts). */
const COLORS: TagColor[] = ["pink", "teal", "amber", "green", "blue", "purple", "gray"];
type TagRow = { id: string; name: string; category: PartnerCategory; color: TagColor };

const catLabel = (c: string) => CATEGORY_LABELS[c as PartnerCategory] ?? c;

async function allTags(u: KeyUser): Promise<TagRow[]> {
  const { data, error } = await u.db.from("partnership_tags").select("id, name, category, color").order("category").order("name");
  if (error) failed(error, "read the partnership tags");
  return (data ?? []) as TagRow[];
}

async function findPartnership(u: KeyUser, name: string): Promise<Project> {
  const p = await findWithSlug(u, name);
  if (p.kind !== "partnership") throw new UserError(`${p.name} isn't a brand partnership. Categories and tags are only for partnerships.`);
  return p;
}

/** A partnership's current categories and tag ids. */
async function labelsOf(u: KeyUser, projectId: string): Promise<{ categories: PartnerCategory[]; tagIds: string[] }> {
  const { data: p, error } = await u.db.from("projects").select("categories, category").eq("id", projectId).single();
  let categories: PartnerCategory[] = [];
  if (error) {
    // Before the several-categories change: fall back to the single one.
    const { data: old } = await u.db.from("projects").select("category").eq("id", projectId).single();
    if (old?.category) categories = [old.category as PartnerCategory];
  } else {
    const cats = Array.isArray(p?.categories) ? (p.categories as PartnerCategory[]) : [];
    categories = cats.length ? cats : p?.category ? [p.category as PartnerCategory] : [];
  }
  const { data: tags, error: tagError } = await u.db.from("project_tags").select("tag_id").eq("project_id", projectId);
  if (tagError) failed(tagError, "read the partnership's tags");
  return { categories, tagIds: (tags ?? []).map((t) => t.tag_id as string) };
}

function category(v: string): PartnerCategory {
  const c = v.trim().toLowerCase();
  if (!CATEGORIES.includes(c as PartnerCategory)) throw new UserError(`Categories are: ${CATEGORIES.join(", ")}.`);
  return c as PartnerCategory;
}

async function createTag(u: KeyUser, cat: PartnerCategory, name: string): Promise<TagRow> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 40) throw new UserError("Tags are 1 to 40 characters.");
  const { count } = await u.db.from("partnership_tags").select("id", { count: "exact", head: true }).eq("category", cat);
  const color = COLORS[(count ?? 0) % COLORS.length];
  const { data, error } = await u.db
    .from("partnership_tags")
    .insert({ category: cat, name: clean, color, created_by: u.userId })
    .select("id, name, category, color")
    .single();
  if (error?.code === "23505") throw new UserError(`There's already a ${catLabel(cat)} tag called "${clean}".`);
  if (error || !data) failed(error, "create the tag");
  return data as TagRow;
}

function labelsText(categories: string[], tags: TagRow[]): string {
  const cats = categories.length ? categories.map(catLabel).join(", ") : "none";
  const names = tags.length ? tags.map((t) => `${t.name} (${catLabel(t.category)})`).join(", ") : "none";
  return `Categories: ${cats}\nTags: ${names}`;
}

const TAG_TOOLS: Tool[] = [
  {
    name: "list_partnership_tags",
    description:
      "The tags for brand partnerships, grouped by category (associations, referral, fintech). Give a partnership to also see the categories and tags it has now.",
    inputSchema: { type: "object", properties: { partnership: { type: "string", description: "Optional. Its name, e.g. Mobilink." } } },
    annotations: READ,
    async run(u, a) {
      const tags = await allTags(u);
      const out: string[] = [];
      const name = str(a, "partnership");
      if (name) {
        const p = await findPartnership(u, name);
        const now = await labelsOf(u, p.id);
        out.push(`${p.name} (${projectLink(p)})\n${labelsText(now.categories, tags.filter((t) => now.tagIds.includes(t.id)))}\n`);
      }
      out.push("All tags:");
      for (const c of CATEGORIES) {
        const mine = tags.filter((t) => t.category === c);
        out.push(`- ${catLabel(c)}: ${mine.length ? mine.map((t) => t.name).join(", ") : "no tags yet"}`);
      }
      return out.join("\n");
    },
  },
  {
    name: "add_partnership_tags",
    description:
      "Add tags and/or categories to a brand partnership. Keeps everything it already has; nothing is taken off. A tag that doesn't exist yet is created (shared with everyone) in the given category. Adding a tag also adds its category.",
    inputSchema: {
      type: "object",
      properties: {
        partnership: { type: "string", description: "Its name, e.g. Mobilink." },
        tags: { type: "array", items: { type: "string" }, description: "Tag names, e.g. BNPL." },
        categories: { type: "array", items: { type: "string", enum: CATEGORIES } },
        category: { type: "string", enum: CATEGORIES, description: "Where to create any new tags, and which category to look in when a name is in more than one." },
      },
      required: ["partnership"],
    },
    annotations: WRITE,
    async run(u, a) {
      const p = await findPartnership(u, str(a, "partnership") ?? "");
      const wantTags = strings(a, "tags");
      const wantCats = strings(a, "categories").map(category);
      const inCat = str(a, "category") ? category(str(a, "category")!) : null;
      if (!wantTags.length && !wantCats.length) throw new UserError('Give "tags" or "categories" to add.');
      const now = await labelsOf(u, p.id);
      let tags = await allTags(u);
      const cats = new Set<PartnerCategory>([...now.categories, ...wantCats]);
      const tagIds = new Set(now.tagIds);
      const created: TagRow[] = [];
      const added: TagRow[] = [];
      for (const raw of wantTags) {
        const q = raw.trim().replace(/\s+/g, " ").toLowerCase();
        if (!q) continue;
        let hits = tags.filter((t) => t.name.toLowerCase() === q);
        if (hits.length > 1 && inCat) hits = hits.filter((t) => t.category === inCat);
        if (hits.length > 1) throw new UserError(`"${raw}" is a tag in several categories: ${hits.map((t) => catLabel(t.category)).join(", ")}. Say which with "category".`);
        let tag = hits[0];
        if (!tag) {
          // New tag: in the category given, or the partnership's only category.
          const where = inCat ?? (cats.size === 1 ? [...cats][0] : null);
          if (!where) throw new UserError(`There's no tag called "${raw}" yet. Say which category to create it in with "category" (${CATEGORIES.join(", ")}).`);
          tag = await createTag(u, where, raw);
          tags = [...tags, tag];
          created.push(tag);
        }
        if (!tagIds.has(tag.id)) added.push(tag);
        tagIds.add(tag.id);
        cats.add(tag.category);
      }
      if (tagIds.size > 50) throw new UserError("A partnership can have at most 50 tags.");
      const newCats = [...cats].filter((c) => !now.categories.includes(c));
      if (!added.length && !newCats.length) return `${p.name} already has all of those. ${projectLink(p)}`;
      // The RPC sets the whole set, so pass what's there plus what's new.
      const { error } = await u.db.rpc("set_partnership_labels", { p_project: p.id, p_categories: [...cats], p_tags: [...tagIds] });
      if (error) failed(error, `change ${p.name}'s tags (only the people in it can)`);
      const bits = [
        added.length ? `tags ${added.map((t) => t.name).join(", ")}` : null,
        newCats.length ? `categories ${newCats.map(catLabel).join(", ")}` : null,
      ].filter(Boolean);
      return [
        `Added ${bits.join(" and ")} to ${p.name}. ${projectLink(p)}`,
        created.length ? `New tags created: ${created.map((t) => `${t.name} (${catLabel(t.category)})`).join(", ")}.` : null,
        labelsText([...cats], tags.filter((t) => tagIds.has(t.id))),
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
  {
    name: "create_partnership_tag",
    description:
      "Create a new tag for brand partnerships in a category (associations, referral or fintech). Tags are shared with everyone. Give a partnership to put it on that partnership as well.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: CATEGORIES },
        name: { type: "string", description: "Up to 40 characters." },
        partnership: { type: "string", description: "Optional. Put the new tag on this partnership too." },
      },
      required: ["category", "name"],
    },
    annotations: WRITE,
    async run(u, a) {
      const cat = category(str(a, "category") ?? "");
      const p = str(a, "partnership") ? await findPartnership(u, str(a, "partnership")!) : null;
      const tag = await createTag(u, cat, str(a, "name", 60) ?? "");
      const out = `Created the ${catLabel(cat)} tag "${tag.name}".`;
      if (!p) return out;
      const now = await labelsOf(u, p.id);
      const cats = [...new Set([...now.categories, cat])];
      const tagIds = [...new Set([...now.tagIds, tag.id])];
      const { error } = await u.db.rpc("set_partnership_labels", { p_project: p.id, p_categories: cats, p_tags: tagIds });
      if (error) failed(error, `add it to ${p.name} (only the people in it can)`);
      return `${out} Added it to ${p.name}. ${projectLink(p)}`;
    },
  },
];

// ---------------------------------------------------------------------------
// Journeys: parts of a project, each with a stage, fields and a description.
// Moving one on tells the next person (a database trigger does this).
// ---------------------------------------------------------------------------

const JOURNEY_STAGES = ["idea", "drafting", "design", "review", "approved", "live"];
const JOURNEY_STAGE_LABEL: Record<string, string> = { idea: "Idea", drafting: "Drafting", design: "Design", review: "Review", approved: "Approved", live: "Live" };
/** The fields a new journey starts with in the app. */
const JOURNEY_FIELDS = ["Who enters", "Goal", "Leaves when", "Offer"];
type Field = { label: string; value: string };
type JourneyRow = { id: string; name: string; stage: string; starts_on: string | null; ends_on: string | null; description: string | null; fields: Field[] };
const JOURNEY_SELECT = "id, name, stage, starts_on, ends_on, description, fields";

type JourneyProject = Project & { people: Record<string, string> };

async function findJourneyProject(u: KeyUser, name: string): Promise<JourneyProject> {
  const p = await findWithSlug(u, name);
  const { data, error } = await u.db.from("projects").select("has_journeys, journey_people").eq("id", p.id).maybeSingle();
  if (error || !data?.has_journeys) throw new UserError(`${p.name} doesn't use journeys. An admin can turn them on for it.`);
  return { ...p, people: (data.journey_people ?? {}) as Record<string, string> };
}

async function journeysOf(u: KeyUser, projectId: string): Promise<JourneyRow[]> {
  const { data, error } = await u.db.from("project_parts").select(JOURNEY_SELECT).eq("project_id", projectId).eq("kind", "journey").order("sort");
  if (error) failed(error, "read the journeys");
  return ((data ?? []) as JourneyRow[]).map((j) => ({ ...j, fields: Array.isArray(j.fields) ? j.fields : [] }));
}

function findPart<T extends { id: string; name: string }>(parts: T[], which: string, what: string): T {
  const q = which.trim().toLowerCase();
  const hit = parts.filter((t) => t.id === q || t.name.toLowerCase() === q);
  const loose = hit.length ? hit : parts.filter((t) => t.name.toLowerCase().includes(q));
  if (loose.length === 1) return loose[0];
  const names = parts.map((t) => `"${t.name}"`).join(", ") || "none yet";
  if (!loose.length) throw new UserError(`No ${what} called "${which}". There are: ${names}.`);
  throw new UserError(`"${which}" matches several: ${loose.map((t) => `"${t.name}" (id ${t.id})`).join(", ")}. Use the id.`);
}

/** Apply "fields" on top of what's there; a label that exists (any case) has its value replaced. */
function mergeFields(current: Field[], a: Args): Field[] {
  const out = current.map((f) => ({ ...f }));
  for (const f of listOf(a, "fields", 40)) {
    const label = typeof f.label === "string" ? f.label.trim().slice(0, 80) : "";
    if (!label || typeof f.value !== "string") throw new UserError('Each of "fields" needs a label and a value.');
    const value = f.value.trim().slice(0, 2000);
    const at = out.findIndex((x) => x.label.trim().toLowerCase() === label.toLowerCase());
    if (at >= 0) out[at] = { label: out[at].label, value };
    else out.push({ label, value });
  }
  if (out.length > 40) throw new UserError("A journey can have at most 40 fields.");
  return out;
}

function journeyText(j: JourneyRow): string {
  const dates =
    j.starts_on && j.ends_on ? `${formatDate(j.starts_on, "d MMM yyyy")} to ${formatDate(j.ends_on, "d MMM yyyy")}`
    : j.starts_on ? `from ${formatDate(j.starts_on, "d MMM yyyy")}`
    : j.ends_on ? `until ${formatDate(j.ends_on, "d MMM yyyy")}`
    : null;
  const lines = [`- ${j.name} (${[JOURNEY_STAGE_LABEL[j.stage] ?? j.stage, dates].filter(Boolean).join(" · ")})`, `  id: ${j.id}`];
  for (const f of j.fields) if (f.label || f.value) lines.push(`  ${f.label || "Field"}: ${f.value || "(empty)"}`);
  if (j.description) lines.push(`  Description: ${j.description.replace(/\n+/g, " / ")}`);
  return lines.join("\n");
}

const journeyLink = (p: Project, id: string) => `${projectLink(p)}?journey=${id}`;

/** Who the database tells when a journey moves to this stage. */
async function whoHears(u: KeyUser, p: JourneyProject, from: string, to: string): Promise<string | null> {
  const role = to === "review" ? "review" : to === "approved" ? "live" : to === "live" || (from === "review" && ["idea", "drafting", "design"].includes(to)) ? "build" : null;
  const id = role ? p.people[role] : null;
  if (!id || id === u.userId) return null;
  const { data } = await u.db.from("profiles").select("email, full_name").eq("id", id).maybeSingle();
  return data ? personName(data as { email: string; full_name: string | null }) : null;
}

const journeyProps = {
  name: { type: "string", description: "e.g. First order." },
  stage: { type: "string", enum: JOURNEY_STAGES, description: "Moving it to review, approved or live (or back from review) tells the next person." },
  start_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
  end_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
  fields: {
    type: "array",
    description: "Fields as label and value, e.g. Who enters, Goal, Leaves when, Offer. A label that already exists has its value replaced.",
    items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"] },
  },
  description: { type: "string", description: "The journey written out: what it's for, the messages, timings, offers, links. Plain text." },
};

const JOURNEY_TOOLS: Tool[] = [
  {
    name: "list_journeys",
    description: "The journeys of a project (e.g. Journeys): each with its stage (idea, drafting, design, review, approved, live), fields and description.",
    inputSchema: { type: "object", properties: { project: { type: "string", description: "Its name, e.g. Journeys." } }, required: ["project"] },
    annotations: READ,
    async run(u, a) {
      const p = await findJourneyProject(u, str(a, "project") ?? "");
      const list = await journeysOf(u, p.id);
      const url = projectLink(p);
      return list.length ? `Journeys in ${p.name} (${url}):\n${list.map(journeyText).join("\n")}` : `${p.name} has no journeys yet. ${url}`;
    },
  },
  {
    name: "add_journey",
    description:
      "Add a journey to a project that uses journeys. Starts at idea unless you give a stage, with the usual fields (Who enters, Goal, Leaves when, Offer) plus any you give.",
    inputSchema: { type: "object", properties: { project: { type: "string", description: "Its name, e.g. Journeys." }, ...journeyProps }, required: ["project", "name"] },
    annotations: WRITE,
    async run(u, a) {
      const p = await findJourneyProject(u, str(a, "project") ?? "");
      const name = str(a, "name", 120);
      if (!name) throw new UserError("Give the journey a name.");
      const starts = date(a, "start_date") ?? null;
      const ends = date(a, "end_date") ?? null;
      if (starts && ends && ends < starts) throw new UserError("It ends before it starts.");
      const description = str(a, "description", 20000);
      const fields = mergeFields(JOURNEY_FIELDS.map((label) => ({ label, value: "" })), a);
      const { data: last } = await u.db.from("project_parts").select("sort").eq("project_id", p.id).eq("kind", "journey").order("sort", { ascending: false }).limit(1);
      const { data, error } = await u.db
        .from("project_parts")
        .insert({
          project_id: p.id,
          kind: "journey",
          name,
          stage: oneOf(a, "stage", JOURNEY_STAGES) ?? "idea",
          starts_on: starts,
          ends_on: ends,
          description: description || null,
          fields: fields.filter((f) => f.label || f.value),
          extra: {},
          sort: ((last?.[0]?.sort as number | undefined) ?? 0) + 10,
        })
        .select(JOURNEY_SELECT)
        .single();
      if (error || !data) failed(error, `add a journey to ${p.name} (only the people in it can)`);
      const j = data as JourneyRow;
      return `Added the journey to ${p.name}. ${journeyLink(p, j.id)}\n${journeyText(j)}`;
    },
  },
  {
    name: "update_journey",
    description:
      "Change a journey: its name, stage, dates, fields or description. Only send what changes. Moving it to review, approved or live (or back from review) tells the next person.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Its name, e.g. Journeys." },
        journey: { type: "string", description: "The journey's current name or id (from list_journeys)." },
        ...journeyProps,
      },
      required: ["project", "journey"],
    },
    annotations: WRITE,
    async run(u, a) {
      const p = await findJourneyProject(u, str(a, "project") ?? "");
      const j = findPart(await journeysOf(u, p.id), str(a, "journey") ?? "", "journey");
      const patch: Record<string, unknown> = {};
      const name = str(a, "name", 120);
      if (name) patch.name = name;
      const stage = oneOf(a, "stage", JOURNEY_STAGES);
      if (stage && stage !== j.stage) patch.stage = stage;
      const starts = date(a, "start_date");
      if (starts !== undefined) patch.starts_on = starts;
      const ends = date(a, "end_date");
      if (ends !== undefined) patch.ends_on = ends;
      const s = starts !== undefined ? starts : j.starts_on;
      const e = ends !== undefined ? ends : j.ends_on;
      if (s && e && e < s) throw new UserError("It would end before it starts.");
      if (typeof a.description === "string") patch.description = a.description.trim().slice(0, 20000) || null;
      const fields = mergeFields(j.fields, a);
      if (JSON.stringify(fields) !== JSON.stringify(j.fields)) patch.fields = fields.filter((f) => f.label || f.value);
      if (!Object.keys(patch).length) return `Nothing to change on "${j.name}".`;
      const { data, error } = await u.db.from("project_parts").update(patch).eq("id", j.id).select(JOURNEY_SELECT);
      if (error) failed(error, "change the journey");
      if (!data?.length) throw new UserError(`Only the people in ${p.name} can change its journeys.`);
      const told = stage && patch.stage ? await whoHears(u, p, j.stage, stage) : null;
      return [
        `Updated "${j.name}" in ${p.name}. ${journeyLink(p, j.id)}`,
        patch.stage ? `Moved from ${JOURNEY_STAGE_LABEL[j.stage] ?? j.stage} to ${JOURNEY_STAGE_LABEL[stage!]}.${told ? ` ${told} has been told.` : ""}` : null,
        journeyText(data[0] as JourneyRow),
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
];

// ---------------------------------------------------------------------------
// Comments on a project, campaign or partnership (or one of its terms or
// journeys). Everyone else in it is told by the database.
// ---------------------------------------------------------------------------

const COMMENT_TOOLS: Tool[] = [
  {
    name: "comment_project",
    description:
      "Comment on a project, campaign or partnership. Give a term or journey (by name) to comment on that part of it. Everyone else in it is notified.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "The project, campaign or partnership, e.g. 11.11 or Mobilink." },
        text: { type: "string", description: "The comment. Plain text." },
        part: { type: "string", description: "Optional. The name or id of a term (partnerships) or journey to comment on." },
      },
      required: ["project", "text"],
    },
    annotations: WRITE,
    async run(u, a) {
      const p = await findWithSlug(u, str(a, "project") ?? "");
      const text = str(a, "text", 10000);
      if (!text) throw new UserError("Write something first.");
      let part: { id: string; name: string; kind: string } | null = null;
      const which = str(a, "part", 120);
      if (which) {
        const { data, error } = await u.db.from("project_parts").select("id, name, kind").eq("project_id", p.id).order("sort");
        if (error) failed(error, "read its terms and journeys");
        part = findPart((data ?? []) as { id: string; name: string; kind: string }[], which, "term or journey");
      }
      const { error } = await u.db.from("project_comments").insert({ project_id: p.id, author_id: u.userId, body: text, ...(part ? { part_id: part.id } : {}) });
      if (error) failed(error, `comment on ${p.name} (only the people in it can)`);
      const where = part ? `the ${part.kind} "${part.name}" in ${p.name}` : `${DOMAINS[p.kind].label.toLowerCase()} ${p.name}`;
      const url = part?.kind === "journey" ? journeyLink(p, part.id) : projectLink(p);
      return `Commented on ${where}. ${url}`;
    },
  },
];

export const PARTNERSHIP_TOOLS: Tool[] = [...TAG_TOOLS, ...JOURNEY_TOOLS, ...COMMENT_TOOLS];
