import "server-only";
import { cache } from "react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Who the viewer is in Brand collabs: Commercial asks and approves, Content plans and delivers. */
export const collabAccess = cache(async () => {
  const [viewer, supabase] = await Promise.all([requireViewer(), createClient()]);
  const [{ data: commercial }, { data: content }, { data: settings }] = await Promise.all([
    supabase.rpc("in_placement_team", { p_role: "commercial" }),
    supabase.rpc("in_placement_team", { p_role: "content" }),
    supabase.from("placement_settings").select("content_department_id").eq("id", 1).maybeSingle(),
  ]);
  const admin = viewer.isAdmin;
  return {
    viewer,
    admin,
    commercial: admin || commercial === true,
    content: admin || content === true,
    can: admin || commercial === true || content === true,
    contentDeptId: (settings?.content_department_id as string | null | undefined) ?? null,
  };
});
