"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const team = z.string().uuid().nullable();

export async function saveTeams(input: { commercial: string | null; design: string | null; tech: string | null; content: string | null }): Promise<ActionResult> {
  await requireAdmin();
  const parsed = z.object({ commercial: team, design: team, tech: team, content: team }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick a team from the list." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("placement_settings")
    .update({
      commercial_department_id: parsed.data.commercial,
      design_department_id: parsed.data.design,
      tech_department_id: parsed.data.tech,
      content_department_id: parsed.data.content,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

const sectionSchema = z.object({
  name: z.string().trim().min(1, "Give the section a name.").max(80),
  slots: z.number().int().min(1, "At least 1 slot.").max(30, "At most 30 slots."),
  labels: z.array(z.string().trim().max(40)).max(30),
  size_hint: z
    .string()
    .trim()
    .max(80)
    .transform((v) => v || null),
});

export async function saveSection(key: string, input: z.input<typeof sectionSchema>): Promise<ActionResult> {
  await requireAdmin();
  const parsed = sectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Some values aren't valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("placement_sections").update(parsed.data).eq("key", key).select("key");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Section not found." };
  revalidatePath("/placements");
  revalidatePath("/admin/placements");
  return { ok: true };
}

const tabKey = z.enum(["web", "social", "ads", "crm", "partnerships", "design"]);

/** Which teams see a tab, and whose lead gives access when someone asks. */
export async function saveTabAccess(tab: string, teamIds: string[], ownerId: string | null): Promise<ActionResult> {
  await requireAdmin();
  const parsed = z.object({ tab: tabKey, teams: z.array(z.string().uuid()).max(50), owner: team }).safeParse({ tab, teams: teamIds, owner: ownerId });
  if (!parsed.success) return { ok: false, error: "Pick teams from the list." };
  const supabase = await createClient();
  const { error: e1 } = await supabase.from("placement_tabs").update({ owner_department_id: parsed.data.owner }).eq("key", parsed.data.tab);
  if (e1) return { ok: false, error: friendlyError(e1) };
  if (parsed.data.tab !== "design") {
    const { data: now } = await supabase.from("placement_tab_teams").select("department_id").eq("tab", parsed.data.tab);
    const had = new Set(((now ?? []) as { department_id: string }[]).map((r) => r.department_id));
    const want = new Set(parsed.data.teams);
    const drop = [...had].filter((d) => !want.has(d));
    const add = [...want].filter((d) => !had.has(d));
    if (drop.length) {
      const { error } = await supabase.from("placement_tab_teams").delete().eq("tab", parsed.data.tab).in("department_id", drop);
      if (error) return { ok: false, error: friendlyError(error) };
    }
    if (add.length) {
      const { error } = await supabase.from("placement_tab_teams").insert(add.map((d) => ({ tab: parsed.data.tab, department_id: d })));
      if (error) return { ok: false, error: friendlyError(error) };
    }
  }
  revalidatePath("/placements");
  revalidatePath("/admin/placements");
  return { ok: true };
}

/** Take away access someone was given to a tab. */
export async function removeTabPerson(tab: string, userId: string): Promise<ActionResult> {
  await requireAdmin();
  if (!tabKey.safeParse(tab).success || !z.string().uuid().safeParse(userId).success) return { ok: false, error: "Not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("placement_tab_people").delete().eq("tab", tab).eq("user_id", userId);
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/placements");
  revalidatePath("/admin/placements");
  return { ok: true };
}
