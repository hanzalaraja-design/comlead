import { PageHeader } from "@/components/page-header";
import { PlacementTeams, SectionRow, TestEmailButton } from "@/components/admin/placements-settings";
import { getDepartments, requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Section } from "@/lib/placements";

export const metadata = { title: "Placements settings · Highfy Tasks" };

export default async function PlacementsAdminPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [departments, { data: settings }, { data: sections }] = await Promise.all([
    getDepartments(),
    supabase.from("placement_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("placement_sections").select("*").eq("surface", "web").order("sort"),
  ]);

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
          }}
        />
      </section>

      <section className="space-y-3">
        <h2 className="kicker text-ink">Homepage slots</h2>
        <p className="text-sm text-ink-muted">In the order they appear on highfy.pk. The banner size shows on every booking for Design.</p>
        <div className="surface">
          {((sections ?? []) as Section[]).map((s) => (
            <SectionRow key={s.key} section={s} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="kicker text-ink">Emails</h2>
        <p className="text-sm text-ink-muted">
          Emails come from the Highfy Tasks mailbox. Microsoft needs the Mail.Send permission for this. Send yourself a test to check.
        </p>
        <TestEmailButton />
      </section>
    </div>
  );
}
