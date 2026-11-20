import "server-only";
import { cache } from "react";
import { getDepartments, requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Who the viewer is in Paid social: Commercial asks and approves, Content plans and delivers, and teams an Admin picked ask just like Commercial. */
export const collabAccess = cache(async () => {
  const [viewer, supabase] = await Promise.all([requireViewer(), createClient()]);
  const [{ data: commercial }, { data: content }, { data: settings }, { data: asker }, { data: extra }, departments] = await Promise.all([
    supabase.rpc("in_placement_team", { p_role: "commercial" }),
    supabase.rpc("in_placement_team", { p_role: "content" }),
    supabase.from("placement_settings").select("content_department_id, commercial_department_id").eq("id", 1).maybeSingle(),
    // Commercial, or a team an Admin picked to ask like Commercial (false before the database has it).
    supabase.rpc("is_collab_asker"),
    // The other teams that ask (empty before the database has them).
    supabase.from("placement_settings").select("paid_social_team_ids").eq("id", 1).maybeSingle().then((r) => (r.error ? { data: null } : r)),
    getDepartments(),
  ]);
  // The teams that ask, by name, for the wording: "Commercial and Brand".
  const askIds = [settings?.commercial_department_id as string | null | undefined, ...(((extra as { paid_social_team_ids?: string[] } | null)?.paid_social_team_ids) ?? [])];
  const askers = [...new Set(askIds.map((id) => departments.find((d) => d.id === id)?.name).filter((n): n is string => !!n))];
  const admin = viewer.isAdmin;
  return {
    viewer,
    admin,
    commercial: admin || commercial === true || asker === true,
    content: admin || content === true,
    can: admin || commercial === true || content === true || asker === true,
    askers: askers.length ? askers : ["Commercial"],
    contentDeptId: (settings?.content_department_id as string | null | undefined) ?? null,
  };
});
