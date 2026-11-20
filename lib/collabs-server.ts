import "server-only";
import { cache } from "react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Who the viewer is in Paid social: Commercial asks and approves, Content plans and delivers, and teams an Admin picked ask just like Commercial. */
export const collabAccess = cache(async () => {
  const [viewer, supabase] = await Promise.all([requireViewer(), createClient()]);
  const [{ data: commercial }, { data: content }, { data: settings }, { data: asker }] = await Promise.all([
    supabase.rpc("in_placement_team", { p_role: "commercial" }),
    supabase.rpc("in_placement_team", { p_role: "content" }),
    supabase.from("placement_settings").select("content_department_id").eq("id", 1).maybeSingle(),
    // Commercial, or a team an Admin picked to ask like Commercial (false before the database has it).
    supabase.rpc("is_collab_asker"),
  ]);
  const admin = viewer.isAdmin;
  return {
    viewer,
    admin,
    commercial: admin || commercial === true || asker === true,
    content: admin || content === true,
    can: admin || commercial === true || content === true || asker === true,
    contentDeptId: (settings?.content_department_id as string | null | undefined) ?? null,
  };
});
