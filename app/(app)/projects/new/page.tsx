import { PageHeader } from "@/components/page-header";
import { ProjectForm } from "@/components/projects/project-form";
import { getPeople, requireViewer } from "@/lib/auth";
import { getTeamDirectory } from "@/lib/projects";

export const metadata = { title: "New project · Highfy Tasks" };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const [viewer, teams, people, { team }] = await Promise.all([requireViewer(), getTeamDirectory(), getPeople(), searchParams]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader breadcrumb={[{ label: "Projects", href: "/projects" }, "New project"]} title="New project" />
      <div className="card-outlined p-4 md:p-6">
        <ProjectForm
          departments={teams.map((d) => ({ id: d.id, name: d.name }))}
          people={people}
          viewerId={viewer.id}
          defaultTeamIds={teams.filter((d) => d.slug === team).map((d) => d.id)}
        />
      </div>
    </div>
  );
}
