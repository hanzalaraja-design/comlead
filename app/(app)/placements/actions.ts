"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { notifyTeamLater, placementsPath } from "@/lib/notify";
import { personName } from "@/lib/labels";
import { PLACEMENT_COLUMNS, SURFACE_LABELS, datesText, slotName, type Placement, type Section, type Surface } from "@/lib/placements";
import { formatPKT, todayPKT } from "@/lib/time";
import { describeActivity } from "@/lib/activity";
import { flushPush } from "@/lib/push";
import type { ActivityEntry, PersonRef } from "@/lib/types";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable();

const bookingSchema = z.object({
  brand: z.string().trim().min(1, "Add the brand.").max(120),
  starts_on: date,
  ends_on: date.nullable(),
  comms: text(300),
  products: text(1000),
  notes: text(2000),
  inspo_paths: z.array(z.string().max(300)).max(10),
  // Where the banner goes. Left out when empty, so bookings still save before the database has links.
  link: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : undefined)),
  // The project, campaign or partnership it's for. Left out when never set, so bookings save before the database has links.
  project_id: z.string().uuid().nullable().optional(),
  // Website, app or both.
  shows_on: z
    .array(z.enum(["web", "app"]))
    .min(1, "Pick the website, the app, or both.")
    .max(2)
    .optional()
    .transform((v) => (v ? [...new Set(v)] : undefined)),
});

export type BookingInput = z.input<typeof bookingSchema>;

async function context() {
  const viewer = await requireViewer();
  const supabase = await createClient();
  return { viewer, supabase };
}

async function load(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase.from("placements").select(PLACEMENT_COLUMNS).eq("id", id).maybeSingle();
  if (!data) return null;
  const { data: section } = await supabase.from("placement_sections").select("*").eq("key", data.section_key).maybeSingle();
  return { p: data as unknown as Placement, section: section as Section };
}

function check(input: BookingInput) {
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some values aren't valid." } as const;
  if (parsed.data.ends_on && parsed.data.ends_on < parsed.data.starts_on) return { error: "The end date has to be on or after the start date." } as const;
  return { data: parsed.data } as const;
}

/** Anyone books a brand into a slot. Design is told. */
export async function bookPlacement(
  id: string,
  sectionKey: string,
  position: number,
  input: BookingInput,
): Promise<ActionResult> {
  const { viewer, supabase } = await context();
  if (!uuid.safeParse(id).success || !/^[a-z0-9_]+$/.test(sectionKey) || !Number.isInteger(position) || position < 1)
    return { ok: false, error: "That slot doesn't exist." };
  const c = check(input);
  if ("error" in c) return { ok: false, error: c.error! };
  const { error } = await supabase.from("placements").insert({
    id,
    section_key: sectionKey,
    position,
    ...c.data,
    created_by: viewer.id,
  });
  if (error) return { ok: false, error: friendlyError(error) };

  const loaded = await load(supabase, id);
  if (loaded) {
    notifyTeamLater("design", "design_new", {
      title: `${personName(viewer.profile)} booked ${loaded.p.brand} in ${slotName(loaded.section, position)}: needs a banner`,
      body: [datesText(loaded.p, todayPKT()), loaded.p.comms].filter(Boolean).join(" · "),
      href: placementsPath(id),
      actorId: viewer.id,
    });
  }
  revalidatePath("/placements");
  return { ok: true };
}

/** Whoever booked it (or Commercial) edits a booking. If the banner was already made and its text changed, Design is told. */
export async function updatePlacement(id: string, input: BookingInput): Promise<ActionResult> {
  const { viewer, supabase } = await context();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Booking not found." };
  const c = check(input);
  if ("error" in c) return { ok: false, error: c.error! };
  const before = await load(supabase, id);
  if (!before) return { ok: false, error: "Booking not found." };
  const { p } = before;

  const textChanged = c.data.comms !== p.comms || c.data.products !== p.products || c.data.brand !== p.brand;
  const madeAlready = p.stage === "ready" || p.stage === "live";
  const changed_from = madeAlready && textChanged ? (p.changed_from ?? { comms: p.comms, products: p.products }) : p.changed_from;

  // An emptied link clears it (only when there was one, so this works before the database has links).
  const linkPatch = c.data.link === undefined && p.link ? { link: null } : {};
  const { data, error } = await supabase.from("placements").update({ ...c.data, ...linkPatch, changed_from }).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only whoever booked it (or Commercial) can change it." };

  if (madeAlready && textChanged) {
    const after = (await load(supabase, id))!;
    notifyTeamLater("design", "design_new", {
      title: `${personName(viewer.profile)} changed ${after.p.brand} (${slotName(after.section, after.p.position)}): the banner needs an update`,
      body: after.p.comms ? `Now: “${after.p.comms}”${p.comms && p.comms !== after.p.comms ? ` (was “${p.comms}”)` : ""}` : null,
      href: placementsPath(id),
      actorId: viewer.id,
    });
  }
  revalidatePath("/placements");
  return { ok: true };
}

/** Whoever booked it cancels a booking that isn't on the site yet. */
export async function cancelPlacement(id: string): Promise<ActionResult> {
  const { supabase } = await context();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Booking not found." };
  const before = await load(supabase, id);
  const { data, error } = await supabase.from("placements").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only whoever booked it (or Commercial) can cancel, and not once it's live. End it instead." };
  const files = [...(before?.p.inspo_paths ?? []), ...(before?.p.artwork_path ? [before.p.artwork_path] : [])];
  if (files.length) await supabase.storage.from("placement-files").remove(files);
  revalidatePath("/placements");
  return { ok: true };
}

/** Whoever booked it ends a live booking today. Tech sees it in "Take down". */
export async function endPlacementToday(id: string): Promise<ActionResult> {
  const { supabase } = await context();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Booking not found." };
  const today = todayPKT();
  const { data, error } = await supabase
    .from("placements")
    .update({ ends_on: today })
    .eq("id", id)
    .lte("starts_on", today)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only whoever booked it (or Commercial) can end it." };
  revalidatePath("/placements");
  return { ok: true };
}

/** Design has put the banner on Figma. Tech is told to pick it up from there. */
export async function markOnFigma(id: string): Promise<ActionResult> {
  const { viewer, supabase } = await context();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Booking not found." };
  const before = await load(supabase, id);
  if (!before) return { ok: false, error: "Booking not found." };
  const { data, error } = await supabase.from("placements").update({ stage: "ready", changed_from: null }).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only Design can mark a banner done." };

  const update = before.p.stage === "live";
  notifyTeamLater("tech", "design_new", {
    title: `${update ? "Updated banner" : "Banner"} on Figma: ${before.p.brand}, ${slotName(before.section, before.p.position)}. Put it live`,
    href: placementsPath(id),
    actorId: viewer.id,
  });
  revalidatePath("/placements");
  return { ok: true };
}

/** Design has added a preview image (to Storage, from the browser), so the map shows the real banner. Tech is told. */
export async function submitArtwork(id: string, path: string): Promise<ActionResult> {
  const { viewer, supabase } = await context();
  if (!uuid.safeParse(id).success || !path.startsWith(`${id}/artwork/`)) return { ok: false, error: "That file doesn't belong to this booking." };
  const before = await load(supabase, id);
  if (!before) return { ok: false, error: "Booking not found." };
  const { data, error } = await supabase
    .from("placements")
    .update({ artwork_path: path, stage: "ready", changed_from: null })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only Design can upload the banner." };
  if (before.p.artwork_path && before.p.artwork_path !== path) await supabase.storage.from("placement-files").remove([before.p.artwork_path]);

  const after = (await load(supabase, id))!;
  notifyTeamLater("tech", "design_new", {
    title: `${before.p.stage === "live" ? "Updated banner" : "Banner ready"} to put live: ${after.p.brand}, ${slotName(after.section, after.p.position)}`,
    href: placementsPath(id),
    actorId: viewer.id,
  });
  revalidatePath("/placements");
  return { ok: true };
}

async function setStage(id: string, stage: "live" | "ended", from: string[]): Promise<ActionResult> {
  const { supabase } = await context();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Booking not found." };
  const { data, error } = await supabase.from("placements").update({ stage }).eq("id", id).in("stage", from).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only Tech can do that." };
  revalidatePath("/placements");
  return { ok: true };
}

export const markLive = async (id: string) => setStage(id, "live", ["ready"]);

/** Tech made it live on the website or the app. Once it's live everywhere it shows, it's Live. */
export async function makeLiveOn(id: string, surface: Surface): Promise<ActionResult> {
  const { supabase } = await context();
  if (!uuid.safeParse(id).success || !(surface in SURFACE_LABELS)) return { ok: false, error: "Booking not found." };
  const { data: p } = await supabase.from("placements").select("live_on, stage").eq("id", id).maybeSingle();
  if (!p || p.stage !== "ready") return { ok: false, error: "It needs its banner before it can go live." };
  const live_on = [...new Set([...((p.live_on as Surface[]) ?? []), surface])];
  const { data, error } = await supabase.from("placements").update({ live_on }).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only Tech can do that." };
  revalidatePath("/placements");
  return { ok: true };
}
export const markTakenDown = async (id: string) => setStage(id, "ended", ["live", "ready"]);

export type BulkRow = BookingInput & { section_key: string; position: number };

/**
 * Commercial books many slots at once (the Schedule's "Add many", or a paste
 * from a sheet). Each row is saved on its own so one clash doesn't lose the
 * rest; Design gets one email listing everything new.
 */
export async function bookMany(rows: BulkRow[]): Promise<ActionResult<{ saved: number; failed: { row: number; error: string }[] }>> {
  const { viewer, supabase } = await context();
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "Add at least one row." };
  if (rows.length > 200) return { ok: false, error: "That's more than 200 rows. Split it in two." };

  const { data: sectionData } = await supabase.from("placement_sections").select("*");
  const sections = (sectionData ?? []) as Section[];
  const failed: { row: number; error: string }[] = [];
  const saved: Placement[] = [];

  for (const [i, r] of rows.entries()) {
    const section = sections.find((s) => s.key === r.section_key);
    if (!section || !Number.isInteger(r.position) || r.position < 1 || r.position > section.slots) {
      failed.push({ row: i, error: "That slot doesn't exist." });
      continue;
    }
    const c = check(r);
    if ("error" in c) {
      failed.push({ row: i, error: c.error! });
      continue;
    }
    const { data, error } = await supabase
      .from("placements")
      .insert({ section_key: r.section_key, position: r.position, ...c.data, created_by: viewer.id })
      .select(PLACEMENT_COLUMNS)
      .single();
    if (error || !data) failed.push({ row: i, error: friendlyError(error) });
    else saved.push(data as unknown as Placement);
  }

  if (saved.length) {
    const today = todayPKT();
    const lines = saved
      .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
      .map((p) => {
        const s = sections.find((x) => x.key === p.section_key)!;
        return `${p.brand} — ${slotName(s, p.position)} — ${datesText(p, today)}${p.comms ? ` — “${p.comms}”` : ""}`;
      });
    notifyTeamLater("design", "design_new", {
      title: `${personName(viewer.profile)} booked ${saved.length} placement${saved.length === 1 ? "" : "s"}: they need banners`,
      body: lines.slice(0, 3).join("; ") + (lines.length > 3 ? "…" : ""),
      href: placementsPath(),
      actorId: viewer.id,
    });
    revalidatePath("/placements");
  }
  return { ok: true, data: { saved: saved.length, failed } };
}

// ---------------------------------------------------------------------------
// Daily deals: the month sheet. Each cell is a one-day booking of the
// announcement bar or hero slide 1 / 2, so the homepage map follows it.
// ---------------------------------------------------------------------------

export type DealSlot = "announcement" | "hero1" | "hero2";
const DEAL_SLOTS: Record<DealSlot, { key: string; position: number }> = {
  announcement: { key: "announcement", position: 1 },
  hero1: { key: "hero", position: 1 },
  hero2: { key: "hero", position: 2 },
};
const dealText = z.string().trim().max(300);

/** Type into a day's cell: create, change or clear that day's booking. */
export async function saveDailyDeal(day: string, slot: DealSlot, text: string, existingId?: string): Promise<ActionResult> {
  const { viewer, supabase } = await context();
  const d = date.safeParse(day);
  const t = dealText.safeParse(text);
  if (!d.success || !(slot in DEAL_SLOTS) || !t.success) return { ok: false, error: "That isn't valid." };
  const value = t.data.slice(0, 120);
  const { key, position } = DEAL_SLOTS[slot];

  if (existingId) {
    if (!uuid.safeParse(existingId).success) return { ok: false, error: "Booking not found." };
    const before = await load(supabase, existingId);
    if (!before) return { ok: false, error: "Booking not found." };
    if (before.p.starts_on !== before.p.ends_on)
      return { ok: false, error: `${before.p.brand} runs ${datesText(before.p, todayPKT())}. Change it in Placements.` };
    if (!value) return cancelPlacement(existingId);
    // The day's text is the booking's name; if the banner was already made, Design is asked to redo it.
    const madeAlready = before.p.stage === "ready" || before.p.stage === "live";
    const changed_from = madeAlready && value !== before.p.brand ? (before.p.changed_from ?? { comms: before.p.brand, products: before.p.products }) : before.p.changed_from;
    const { data, error } = await supabase
      .from("placements")
      .update({ brand: value.slice(0, 120), comms: null, changed_from })
      .eq("id", existingId)
      .select("id");
    if (error) return { ok: false, error: friendlyError(error) };
    if (!data?.length) return { ok: false, error: "Only whoever booked it (or Commercial) can change it." };
    revalidatePath("/placements");
    revalidatePath("/daily-deals");
    return { ok: true };
  }

  if (!value) return { ok: true };
  const { error } = await supabase.from("placements").insert({
    section_key: key,
    position,
    brand: value.slice(0, 120),
    starts_on: d.data,
    ends_on: d.data,
    shows_on: ["web", "app"],
    created_by: viewer.id,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/placements");
  revalidatePath("/daily-deals");
  return { ok: true };
}

export type DealRow = { date: string; announcement?: string; hero1?: string; hero2?: string };

/** Paste a month from the sheet: one booking per filled cell. Design gets one email. */
export async function saveDailyDeals(rows: DealRow[]): Promise<ActionResult<{ saved: number; failed: string[] }>> {
  const { viewer, supabase } = await context();
  if (!Array.isArray(rows) || !rows.length || rows.length > 62) return { ok: false, error: "Paste between 1 and 62 days." };
  let saved = 0;
  const failed: string[] = [];
  for (const row of rows) {
    if (!date.safeParse(row.date).success) {
      failed.push(`${row.date}: not a date`);
      continue;
    }
    for (const slot of ["announcement", "hero1", "hero2"] as const) {
      const value = (row[slot] ?? "").trim().slice(0, 120);
      if (!value) continue;
      const { key, position } = DEAL_SLOTS[slot];
      const { error } = await supabase.from("placements").insert({
        section_key: key,
        position,
        brand: value.slice(0, 120),
        starts_on: row.date,
        ends_on: row.date,
        shows_on: ["web", "app"],
        created_by: viewer.id,
      });
      if (error) failed.push(`${row.date} ${slot === "announcement" ? "announcement" : slot === "hero1" ? "hero 1" : "hero 2"}: ${friendlyError(error)}`);
      else saved++;
    }
  }
  if (saved)
    notifyTeamLater("design", "design_new", {
      title: `${personName(viewer.profile)} added ${saved} daily deal${saved === 1 ? "" : "s"}: they're in your Design list`,
      href: "/placements?tab=design",
      actorId: viewer.id,
    });
  revalidatePath("/placements");
  revalidatePath("/daily-deals");
  return { ok: true, data: { saved, failed } };
}

// ---------------------------------------------------------------------------
// Comments and history on a booking
// ---------------------------------------------------------------------------

export type BookingThread = {
  comments: { id: string; body: string; author: string; when: string; mine: boolean }[];
  activity: { id: number; who: string; text: string; when: string }[];
};

/** A booking's comments and history (empty before the database has them). */
export async function getBookingThread(id: string): Promise<ActionResult<BookingThread>> {
  const { viewer, supabase } = await context();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Booking not found." };
  const [{ data: comments }, { data: log }, { data: people }] = await Promise.all([
    supabase.from("placement_comments").select("id, body, author_id, created_at").eq("placement_id", id).order("created_at"),
    supabase.from("activity_log").select("*").eq("entity_type", "placement").eq("entity_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  const byId = new Map(((people ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, p]));
  const who = (pid: unknown) => (typeof pid === "string" && byId.get(pid) ? personName(byId.get(pid)!) : "Someone");
  return {
    ok: true,
    data: {
      comments: ((comments ?? []) as { id: string; body: string; author_id: string; created_at: string }[]).map((c) => ({
        id: c.id,
        body: c.body,
        author: who(c.author_id),
        when: formatPKT(c.created_at, "d MMM, h:mm a"),
        mine: c.author_id === viewer.id,
      })),
      activity: ((log ?? []) as ActivityEntry[]).map((e) => ({
        id: e.id,
        who: e.actor_id ? who(e.actor_id) : "System",
        text: describeActivity(e, { person: (pid) => (typeof pid === "string" ? (byId.get(pid) as PersonRef | undefined) ?? null : null) }),
        when: formatPKT(e.created_at),
      })),
    },
  };
}

export async function addBookingComment(id: string, body: string): Promise<ActionResult> {
  const { supabase } = await context();
  const text = body.trim();
  if (!uuid.safeParse(id).success || !text || text.length > 5000) return { ok: false, error: "Write something first." };
  const { error } = await supabase.from("placement_comments").insert({ placement_id: id, body: text });
  if (error) return { ok: false, error: friendlyError(error) };
  await flushPush();
  return { ok: true };
}

export async function deleteBookingComment(commentId: string): Promise<ActionResult> {
  const { supabase } = await context();
  if (!uuid.safeParse(commentId).success) return { ok: false, error: "Comment not found." };
  const { data, error } = await supabase.from("placement_comments").delete().eq("id", commentId).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "You can only remove your own comments." };
  return { ok: true };
}

const bulkPlacementSchema = z.object({
  ids: z.array(uuid).min(1).max(200),
  op: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("live") }),
    z.object({ kind: z.literal("remove") }),
    z.object({ kind: z.literal("dates"), starts_on: date.optional(), ends_on: date.nullable().optional() }),
  ]),
});
export type BulkPlacementOp = z.input<typeof bulkPlacementSchema>["op"];

/**
 * The same change to many ticked bookings: make live (everywhere each one
 * shows), remove (cancel what isn't live yet, end today what is), or change
 * dates. Each goes through the usual rules; ones you can't change are skipped.
 */
export async function bulkPlacements(ids: string[], op: BulkPlacementOp): Promise<ActionResult<{ changed: number; skipped: number }>> {
  const { supabase } = await context();
  const parsed = bulkPlacementSchema.safeParse({ ids, op });
  if (!parsed.success) return { ok: false, error: "Pick some bookings first." };
  const o = parsed.data.op;
  if (o.kind === "dates" && o.starts_on && o.ends_on && o.ends_on < o.starts_on) return { ok: false, error: "The end date has to be on or after the start date." };
  let changed = 0;
  for (const id of [...new Set(parsed.data.ids)]) {
    const { data: p } = await supabase.from("placements").select("stage, shows_on, live_on, starts_on, ends_on").eq("id", id).maybeSingle();
    if (!p) continue;
    if (o.kind === "live") {
      if (p.stage !== "ready") continue;
      let ok = true;
      for (const s of ((p.shows_on as Surface[])?.length ? (p.shows_on as Surface[]) : (["web"] as Surface[])).filter((x) => !(p.live_on as Surface[]).includes(x))) {
        const res = await makeLiveOn(id, s);
        if (!res.ok) ok = false;
      }
      if (ok) changed++;
    } else if (o.kind === "remove") {
      const res = p.stage === "live" ? await endPlacementToday(id) : p.stage === "ended" ? { ok: false } : await cancelPlacement(id);
      if (res.ok) changed++;
    } else {
      const starts = o.starts_on ?? (p.starts_on as string);
      const ends = o.ends_on === undefined ? (p.ends_on as string | null) : o.ends_on;
      if (ends && ends < starts) continue;
      const { data } = await supabase.from("placements").update({ starts_on: starts, ends_on: ends }).eq("id", id).select("id");
      if (data?.length) changed++;
    }
  }
  revalidatePath("/placements");
  return { ok: true, data: { changed, skipped: parsed.data.ids.length - changed } };
}

// ---------------------------------------------------------------------------
// Homepage layout: Commercial (and Admins) move, add and hide sections.
// ---------------------------------------------------------------------------

const sectionKey = z.string().regex(/^[a-z0-9_]{1,80}$/);

const newSectionSchema = z.object({
  name: z.string().trim().min(1, "Give the section a name.").max(80, "Keep the name under 80 characters."),
  kind: z.enum(["banner", "text", "icons", "carousel", "tiles", "badge"]),
  slots: z.number().int().min(1, "At least 1 slot.").max(30, "At most 30 slots."),
  shows_on: z.array(z.enum(["web", "app"])).min(1, "Pick where it shows.").max(2),
  size_hint: z.string().trim().max(80),
});

/** Add a section at the bottom of the homepage. */
export async function addSection(input: z.input<typeof newSectionSchema>): Promise<ActionResult<{ key: string }>> {
  await requireViewer();
  const parsed = newSectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Some values aren't valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_placement_section", {
    p_name: parsed.data.name,
    p_kind: parsed.data.kind,
    p_slots: parsed.data.slots,
    p_shows_on: parsed.data.shows_on,
    p_size_hint: parsed.data.size_hint || null,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/placements");
  revalidatePath("/admin/placements");
  return { ok: true, data: { key: data as string } };
}

/** Put the sections in this order, top to bottom. */
export async function orderSections(keys: string[]): Promise<ActionResult> {
  await requireViewer();
  const parsed = z.array(sectionKey).min(1).max(100).safeParse(keys);
  if (!parsed.success) return { ok: false, error: "That order isn't valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("order_placement_sections", { p_keys: parsed.data });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/placements");
  revalidatePath("/admin/placements");
  return { ok: true };
}

/** Hide a section (its bookings and history stay), or bring it back. */
export async function hideSection(key: string, hidden: boolean): Promise<ActionResult> {
  await requireViewer();
  if (!sectionKey.safeParse(key).success) return { ok: false, error: "Section not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("hide_placement_section", { p_key: key, p_hidden: hidden });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/placements");
  revalidatePath("/admin/placements");
  return { ok: true };
}
