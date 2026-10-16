import { PageHeader } from "@/components/page-header";
import { DepartmentsSetup } from "@/components/admin/departments-setup";
import { getDepartments, getSubTeams, requireAdmin } from "@/lib/auth";

export const metadata = { title: "Departments setup · Highfy Tasks" };

export default async function AdminDepartmentsPage() {
  await requireAdmin();
  const [departments, subTeams] = await Promise.all([getDepartments(), getSubTeams()]);
  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "Departments setup"]}
        title="Departments setup"
        description="Rename, reorder or archive departments, set weekly meeting times and manage sub-teams. Assign Leads under People."
      />
      <DepartmentsSetup departments={departments} subTeams={subTeams} />
    </>
  );
}
