import { notFound } from "next/navigation";
import { DepartmentTabs } from "@/components/department-tabs";
import { PageHeader } from "@/components/page-header";
import { TeamManager } from "@/components/departments/team-manager";
import { canLead, getDepartmentMembers, getDepartments, getPeople, requireViewer } from "@/lib/auth";
import { personName } from "@/lib/labels";

export default async function DepartmentTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await requireViewer();
  const [departments, people, members] = await Promise.all([getDepartments(), getPeople(), getDepartmentMembers()]);
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
        breadcrumb={[{ label: "Teams", href: "/departments" }, { label: dept.name, href: `/departments/${slug}` }, "People"]}
        title={dept.name}
      />
      <DepartmentTabs slug={slug} active="team" />
      <section className="max-w-2xl">
        <TeamManager
          departmentId={dept.id}
          members={deptMembers}
          candidates={people.filter((p) => !memberIds.has(p.id))}
          canManage={isLead}
          isAdmin={viewer.isAdmin}
        />
        {!isLead && <p className="mt-2 text-xs text-muted-foreground">Only this team&apos;s admin can add or remove people.</p>}
        {dept.kind === "project" && (
          <p className="mt-2 text-xs text-muted-foreground">Project team: add people from any department.</p>
        )}
      </section>
    </>
  );
}
