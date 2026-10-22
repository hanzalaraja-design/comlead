import { ProjectHeader, loadProject } from "@/components/projects/project-header";
import { ListView } from "@/components/tasks/task-views";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata = { title: "Project · Highfy Tasks" };

export default async function ProjectPage({ params, searchParams }: Props) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  const loaded = await loadProject(slug, raw);
  return (
    <>
      <ProjectHeader loaded={loaded} view="list" />
      <ListView filters={loaded.filters} viewerId={loaded.viewer.id} scope={loaded.base} from="project" showProject={false} />
    </>
  );
}
