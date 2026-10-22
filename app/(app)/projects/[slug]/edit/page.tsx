import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ProjectForm } from "@/components/projects/project-form";
import { loadProject } from "@/components/projects/project-header";
import { getDepartments, getPeople } from "@/lib/auth";
import { getProjectMembers, getTeamDirectory } from "@/lib/projects";

export const metadata = { title: "Edit project · Highfy Tasks" };

export default async function EditProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [{ viewer, project, canManage }, departments, projectTeams, people, named] = await Promise.all([
    loadProject(slug, {}),
    getTeamDirectory(),
    getDepartments(),
    getPeople(),
    getProjectMembers(),
  ]);
  if (!canManage) notFound();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        breadcrumb={[{ label: "Projects", href: "/projects" }, { label: project.name, href: `/projects/${project.slug}` }, "Edit"]}
        title="Edit project"
      />
      <div className="card-outlined p-4 md:p-6">
        <ProjectForm
          project={project}
          memberIds={named.filter((m) => m.project_id === project.id).map((m) => m.user_id)}
          departments={[
            ...departments,
            // A project team brought in by the old setup stays listed so it isn't dropped.
            ...projectTeams.filter((d) => project.team_ids.includes(d.id) && !departments.some((x) => x.id === d.id)),
          ].map((d) => ({ id: d.id, name: d.name }))}
          people={people}
          viewerId={viewer.id}
        />
      </div>
    </div>
  );
}
