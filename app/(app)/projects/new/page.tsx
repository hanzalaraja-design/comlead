import { PageHeader } from "@/components/page-header";
import { ProjectForm } from "@/components/projects/project-form";
import { getDepartments, getPeople, requireViewer } from "@/lib/auth";

export const metadata = { title: "New project · Highfy Tasks" };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const [viewer, departments, people, { team }] = await Promise.all([requireViewer(), getDepartments(), getPeople(), searchParams]);
  const mine = departments.filter((d) => !d.archived && d.kind !== "project" && (viewer.isAdmin || viewer.memberDeptIds.includes(d.id)));
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader breadcrumb={[{ label: "Tasks", href: "/my" }, { label: "Projects", href: "/projects" }, "New project"]} title="New project" />
      <div className="card-outlined p-4 md:p-6">
        <ProjectForm
          departments={mine.map((d) => ({ id: d.id, name: d.name }))}
          people={people}
          viewerId={viewer.id}
          defaultDepartmentId={mine.find((d) => d.slug === team)?.id}
        />
      </div>
    </div>
  );
}
