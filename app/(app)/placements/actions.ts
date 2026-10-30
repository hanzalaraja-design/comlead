"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { emailHtml, emailTeamLater, placementsUrl } from "@/lib/notify";
import { PLACEMENT_COLUMNS, SURFACE_LABELS, datesText, slotName, surfacesText, type Placement, type Section, type Surface } from "@/lib/placements";
import { todayPKT } from "@/lib/time";

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

function details(p: Placement, section: Section): [string, string][] {
  const rows: [string, string][] = [
    ["Slot", slotName(section, p.position)],
    ["Dates", datesText(p, todayPKT())],
    ["Shows on", surfacesText(p.shows_on ?? ["web"])],
  ];
  if (p.comms) rows.push(["Comms", p.comms]);
  if (p.products) rows.push(["Products", p.products]);
  if (p.notes) rows.push(["Notes", p.notes]);
  if (section.size_hint) rows.push(["Size", section.size_hint]);
  return rows;
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
    emailTeamLater(
      "design",
      `New banner to design: ${loaded.p.brand}, ${slotName(loaded.section, position)}`,
      emailHtml({
        intro: `${viewer.profile.full_name ?? "Commercial"} booked a new placement. It needs a banner.`,
        rows: details(loaded.p, loaded.section),
        link: placementsUrl(id),
        linkLabel: "Open in Highfy Tasks",
      }),
    );
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

  const { data, error } = await supabase.from("placements").update({ ...c.data, changed_from }).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only whoever booked it (or Commercial) can change it." };

  if (madeAlready && textChanged) {
    const after = (await load(supabase, id))!;
    emailTeamLater(
      "design",
      `Banner change: ${after.p.brand}, ${slotName(after.section, after.p.position)}`,
      emailHtml({
        intro: `${viewer.profile.full_name ?? "Commercial"} changed a placement that already has a banner. It needs an update.`,
        rows: [
          ...details(after.p, after.section),
          ...((p.comms !== after.p.comms ? [["Was", p.comms ?? "(no comms)"]] : []) as [string, string][]),
        ],
        link: placementsUrl(id),
        linkLabel: "Open in Highfy Tasks",
      }),
    );
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
  emailTeamLater(
    "tech",
    `${update ? "Updated banner" : "Banner"} on Figma: ${before.p.brand}, ${slotName(before.section, before.p.position)}`,
    emailHtml({
      intro: `${viewer.profile.full_name ?? "Design"} has put the ${update ? "updated " : ""}banner on Figma. Pick it from there and put it live.`,
      rows: details(before.p, before.section),
      link: placementsUrl(id),
      linkLabel: "Open in Highfy Tasks",
    }),
  );
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
  emailTeamLater(
    "tech",
    `${before.p.stage === "live" ? "Updated banner" : "Banner ready"} to put live: ${after.p.brand}, ${slotName(after.section, after.p.position)}`,
    emailHtml({
      intro: `${viewer.profile.full_name ?? "Design"} has finished the ${before.p.stage === "live" ? "updated " : ""}banner. It's on Figma, with a preview attached here, ready to go on the site.`,
      rows: details(after.p, after.section),
      link: placementsUrl(id),
      linkLabel: "Open in Highfy Tasks",
    }),
  );
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
    emailTeamLater(
      "design",
      `${saved.length} new banner${saved.length === 1 ? "" : "s"} to design`,
      emailHtml({
        intro: `${viewer.profile.full_name ?? "Commercial"} booked ${saved.length} placement${saved.length === 1 ? "" : "s"}. They need banners.`,
        rows: lines.map((l, i) => [String(i + 1), l] as [string, string]),
        link: placementsUrl(),
        linkLabel: "Open in Highfy Tasks",
      }),
    );
    revalidatePath("/placements");
  }
  return { ok: true, data: { saved: saved.length, failed } };
}
