import { ProjectHeader, loadProject } from "@/components/projects/project-header";
import { BoardView } from "@/components/tasks/task-views";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ProjectBoardPage({ params, searchParams }: Props) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  const loaded = await loadProject(slug, raw);
  return (
    <>
      <ProjectHeader loaded={loaded} view="board" />
      <BoardView filters={loaded.filters} viewerId={loaded.viewer.id} scope={loaded.base} from="project" />
    </>
  );
}
