"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const team = z.string().uuid().nullable();

export async function saveTeams(input: { commercial: string | null; design: string | null; tech: string | null }): Promise<ActionResult> {
  await requireAdmin();
  const parsed = z.object({ commercial: team, design: team, tech: team }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick a team from the list." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("placement_settings")
    .update({
      commercial_department_id: parsed.data.commercial,
      design_department_id: parsed.data.design,
      tech_department_id: parsed.data.tech,
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
