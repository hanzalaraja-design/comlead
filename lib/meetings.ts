import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDepartments, type Viewer } from "@/lib/auth";

/**
 * Departments for the meeting setup form. Anyone can invite any department,
 * so names come from the service role (names only); the person can only make
 * a meeting "belong" to departments they're in.
 */
export async function departmentsForSetup(viewer: Viewer) {
  let all: { id: string; name: string; archived: boolean }[];
  try {
    const { data } = await createAdminClient().from("departments").select("id, name, archived").order("sort_order").order("name");
    all = (data ?? []) as typeof all;
  } catch {
    all = await getDepartments();
  }
  return all
    .filter((d) => !d.archived)
    .map((d) => ({ id: d.id, name: d.name, invitable: true, mine: viewer.isAdmin || viewer.memberDeptIds.includes(d.id) }));
}
