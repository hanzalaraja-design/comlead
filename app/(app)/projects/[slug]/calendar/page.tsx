import { ProjectHeader, loadProject } from "@/components/projects/project-header";
import { CalendarView } from "@/components/tasks/task-views";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ProjectCalendarPage({ params, searchParams }: Props) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  const loaded = await loadProject(slug, raw);
  const month = typeof raw.month === "string" ? raw.month : undefined;
  return (
    <>
      <ProjectHeader loaded={loaded} view="calendar" month={month} />
      <CalendarView filters={loaded.filters} viewerId={loaded.viewer.id} scope={loaded.base} from="project" month={month} />
    </>
  );
}
