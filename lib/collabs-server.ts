import "server-only";
import { cache } from "react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Who the viewer is in Paid social: Commercial asks and approves, Content plans and delivers, other teams an Admin picked can look and comment. */
export const collabAccess = cache(async () => {
  const [viewer, supabase] = await Promise.all([requireViewer(), createClient()]);
  const [{ data: commercial }, { data: content }, { data: settings }, { data: canUse }] = await Promise.all([
    supabase.rpc("in_placement_team", { p_role: "commercial" }),
    supabase.rpc("in_placement_team", { p_role: "content" }),
    supabase.from("placement_settings").select("content_department_id").eq("id", 1).maybeSingle(),
    // Also true for teams an Admin let in to see it (they can look and comment).
    supabase.rpc("can_use_collabs"),
  ]);
  const admin = viewer.isAdmin;
  return {
    viewer,
    admin,
    commercial: admin || commercial === true,
    content: admin || content === true,
    can: admin || commercial === true || content === true || canUse === true,
    contentDeptId: (settings?.content_department_id as string | null | undefined) ?? null,
  };
});
