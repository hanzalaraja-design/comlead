import { PageHeader } from "@/components/page-header";
import { PlacementTeams, SectionRow, TabAccessRow, type TabAccess } from "@/components/admin/placements-settings";
import { getDepartments, getPeople, requireAdmin } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type { Section } from "@/lib/placements";

export const metadata = { title: "Placements settings · Highfy Tasks" };

export default async function PlacementsAdminPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [departments, { data: settings }, { data: sections }, tabsRes, tabTeamsRes, tabPeopleRes, people] = await Promise.all([
    getDepartments(),
    supabase.from("placement_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("placement_sections").select("*").eq("surface", "web").order("archived").order("sort"),
    // Missing before the database has them: then the section doesn't show.
    supabase.from("placement_tabs").select("key, label, owner_department_id").order("sort"),
    supabase.from("placement_tab_teams").select("tab, department_id"),
    supabase.from("placement_tab_people").select("tab, user_id"),
    getPeople(),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const tabs: TabAccess[] = tabsRes.error
    ? []
    : ((tabsRes.data ?? []) as { key: string; label: string; owner_department_id: string | null }[]).map((t) => ({
        key: t.key,
        label: t.label,
        owner: t.owner_department_id,
        teams: ((tabTeamsRes.data ?? []) as { tab: string; department_id: string }[]).filter((x) => x.tab === t.key).map((x) => x.department_id),
        people: ((tabPeopleRes.data ?? []) as { tab: string; user_id: string }[])
          .filter((x) => x.tab === t.key)
          .map((x) => ({ id: x.user_id, name: byId.get(x.user_id) ? personName(byId.get(x.user_id)!) : "Someone" })),
      }));
  const teamOptions = departments.filter((d) => !d.archived).map((d) => ({ id: d.id, name: d.name }));

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        breadcrumb={["Admin", "Placements"]}
        title="Placements"
        description="Who books, designs and puts banners live, and the slots on the homepage."
      />

      <section className="space-y-3">
        <h2 className="kicker text-ink">Teams</h2>
        <PlacementTeams
          departments={departments.filter((d) => !d.archived).map((d) => ({ id: d.id, name: d.name }))}
          initial={{
            commercial: settings?.commercial_department_id ?? null,
            design: settings?.design_department_id ?? null,
            tech: settings?.tech_department_id ?? null,
            content: (settings as { content_department_id?: string | null } | null)?.content_department_id ?? null,
          }}
        />
      </section>

      {tabs.length > 0 && (
        <section className="space-y-3">
          <h2 className="kicker text-ink">Who sees each tab</h2>
          <p className="text-sm text-ink-muted">
            The Design and Tech teams and Admins see every tab; the Design list is only for Design. Everyone else sees the tabs of their teams and
            their own requests. Anyone can ask for access, and the lead picked here (or an Admin) decides.
          </p>
          <div className="surface">
            {tabs.map((t) => (
              <TabAccessRow key={t.key} tab={t} departments={teamOptions} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="kicker text-ink">Homepage slots</h2>
        <p className="text-sm text-ink-muted">In the order they appear on highfy.pk, hidden ones last. The banner size shows on every booking for Design. Commercial can move, add and hide sections from Placements › Edit layout.</p>
        <div className="surface">
          {((sections ?? []) as Section[]).map((s) => (
            <SectionRow key={s.key} section={s} />
          ))}
        </div>
      </section>

    </div>
  );
}
