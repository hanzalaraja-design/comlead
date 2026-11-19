"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { flushPush } from "@/lib/push";
import { friendlyError, type ActionResult } from "@/lib/action-result";

/**
 * Parts of a project: the terms of a brand partnership (and journeys). Anyone
 * in the project can add and edit them; the database checks.
 */

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => v || null)
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const field = z.object({ label: z.string().trim().max(80), value: z.string().max(2000) });

const partSchema = z.object({
  name: z.string().trim().min(1, "Give it a name").max(120),
  stage: z.string().max(20).optional(),
  starts_on: isoDate,
  ends_on: isoDate,
  description: z.string().max(20000).optional().nullable(),
  fields: z.array(field).max(40).optional(),
  extra: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
});
export type PartInput = z.input<typeof partSchema>;

const refresh = () => revalidatePath("/", "layout");

export async function createPart(projectId: string, kind: "term" | "journey", input: PartInput & { renewed_from?: string | null }): Promise<ActionResult<{ id: string }>> {
  await requireViewer();
  const parsed = partSchema.safeParse(input);
  if (!uuid.safeParse(projectId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "That isn't valid." };
  const v = parsed.data;
  if (v.starts_on && v.ends_on && v.ends_on < v.starts_on) return { ok: false, error: "It ends before it starts." };
  const supabase = await createClient();
  const { data: last } = await supabase.from("project_parts").select("sort").eq("project_id", projectId).eq("kind", kind).order("sort", { ascending: false }).limit(1);
  const { data, error } = await supabase
    .from("project_parts")
    .insert({
      project_id: projectId,
      kind,
      name: v.name,
      stage: v.stage ?? (kind === "term" ? "draft" : "idea"),
      starts_on: v.starts_on,
      ends_on: v.ends_on,
      description: v.description?.trim() || null,
      fields: (v.fields ?? []).filter((f) => f.label || f.value),
      extra: v.extra ?? {},
      sort: ((last?.[0]?.sort as number | undefined) ?? 0) + 10,
      renewed_from: input.renewed_from && uuid.safeParse(input.renewed_from).success ? input.renewed_from : null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendlyError(error) };
  refresh();
  return { ok: true, data: { id: data.id as string } };
}

export async function updatePart(partId: string, input: Partial<PartInput>): Promise<ActionResult> {
  await requireViewer();
  const parsed = partSchema.partial().safeParse(input);
  if (!uuid.safeParse(partId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "That isn't valid." };
  const v = parsed.data;
  const patch: Record<string, unknown> = {};
  if (v.name !== undefined) patch.name = v.name;
  if (v.stage !== undefined) patch.stage = v.stage;
  if (v.starts_on !== undefined) patch.starts_on = v.starts_on;
  if (v.ends_on !== undefined) patch.ends_on = v.ends_on;
  if (v.description !== undefined) patch.description = v.description?.trim() || null;
  if (v.fields !== undefined) patch.fields = v.fields.filter((f) => f.label || f.value);
  if (v.extra !== undefined) patch.extra = v.extra;
  if (!Object.keys(patch).length) return { ok: true };
  const supabase = await createClient();
  const { data, error } = await supabase.from("project_parts").update(patch).eq("id", partId).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only the people in it can change this." };
  refresh();
  return { ok: true };
}

export async function deletePart(partId: string): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(partId).success) return { ok: false, error: "That isn't valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("project_parts").delete().eq("id", partId).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only the people in it can remove this." };
  refresh();
  return { ok: true };
}

/** New order after a drag: ids first to last. */
export async function reorderParts(ids: string[]): Promise<ActionResult> {
  await requireViewer();
  if (!z.array(uuid).max(200).safeParse(ids).success) return { ok: false, error: "That isn't valid." };
  const supabase = await createClient();
  for (const [i, id] of ids.entries()) {
    const { error } = await supabase.from("project_parts").update({ sort: (i + 1) * 10 }).eq("id", id);
    if (error) return { ok: false, error: friendlyError(error) };
  }
  refresh();
  return { ok: true };
}

export async function addProjectComment(projectId: string, body: string): Promise<ActionResult> {
  await requireViewer();
  const text = body.trim();
  if (!uuid.safeParse(projectId).success || !text || text.length > 10000) return { ok: false, error: "Write something first." };
  const supabase = await createClient();
  const { error } = await supabase.from("project_comments").insert({ project_id: projectId, body: text });
  if (error) return { ok: false, error: friendlyError(error) };
  await flushPush();
  refresh();
  return { ok: true };
}

export async function deleteProjectComment(commentId: string): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(commentId).success) return { ok: false, error: "That isn't valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("project_comments").delete().eq("id", commentId).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "You can only remove your own comments." };
  refresh();
  return { ok: true };
}
