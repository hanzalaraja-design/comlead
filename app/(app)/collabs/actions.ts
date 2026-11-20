"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { isInlineImage } from "@/lib/inline-image";
import { GOALS } from "@/lib/collabs";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => v || "");

const requestSchema = z.object({
  brand: z.string().trim().min(1, "Add the brand.").max(120),
  promote: z.string().trim().min(1, "Say what to promote.").max(500),
  goals: z.array(z.enum(GOALS)).min(1, "Pick at least one goal.").max(6),
  go_live: date,
  // One of the ranges, or one typed in ("Rs 150,000 – 300,000").
  budget: z.string().trim().min(1, "Pick a budget.").max(80),
  audience: z.string().trim().min(1, "Say who it's for.").max(300),
  key_message: z.string().trim().min(1, "Add the key message.").max(300),
  link: optional(500),
  refs: optional(2000),
  project_id: z.union([uuid, z.literal("")]).optional().transform((v) => v || ""),
  notes: optional(2000),
  // What they'd like from the media kit, and anything else.
  wants: z
    .array(z.object({ rate_id: uuid, name: z.string().trim().min(1).max(120), qty: z.number().int().min(1).max(50) }))
    .max(30)
    .optional()
    .transform((v) => v ?? []),
  wants_other: optional(1000),
});
export type CollabRequestInput = z.input<typeof requestSchema>;

const done = (id?: string) => {
  revalidatePath("/collabs");
  if (id) revalidatePath(`/collabs/${id}`);
};

/** Commercial sends a new request, or edits one before the plan arrives. */
export async function saveCollabRequest(id: string | null, input: CollabRequestInput): Promise<ActionResult<{ id: string }>> {
  await requireViewer();
  if (id && !uuid.safeParse(id).success) return { ok: false, error: "Request not found." };
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Some values aren't valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("collab_save_request", { p_id: id, p: parsed.data });
  if (error) return { ok: false, error: friendlyError(error) };
  done(data as string);
  return { ok: true, data: { id: data as string } };
}

const itemSchema = z.object({
  rate_id: uuid,
  qty: z.number().int().min(1).max(50),
  idea: z.string().trim().max(500).optional(),
  owner_id: z.union([uuid, z.literal("")]).optional(),
  due_date: z.union([date, z.literal("")]).optional(),
});

/** Content sends (or re-sends) the plan. */
export async function sendCollabPlan(id: string, items: z.input<typeof itemSchema>[], note: string): Promise<ActionResult> {
  await requireViewer();
  const parsed = z.array(itemSchema).min(1, "Add at least one piece.").max(30).safeParse(items);
  if (!uuid.safeParse(id).success || !parsed.success) return { ok: false, error: parsed.success ? "Request not found." : parsed.error.issues[0]?.message ?? "Check the pieces." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("collab_send_plan", { p_id: id, p_items: parsed.data, p_note: note.slice(0, 1000) });
  if (error) return { ok: false, error: friendlyError(error) };
  done(id);
  return { ok: true };
}

export async function approveCollab(id: string): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Request not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("collab_approve", { p_id: id });
  if (error) return { ok: false, error: friendlyError(error) };
  done(id);
  revalidatePath("/my");
  return { ok: true };
}

export async function askCollabChanges(id: string, note: string): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Request not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("collab_ask_changes", { p_id: id, p_note: note.trim().slice(0, 1000) });
  if (error) return { ok: false, error: friendlyError(error) };
  done(id);
  return { ok: true };
}

export async function markCollabLive(itemId: string, url: string, requestId: string): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "Piece not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("collab_mark_live", { p_item: itemId, p_url: url.trim().slice(0, 1000) });
  if (error) return { ok: false, error: friendlyError(error) };
  done(requestId);
  revalidatePath("/my");
  return { ok: true };
}

const numberSchema = z.object({ id: uuid, reach: z.string().max(12).optional(), views: z.string().max(12).optional() });

export async function shareCollabReport(id: string, summary: string, images: string[], numbers: z.input<typeof numberSchema>[]): Promise<ActionResult> {
  await requireViewer();
  const nums = z.array(numberSchema).max(50).safeParse(numbers);
  if (!uuid.safeParse(id).success || !nums.success) return { ok: false, error: "Request not found." };
  const clean = (v?: string) => (v ?? "").replace(/[^\d]/g, "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("collab_report", {
    p_id: id,
    p_summary: summary.trim().slice(0, 3000),
    p_images: images.filter(isInlineImage).slice(0, 10),
    p_numbers: nums.data.map((n) => ({ id: n.id, reach: clean(n.reach), views: clean(n.views) })),
  });
  if (error) return { ok: false, error: friendlyError(error) };
  done(id);
  return { ok: true };
}

export async function addCollabComment(id: string, body: string, images: string[] = []): Promise<ActionResult> {
  const viewer = await requireViewer();
  const text = body.trim();
  const pics = images.filter(isInlineImage).slice(0, 6);
  if (!uuid.safeParse(id).success || (!text && !pics.length)) return { ok: false, error: "Write a comment first." };
  const supabase = await createClient();
  const { error } = await supabase.from("collab_comments").insert({ request_id: id, author_id: viewer.id, body: text.slice(0, 10000), image_paths: pics });
  if (error) return { ok: false, error: friendlyError(error) };
  done(id);
  return { ok: true };
}

export async function deleteCollabComment(commentId: string, requestId: string): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(commentId).success) return { ok: false, error: "Comment not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("collab_comments").delete().eq("id", commentId);
  if (error) return { ok: false, error: friendlyError(error) };
  done(requestId);
  return { ok: true };
}

/** Admin changes a price in the media kit. */
export async function saveCollabRate(id: string, price: number, priceMax: number | null): Promise<ActionResult> {
  await requireViewer();
  const ok = uuid.safeParse(id).success && Number.isInteger(price) && price >= 0 && (priceMax === null || (Number.isInteger(priceMax) && priceMax >= price));
  if (!ok) return { ok: false, error: "Enter a price in rupees." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("collab_rates").update({ price, price_max: priceMax }).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only an Admin can change rates." };
  done();
  return { ok: true };
}
