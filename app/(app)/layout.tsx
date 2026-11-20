import { AppNav } from "@/components/app-nav";
import { SubtaskPrompt } from "@/components/tasks/subtask-prompt";
import { RememberPlace } from "@/components/return-to";
import { requireViewer, viewerId } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [id, supabase] = await Promise.all([viewerId(), createClient()]);
  const [viewer, { count: unread }, { count: overdue }, { data: canPlace }, { data: placementTodo }, { data: canCollab }] = await Promise.all([
    requireViewer(),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", id).eq("in_feed", true).is("read_at", null),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("owner_id", id).eq("overdue", true),
    supabase.rpc("can_use_placements"),
    supabase.rpc("placement_todo_count"),
    // Until the Paid social SQL is run this is simply false.
    supabase.rpc("can_use_collabs").then((r) => (r.error ? { data: false } : r)),
  ]);

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <AppNav
        isAdmin={viewer.isAdmin}
        placements={!!canPlace}
        collabs={!!canCollab}
        name={personName(viewer.profile)}
        email={viewer.email}
        badges={{ "/notifications": unread ?? 0, "/overdue": overdue ?? 0, "/placements": (placementTodo as number | null) ?? 0 }}
      />
      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-12 md:pb-12 md:pt-10">{children}</main>
      <SubtaskPrompt />
      <RememberPlace />
    </div>
  );
}
