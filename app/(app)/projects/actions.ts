"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { projectSlug } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const projectSchema = z.object({
  name: z.string().trim().min(1, "Give the project a name").max(120),
  kind: z.enum(["project", "campaign"]),
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

function revalidateProjects(slug?: string) {
  revalidatePath("/projects");
  if (slug) revalidatePath(`/projects/${slug}`, "layout");
}

/** Anyone can start a project. Whoever does is its lead. */
export async function createProject(formData: FormData): Promise<ActionResult<{ slug: string }>> {
  const viewer = await requireViewer();
  const parsed = readProjectForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details" };
  const v = parsed.data;
  if (!v.teams.length && v.members.filter((m) => m !== viewer.id).length === 0)
    return { ok: false, error: "Pick a team or add the people working on it." };
  const bad = checkDates(v);
  if (bad) return { ok: false, error: bad };

  const supabase = await createClient();
  // Slugs are unique across every project, including ones you can't see: try a few.
  const base = projectSlug(v.name);
  let project: { id: string; slug: string } | null = null;
  for (let i = 0; i < 6 && !project; i++) {
    const slug = i === 0 ? base : `${base}-${i === 1 ? new Date().getFullYear() : Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: v.name, slug, kind: v.kind, start_date: v.start_date, end_date: v.end_date, description: v.description, created_by: viewer.id })
      .select("id, slug")
      .single();
    if (data) project = data as { id: string; slug: string };
    else if (error?.code !== "23505") return { ok: false, error: friendlyError(error) };
  }
  if (!project) return { ok: false, error: "Try a different name." };

  const rows = [...new Set([viewer.id, ...v.members])].map((user_id) => ({
    project_id: project!.id,
    user_id,
    role: user_id === viewer.id ? "lead" : "member",
  }));
  const { error: mErr } = await supabase.from("project_members").insert(rows);
  if (mErr) return { ok: false, error: friendlyError(mErr) };
  const tErr = await setTeams(supabase, project.id, v.teams);
  if (tErr) return { ok: false, error: friendlyError(tErr) };

  revalidateProjects();
  return { ok: true, data: { slug: project.slug } };
}

export async function updateProject(projectId: string, formData: FormData): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project" };
  const parsed = readProjectForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details" };
  const v = parsed.data;
  const bad = checkDates(v);
  if (bad) return { ok: false, error: bad };

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("projects")
    .update({ name: v.name, kind: v.kind, start_date: v.start_date, end_date: v.end_date, description: v.description, department_id: null })
    .eq("id", projectId)
    .select("slug, created_by");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!updated?.length) return { ok: false, error: "Only the project's leads and Admins can change it." };

  const tErr = await setTeams(supabase, projectId, v.teams);
  if (tErr) return { ok: false, error: friendlyError(tErr) };

  // People picked by name. Leads stay leads; the creator is never dropped.
  const { data: current } = await supabase.from("project_members").select("user_id, role").eq("project_id", projectId);
  const have = new Map((current ?? []).map((m) => [m.user_id as string, m.role as string]));
  const want = new Set(v.members);
  const creator = updated[0].created_by as string | null;
  if (creator) want.add(creator);
  const toAdd = [...want].filter((u) => !have.has(u));
  const toRemove = [...have.keys()].filter((u) => !want.has(u));
  if (toAdd.length) {
    const { error: e } = await supabase.from("project_members").insert(toAdd.map((user_id) => ({ project_id: projectId, user_id })));
    if (e) return { ok: false, error: friendlyError(e) };
  }
  if (toRemove.length) {
    const { error: e } = await supabase.from("project_members").delete().eq("project_id", projectId).in("user_id", toRemove);
    if (e) return { ok: false, error: friendlyError(e) };
  }

  revalidateProjects(updated[0].slug as string);
  return { ok: true };
}

/** Finished projects are archived, not deleted: their tasks keep their history. */
export async function setProjectArchived(projectId: string, archived: boolean): Promise<ActionResult> {
  await requireViewer();
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").update({ archived }).eq("id", projectId).select("slug");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Only the project's leads and Admins can change it." };
  revalidateProjects(data[0].slug as string);
  return { ok: true };
}
