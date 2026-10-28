"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { domainHref, projectSlug } from "@/lib/projects";
import type { ProjectKind } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const projectSchema = z.object({
  name: z.string().trim().min(1, "Give it a name").max(120),
  kind: z.enum(["project", "campaign", "partnership"]),
  category: z
    .string()
    .optional()
    .transform((v) => (v === "beauty" || v === "non_beauty" ? v : null)),
  // Picked owners: they can lock it. At least one.
  owners: z.array(uuid).min(1, "Pick at least one owner").max(20),
  start_date: isoDate,
  end_date: isoDate,
  // None = across teams, just the people picked.
  teams: z.array(uuid).max(50),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => v || null),
  members: z.array(uuid).max(200),
});

function readProjectForm(formData: FormData) {
  return projectSchema.safeParse({
    name: formData.get("name") ?? "",
    kind: formData.get("kind") ?? "project",
    category: formData.get("category") ?? undefined,
    owners: formData.getAll("owners").map(String).filter(Boolean),
    start_date: formData.get("start_date") ?? undefined,
    end_date: formData.get("end_date") ?? undefined,
    teams: formData.getAll("teams").map(String).filter(Boolean),
    description: formData.get("description") ?? undefined,
    members: formData.getAll("members").map(String).filter(Boolean),
  });
}

function checkDates(v: { start_date: string | null; end_date: string | null }): string | null {
  return v.start_date && v.end_date && v.end_date < v.start_date ? "The end date is before the start." : null;
}

/** Make the project's teams exactly these. */
async function setTeams(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string, want: string[]) {
  const { data: current } = await supabase.from("project_teams").select("department_id").eq("project_id", projectId);
  const have = new Set((current ?? []).map((t) => t.department_id as string));
  const toAdd = [...new Set(want)].filter((t) => !have.has(t));
  const toRemove = [...have].filter((t) => !want.includes(t));
  if (toAdd.length) {
    const { error } = await supabase.from("project_teams").insert(toAdd.map((department_id) => ({ project_id: projectId, department_id })));
    if (error) return error;
  }
  if (toRemove.length) {
    const { error } = await supabase.from("project_teams").delete().eq("project_id", projectId).in("department_id", toRemove);
    if (error) return error;
  }
  return null;
}

function revalidateProjects() {
  revalidatePath("/", "layout");
}

/**
 * Make its people exactly these: owners first (so an owner is always making
 * the change), then members, then whoever is no longer in it.
 */
async function setPeople(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string, owners: string[], members: string[]) {
  const ownerSet = new Set(owners);
  const memberSet = new Set(members.filter((m) => !ownerSet.has(m)));
  const { data: current } = await supabase.from("project_members").select("user_id, role").eq("project_id", projectId);
  const have = new Map((current ?? []).map((m) => [m.user_id as string, m.role as string]));

  const upserts = [
    ...[...ownerSet].filter((u) => have.get(u) !== "lead").map((user_id) => ({ project_id: projectId, user_id, role: "lead" })),
    ...[...memberSet].filter((u) => have.get(u) !== "member").map((user_id) => ({ project_id: projectId, user_id, role: "member" })),
  ];
  if (upserts.length) {
    const { error } = await supabase.from("project_members").upsert(upserts, { onConflict: "project_id,user_id" });
    if (error) return error;
  }
  const gone = [...have.keys()].filter((u) => !ownerSet.has(u) && !memberSet.has(u));
  if (gone.length) {
    const { error } = await supabase.from("project_members").delete().eq("project_id", projectId).in("user_id", gone);
    if (error) return error;
  }
  return null;
}

/** Anyone can start a project, campaign or partnership, and picks its owners. */
export async function createProject(formData: FormData): Promise<ActionResult<{ href: string }>> {
  const viewer = await requireViewer();
  const parsed = readProjectForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details" };
  const v = parsed.data;
  if (v.kind === "partnership" && !v.category) return { ok: false, error: "Is it a beauty or a non-beauty brand?" };
  const bad = checkDates(v);
  if (bad) return { ok: false, error: bad };

  const supabase = await createClient();
  // Slugs are unique across every project, including ones you can't see: try a few.
  const base = projectSlug(v.name);
  let project: { id: string; slug: string; kind: ProjectKind } | null = null;
  for (let i = 0; i < 6 && !project; i++) {
    const slug = i === 0 ? base : `${base}-${i === 1 ? new Date().getFullYear() : Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await supabase
      .from("projects")
      .insert({
        name: v.name,
        slug,
        kind: v.kind,
        category: v.kind === "partnership" ? v.category : null,
        start_date: v.start_date,
        end_date: v.end_date,
        description: v.description,
        created_by: viewer.id,
      })
      .select("id, slug, kind")
      .single();
    if (data) project = data as { id: string; slug: string; kind: ProjectKind };
    else if (error?.code !== "23505") return { ok: false, error: friendlyError(error) };
  }
  if (!project) return { ok: false, error: "Try a different name." };

  // You become its first owner, so you can add the others; then the list is made exact.
  const { error: claim } = await supabase.from("project_members").insert({ project_id: project.id, user_id: viewer.id, role: "lead" });
  if (claim) return { ok: false, error: friendlyError(claim) };
  const mErr = await setPeople(supabase, project.id, v.owners, v.members);
  if (mErr) return { ok: false, error: friendlyError(mErr) };
  const tErr = await setTeams(supabase, project.id, v.teams);
  if (tErr) return { ok: false, error: friendlyError(tErr) };

  revalidateProjects();
  return { ok: true, data: { href: domainHref(project) } };
}

export async function updateProject(projectId: string, formData: FormData): Promise<ActionResult<{ href: string }>> {
  await requireViewer();
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project" };
  const parsed = readProjectForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details" };
  const v = parsed.data;
  const bad = checkDates(v);
  if (bad) return { ok: false, error: bad };
  if (v.kind === "partnership" && !v.category) return { ok: false, error: "Is it a beauty or a non-beauty brand?" };

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("projects")
    .update({
      name: v.name,
      kind: v.kind,
      category: v.kind === "partnership" ? v.category : null,
      start_date: v.start_date,
      end_date: v.end_date,
      description: v.description,
      department_id: null,
    })
    .eq("id", projectId)
    .select("slug, kind");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!updated?.length) return { ok: false, error: "It's locked: only its owners can change it." };

  const tErr = await setTeams(supabase, projectId, v.teams);
  if (tErr) return { ok: false, error: friendlyError(tErr) };

  const mErr = await setPeople(supabase, projectId, v.owners, v.members);
  if (mErr) return { ok: false, error: friendlyError(mErr) };

  revalidateProjects();
  return { ok: true, data: { href: domainHref(updated[0] as { slug: string; kind: ProjectKind }) } };
}

/** Finished projects are archived, not deleted: their tasks keep their history. */
export async function setProjectArchived(projectId: string, archived: boolean): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").update({ archived }).eq("id", projectId).select("slug");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "It's locked: only its owners can change it." };
  revalidateProjects();
  return { ok: true };
}

/** Owners lock it so only they can change it; task owners can still work on their tasks. */
export async function setProjectLocked(projectId: string, locked: boolean): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").update({ locked }).eq("id", projectId).select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only its owners can lock or unlock it." };
  revalidateProjects();
  return { ok: true };
}
