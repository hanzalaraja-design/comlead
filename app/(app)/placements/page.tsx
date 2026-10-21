import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { PlacementsBoard } from "@/components/placements/placements-board";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PLACEMENT_COLUMNS, type Placement, type PlacementRole, type Section } from "@/lib/placements";
import { todayPKT } from "@/lib/time";

export const metadata = { title: "Placements · Highfy Tasks" };

export default async function PlacementsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const [viewer, supabase, sp] = await Promise.all([requireViewer(), createClient(), searchParams]);
  const [{ data: roleData }, { data: sectionData }, { data: placementData }, { data: settings }] = await Promise.all([
    supabase.rpc("placement_roles"),
    supabase.from("placement_sections").select("*").eq("surface", "web").eq("archived", false).order("sort"),
    supabase.from("placements").select(PLACEMENT_COLUMNS).neq("stage", "ended").order("starts_on"),
    supabase.from("placement_settings").select("commercial_department_id, design_department_id, tech_department_id").eq("id", 1).maybeSingle(),
  ]);
  const roles = ((roleData ?? []) as PlacementRole[]).sort(
    (a, b) => ["commercial", "design", "tech"].indexOf(a) - ["commercial", "design", "tech"].indexOf(b),
  );

  if (!roles.length) {
    return (
      <>
        <PageHeader breadcrumb={["Placements"]} title="Homepage placements" />
        <p className="surface px-4 py-6 text-sm text-ink-muted">
          This is for the Commercial, Design and Tech teams. Ask an Admin if you need it.
        </p>
      </>
    );
  }

  const placements = (placementData ?? []) as unknown as Placement[];
  const paths = placements.flatMap((p) => [...p.inspo_paths, ...(p.artwork_path ? [p.artwork_path] : [])]);
  const { data: signed } = paths.length
    ? await supabase.storage.from("placement-files").createSignedUrls(paths, 3600)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urls = Object.fromEntries((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path!, s.signedUrl as string]));

  // Open on the job of the team you're actually in.
  const teamOf: Record<PlacementRole, string | null | undefined> = {
    commercial: settings?.commercial_department_id,
    design: settings?.design_department_id,
    tech: settings?.tech_department_id,
  };
  const defaultRole = roles.find((r) => teamOf[r] && viewer.memberDeptIds.includes(teamOf[r]!)) ?? roles[0];
  const unset = (["commercial", "design", "tech"] as const).filter((r) => !teamOf[r]);

  return (
    <>
      <PageHeader
        breadcrumb={["Placements", "Web"]}
        title="Homepage placements"
        description="What's on highfy.pk, and who needs to do what next."
      />
      {viewer.isAdmin && unset.length > 0 && (
        <p className="mb-4 rounded-[14px] bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          Pick which team is {unset.join(", ")} in{" "}
          <Link href="/admin/placements" className="font-semibold underline">
            Admin · Placements
          </Link>{" "}
          so the right people see this page and get the emails.
        </p>
      )}
      <PlacementsBoard
        sections={(sectionData ?? []) as Section[]}
        placements={placements}
        urls={urls}
        roles={roles}
        defaultRole={defaultRole}
        today={todayPKT()}
        openId={sp.open && /^[0-9a-f-]{36}$/.test(sp.open) ? sp.open : null}
      />
    </>
  );
}
