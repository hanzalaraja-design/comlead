"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { syncLater } from "@/lib/calendar/schedule";
import { syncDepartmentSeries, syncDepartmentsForUser, syncUserTasks } from "@/lib/calendar/sync";

const uuid = z.string().uuid();

async function update(table: string, id: string, patch: Record<string, unknown>, idCol = "id"): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from(table).update(patch).eq(idCol, id).select(idCol);
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) return { ok: false, error: "Not found or not allowed." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setUserStatus(userId: string, status: "active" | "disabled" | "pending"): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!uuid.safeParse(userId).success || !["active", "disabled", "pending"].includes(status)) return { ok: false, error: "Invalid input" };
  if (userId === admin.id && status !== "active") return { ok: false, error: "You can't turn off your own access." };
  const res = await update("profiles", userId, { status });
  // Access changes who gets the weekly invites and task events.
  if (res.ok) syncLater(async () => {
    await syncDepartmentsForUser(userId);
    await syncUserTasks(userId);
  });
  return res;
}

export async function setUserAdmin(userId: string, isAdmin: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!uuid.safeParse(userId).success) return { ok: false, error: "Invalid input" };
  if (userId === admin.id && !isAdmin) return { ok: false, error: "You can't remove your own Admin role." };
  return update("profiles", userId, { is_admin: !!isAdmin });
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createDepartment(name: string): Promise<ActionResult> {
  await requireAdmin();
  const n = name.trim();
  const slug = slugify(n);
  if (!n || !slug) return { ok: false, error: "Enter a name." };
  const supabase = await createClient();
  const { data: last } = await supabase.from("departments").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const { error } = await supabase
    .from("departments")
    .insert({ name: n, slug, sort_order: ((last?.[0]?.sort_order as number) ?? 0) + 1 });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function renameDepartment(id: string, name: string): Promise<ActionResult> {
  await requireAdmin();
  const n = name.trim();
  if (!n) return { ok: false, error: "Enter a name." };
  // The slug stays the same so existing links and saved views keep working.
  const res = await update("departments", id, { name: n });
  if (res.ok) syncLater(() => syncDepartmentSeries(id));
  return res;
}

export async function setDepartmentArchived(id: string, archived: boolean): Promise<ActionResult> {
  await requireAdmin();
  const res = await update("departments", id, { archived: !!archived });
  if (res.ok) syncLater(() => syncDepartmentSeries(id));
  return res;
}

export async function moveDepartment(id: string, direction: -1 | 1): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.from("departments").select("id, sort_order").order("sort_order").order("name");
  const list = (data ?? []) as { id: string; sort_order: number }[];
  const i = list.findIndex((d) => d.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return { ok: true };
  [list[i], list[j]] = [list[j], list[i]];
  for (const [index, d] of list.entries()) {
    if (d.sort_order !== index + 1) {
      const { error } = await supabase.from("departments").update({ sort_order: index + 1 }).eq("id", d.id);
      if (error) return { ok: false, error: friendlyError(error) };
    }
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function createSubTeam(departmentId: string, name: string): Promise<ActionResult> {
  await requireAdmin();
  const n = name.trim();
  if (!uuid.safeParse(departmentId).success || !n) return { ok: false, error: "Enter a name." };
  const supabase = await createClient();
  const { error } = await supabase.from("sub_teams").insert({ department_id: departmentId, name: n });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function renameSubTeam(id: string, name: string): Promise<ActionResult> {
  await requireAdmin();
  const n = name.trim();
  if (!n) return { ok: false, error: "Enter a name." };
  return update("sub_teams", id, { name: n });
}

export async function setSubTeamArchived(id: string, archived: boolean): Promise<ActionResult> {
  await requireAdmin();
  return update("sub_teams", id, { archived: !!archived });
}
