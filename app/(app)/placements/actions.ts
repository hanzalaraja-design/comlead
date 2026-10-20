"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { emailHtml, emailTeamLater, placementsUrl } from "@/lib/notify";
import { PLACEMENT_COLUMNS, datesText, slotName, type Placement, type Section } from "@/lib/placements";
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

/** Commercial books a brand into a slot. Design is told. */
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

/** Commercial edits a booking. If the banner was already made and its text changed, Design is told. */
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
  if (!data?.length) return { ok: false, error: "Only Commercial can change a booking." };

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

/** Commercial cancels a booking that isn't on the site yet. */
export async function cancelPlacement(id: string): Promise<ActionResult> {
  const { supabase } = await context();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Booking not found." };
  const before = await load(supabase, id);
  const { data, error } = await supabase.from("placements").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only Commercial can cancel, and not once it's live. End it instead." };
  const files = [...(before?.p.inspo_paths ?? []), ...(before?.p.artwork_path ? [before.p.artwork_path] : [])];
  if (files.length) await supabase.storage.from("placement-files").remove(files);
  revalidatePath("/placements");
  return { ok: true };
}

/** Commercial ends a live booking today. Tech sees it in "Take down". */
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
  if (!data?.length) return { ok: false, error: "Only Commercial can end a booking." };
  revalidatePath("/placements");
  return { ok: true };
}

/** Design has uploaded the banner (to Storage, from the browser). Tech is told. */
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
      intro: `${viewer.profile.full_name ?? "Design"} uploaded the ${before.p.stage === "live" ? "updated " : ""}banner. It's ready to go on the site.`,
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
export const markTakenDown = async (id: string) => setStage(id, "ended", ["live", "ready"]);
