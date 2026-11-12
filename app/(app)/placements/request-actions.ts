"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { CHANNEL_LABELS, CREATIVE_COLUMNS, isChannel, type CreativeRequest } from "@/lib/creative";
import { personName } from "@/lib/labels";
import { notifyPersonLater, notifyTeamLater, requestPath } from "@/lib/notify";
import { formatDate } from "@/lib/time";
import { isInlineImage } from "@/lib/inline-image";

const uuid = z.string().uuid();
const date = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

const requestSchema = z.object({
  title: z.string().trim().min(1, "Say what you need.").max(200),
  formats: text(500),
  brief: text(5000),
  project_id: z
    .string()
    .optional()
    .transform((v) => v || null)
    .pipe(uuid.nullable()),
  needed_by: date,
  live_from: date,
  live_to: date,
  ref_paths: z.array(z.string().max(300)).max(10),
});

export type RequestInput = z.input<typeof requestSchema>;

async function context() {
  const viewer = await requireViewer();
  const supabase = await createClient();
  return { viewer, supabase };
}

async function load(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase.from("creative_requests").select(CREATIVE_COLUMNS).eq("id", id).maybeSingle();
  return (data as unknown as CreativeRequest | null) ?? null;
}

function summary(r: CreativeRequest): string {
  return [r.formats, r.needed_by && `needed ${formatDate(r.needed_by, "EEE d MMM")}`].filter(Boolean).join(" · ");
}

const done = () => revalidatePath("/placements");

/** Social, Ads, CRM or Partnerships ask Design for something. Design is told. */
export async function createRequest(id: string, channel: string, input: RequestInput): Promise<ActionResult> {
  const { viewer, supabase } = await context();
  if (!uuid.safeParse(id).success || !isChannel(channel)) return { ok: false, error: "That request isn't valid." };
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Some values aren't valid." };
  const v = parsed.data;
  if (v.live_from && v.live_to && v.live_to < v.live_from) return { ok: false, error: "The end date has to be on or after the start date." };
  if (v.ref_paths.some((p) => !p.startsWith(`requests/${id}/refs/`))) return { ok: false, error: "A file doesn't belong to this request." };

  const { error } = await supabase.from("creative_requests").insert({ id, channel, ...v, requested_by: viewer.id });
  if (error) return { ok: false, error: friendlyError(error) };
  const r = await load(supabase, id);
  if (r)
    notifyTeamLater("design", "design_new", {
      title: `${personName(viewer.profile)} needs ${r.title} (${CHANNEL_LABELS[r.channel]})`,
      body: summary(r),
      href: requestPath(r.channel, id),
      actorId: viewer.id,
    });
  done();
  return { ok: true };
}

/** Who in Design is on it (the team decides; this just records it). */
export async function takeRequest(id: string, designerId?: string): Promise<ActionResult> {
  const { viewer, supabase } = await context();
  const who = designerId ?? viewer.id;
  if (!uuid.safeParse(id).success || !uuid.safeParse(who).success) return { ok: false, error: "Request not found." };
  const { data, error } = await supabase
    .from("creative_requests")
    .update({ designer_id: who, status: "in_design" })
    .eq("id", id)
    .in("status", ["requested", "in_design"])
    .select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only Design can take a request." };
  if (who !== viewer.id) {
    const r = await load(supabase, id);
    if (r)
      notifyPersonLater(who, "design_new", {
        title: `${personName(viewer.profile)} gave you ${r.title} (${CHANNEL_LABELS[r.channel]})`,
        body: summary(r),
        href: requestPath(r.channel, id),
        actorId: viewer.id,
      });
  }
  done();
  return { ok: true };
}

/** Design adds the files it made (uploaded to Storage from the browser). */
export async function addArtwork(id: string, paths: string[]): Promise<ActionResult> {
  const { viewer, supabase } = await context();
  if (!uuid.safeParse(id).success || !paths.length || paths.some((p) => !p.startsWith(`requests/${id}/art/`)))
    return { ok: false, error: "Those files don't belong to this request." };
  const r = await load(supabase, id);
  if (!r) return { ok: false, error: "Request not found." };
  // Whoever uploads first is on it, if nobody was.
  const { data, error } = await supabase
    .from("creative_requests")
    .update({
      art_paths: [...r.art_paths, ...paths].slice(-30),
      ...(r.status === "requested" ? { status: "in_design" } : {}),
      ...(r.designer_id ? {} : { designer_id: viewer.id }),
    })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only Design can add files." };
  done();
  return { ok: true };
}

/** Design is done for now: the asker is told to have a look. */
export async function sendForReview(id: string): Promise<ActionResult> {
  const { viewer, supabase } = await context();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Request not found." };
  const r = await load(supabase, id);
  if (!r) return { ok: false, error: "Request not found." };
  if (!r.art_paths.length) return { ok: false, error: "Add the files first." };
  const { data, error } = await supabase
    .from("creative_requests")
    .update({ status: "in_review", ...(r.designer_id ? {} : { designer_id: viewer.id }) })
    .eq("id", id)
    .in("status", ["requested", "in_design"])
    .select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only Design can send it for review." };
  notifyPersonLater(r.requested_by, "my_requests", {
    title: `${personName(viewer.profile)} sent ${r.title} for your review`,
    body: "Approve it, or ask for a revision.",
    href: requestPath(r.channel, id),
    actorId: viewer.id,
  });
  done();
  return { ok: true };
}

/** The asker sends it back with a note; the designer is told. */
export async function askForChanges(id: string, note: string): Promise<ActionResult> {
  const { viewer, supabase } = await context();
  const text = note.trim();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Request not found." };
  if (!text) return { ok: false, error: "Say what needs to change." };
  if (text.length > 2000) return { ok: false, error: "That note is too long." };
  const r = await load(supabase, id);
  if (!r) return { ok: false, error: "Request not found." };
  const { data, error } = await supabase
    .from("creative_requests")
    .update({ status: "in_design", change_note: text })
    .eq("id", id)
    .in("status", ["in_review", "approved", "done", "live"])
    .select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only whoever asked can ask for changes." };
  notifyPersonLater(r.designer_id, "revision", {
    title: `${personName(viewer.profile)} asked for a revision on ${r.title}`,
    body: text,
    href: requestPath(r.channel, id),
    actorId: viewer.id,
  });
  done();
  return { ok: true };
}

async function setStatus(id: string, status: "approved" | "live" | "cancelled", from: string[], denied: string): Promise<ActionResult> {
  const { supabase } = await context();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Request not found." };
  const { data, error } = await supabase.from("creative_requests").update({ status }).eq("id", id).in("status", from).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: denied };
  done();
  return { ok: true };
}

export const approveRequest = async (id: string) => setStatus(id, "approved", ["in_review"], "Only whoever asked can approve it.");
export const markRequestLive = async (id: string) => setStatus(id, "live", ["approved", "in_review", "done"], "Only whoever asked can mark it live.");
export const cancelRequest = async (id: string) =>
  setStatus(id, "cancelled", ["requested", "in_design", "in_review", "approved", "done"], "Only whoever asked can cancel it.");

/** Whoever asked changes the request: what, formats, brief, link, dates, references. */
export async function updateRequest(id: string, input: RequestInput): Promise<ActionResult> {
  const { supabase } = await context();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Request not found." };
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Some values aren't valid." };
  const v = parsed.data;
  if (v.live_from && v.live_to && v.live_to < v.live_from) return { ok: false, error: "The end date has to be on or after the start date." };
  if (v.ref_paths.some((p) => !p.startsWith(`requests/${id}/refs/`))) return { ok: false, error: "A file doesn't belong to this request." };
  const { data, error } = await supabase.from("creative_requests").update(v).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only whoever asked can change it." };
  done();
  return { ok: true };
}

/** Design marks it complete, whether or not it went through review (e.g. sent another way). */
export async function markRequestComplete(id: string): Promise<ActionResult> {
  const { viewer, supabase } = await context();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Request not found." };
  const r = await load(supabase, id);
  if (!r) return { ok: false, error: "Request not found." };
  const { data, error } = await supabase
    .from("creative_requests")
    .update({ status: "done", designer_id: r.designer_id ?? viewer.id })
    .eq("id", id)
    .in("status", ["requested", "in_design", "in_review", "approved"])
    .select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only Design can mark it complete." };
  if (r.requested_by !== viewer.id)
    notifyPersonLater(r.requested_by, "my_requests", {
      title: `${personName(viewer.profile)} completed ${r.title}`,
      body: r.art_paths.length ? "The files are on the request." : null,
      href: requestPath(r.channel, id),
      actorId: viewer.id,
    });
  done();
  return { ok: true };
}

/** A comment on a request (with screenshots if pasted). The asker and the designer hear about it. */
export async function addRequestComment(id: string, body: string, images: string[] = []): Promise<ActionResult> {
  const { viewer, supabase } = await context();
  const text = body.trim();
  const pics = images.filter(isInlineImage).slice(0, 6);
  if (!uuid.safeParse(id).success) return { ok: false, error: "Request not found." };
  if (!text && !pics.length) return { ok: false, error: "Write a comment first." };
  if (text.length > 10_000) return { ok: false, error: "That comment is too long." };
  const { error } = await supabase.from("creative_request_comments").insert({ request_id: id, author_id: viewer.id, body: text, image_paths: pics });
  if (error) return { ok: false, error: friendlyError(error) };
  const r = await load(supabase, id);
  if (r)
    for (const who of new Set([r.requested_by, r.designer_id].filter((x): x is string => !!x && x !== viewer.id)))
      notifyPersonLater(who, who === r.designer_id ? "revision" : "my_requests", {
        title: `${personName(viewer.profile)} commented on ${r.title}`,
        body: text || "(a screenshot)",
        href: requestPath(r.channel, id),
        actorId: viewer.id,
      });
  done();
  return { ok: true };
}

export async function deleteRequestComment(commentId: string): Promise<ActionResult> {
  const { supabase } = await context();
  if (!uuid.safeParse(commentId).success) return { ok: false, error: "Comment not found." };
  const { data, error } = await supabase.from("creative_request_comments").delete().eq("id", commentId).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "You can only delete your own comments." };
  done();
  return { ok: true };
}
