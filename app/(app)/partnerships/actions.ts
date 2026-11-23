"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { CATEGORIES } from "@/lib/domains";

const uuid = z.string().uuid();
export type TagColor = "gray" | "purple" | "blue" | "green" | "amber" | "pink" | "teal";
const COLORS: TagColor[] = ["pink", "teal", "amber", "green", "blue", "purple", "gray"];

/** Put a tag on a partnership, or take it off. */
export async function setPartnershipTag(projectId: string, tagId: string, on: boolean): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(tagId).success) return { ok: false, error: "That tag isn't valid." };
  const supabase = await createClient();
  const { error } = on
    ? await supabase.from("project_tags").upsert({ project_id: projectId, tag_id: tagId }, { onConflict: "project_id,tag_id", ignoreDuplicates: true })
    : await supabase.from("project_tags").delete().eq("project_id", projectId).eq("tag_id", tagId);
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/partnerships", "layout");
  return { ok: true };
}

/** A new tag in a category, shared with everyone; added to the partnership straight away. */
export async function createPartnershipTag(
  category: string,
  name: string,
  projectId?: string,
): Promise<ActionResult<{ id: string; name: string; color: TagColor }>> {
  await requireViewer();
  const clean = name.trim().replace(/\s+/g, " ");
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) return { ok: false, error: "Pick a category first." };
  if (!clean || clean.length > 40) return { ok: false, error: "Tags are 1 to 40 characters." };
  const supabase = await createClient();
  const { count } = await supabase.from("partnership_tags").select("id", { count: "exact", head: true }).eq("category", category);
  const color = COLORS[(count ?? 0) % COLORS.length];
  const viewer = await requireViewer();
  const { data, error } = await supabase
    .from("partnership_tags")
    .insert({ category, name: clean, color, created_by: viewer.id })
    .select("id, name, color")
    .single();
  if (error) return { ok: false, error: error.code === "23505" ? "That tag already exists." : friendlyError(error) };
  if (projectId) {
    const res = await setPartnershipTag(projectId, data.id as string, true);
    if (!res.ok) return res;
  }
  revalidatePath("/partnerships", "layout");
  return { ok: true, data: data as { id: string; name: string; color: TagColor } };
}

/** A partnership's categories and tags, set together from the one picker. */
export async function setPartnershipLabels(projectId: string, categories: string[], tagIds: string[]): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(projectId).success || !z.array(uuid).max(50).safeParse(tagIds).success) return { ok: false, error: "That isn't valid." };
  const cats = [...new Set(categories)].filter((c) => CATEGORIES.includes(c as (typeof CATEGORIES)[number]));
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_partnership_labels", { p_project: projectId, p_categories: cats, p_tags: tagIds });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/partnerships", "layout");
  return { ok: true };
}

/** Delete a tag for everyone; it comes off every partnership it was on. */
export async function deletePartnershipTag(tagId: string): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(tagId).success) return { ok: false, error: "That tag isn't valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("partnership_tags").delete().eq("id", tagId).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Couldn't delete that tag. Has the latest SQL been run?" };
  revalidatePath("/partnerships");
  return { ok: true };
}
