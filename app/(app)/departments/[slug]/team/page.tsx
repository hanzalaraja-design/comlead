import { notFound } from "next/navigation";
import { DepartmentTabs } from "@/components/department-tabs";
import { PageHeader } from "@/components/page-header";
import { ScheduleEditor, TeamManager } from "@/components/departments/team-manager";
import { canLead, getDepartmentMembers, getDepartments, getPeople, getSubTeams, requireViewer } from "@/lib/auth";
import { personName } from "@/lib/labels";

export default async function DepartmentTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await requireViewer();
  const [departments, people, members, subTeams] = await Promise.all([
    getDepartments(),
    getPeople(),
    getDepartmentMembers(),
    getSubTeams(),
  ]);
  const dept = departments.find((d) => d.slug === slug);
  if (!dept) notFound();

  const peopleById = new Map(people.map((p) => [p.id, p]));
  const deptMembers = members
    .filter((m) => m.department_id === dept.id && peopleById.has(m.user_id))
    .map((m) => ({ person: peopleById.get(m.user_id)!, role: m.role }))
    .sort((a, b) => (a.role === b.role ? personName(a.person).localeCompare(personName(b.person)) : a.role === "lead" ? -1 : 1));
  const memberIds = new Set(deptMembers.map((m) => m.person.id));
  const isLead = canLead(viewer, dept.id);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Departments", href: "/departments" }, { label: dept.name, href: `/departments/${slug}` }, "Team"]}
        title={dept.name}
      />
      <DepartmentTabs slug={slug} active="team" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section>
          <h2 className="kicker mb-3 text-ink">People</h2>
          <TeamManager
            departmentId={dept.id}
            members={deptMembers}
            candidates={people.filter((p) => !memberIds.has(p.id))}
            canManage={isLead}
            isAdmin={viewer.isAdmin}
          />
          {!isLead && (
            <p className="mt-2 text-xs text-muted-foreground">Only the department Lead or Admin can add or remove people.</p>
          )}
        </section>
        <div className="space-y-8">
          <section className="surface p-4 md:p-6">
            <h2 className="kicker mb-3 text-ink">Weekly meeting</h2>
            <ScheduleEditor departmentId={dept.id} weekday={dept.meeting_weekday} time={dept.meeting_time} canEdit={isLead} />
          </section>
          <section className="surface p-4 md:p-6">
            <h2 className="kicker mb-3 text-ink">Sub-teams</h2>
            {subTeams.filter((s) => s.department_id === dept.id && !s.archived).length ? (
              <ul className="flex flex-wrap gap-2">
                {subTeams
                  .filter((s) => s.department_id === dept.id && !s.archived)
                  .map((s) => (
                    <li key={s.id} className="rounded-full bg-muted px-3 py-1 text-sm">
                      {s.name}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None.</p>
            )}
            {viewer.isAdmin && <p className="mt-2 text-xs text-muted-foreground">Manage sub-teams in Admin → Departments setup.</p>}
          </section>
        </div>
      </div>
    </>
  );
}
