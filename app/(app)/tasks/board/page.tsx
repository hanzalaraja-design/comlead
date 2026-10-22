import { AllTeamsHeader } from "@/components/tasks/all-teams-header";
import { BoardView } from "@/components/tasks/task-views";
import { requireViewer, viewerId } from "@/lib/auth";
import { parseFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";

export const metadata = { title: "Board · All teams · Highfy Tasks" };

export default async function TaskBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [id, filters] = await Promise.all([viewerId(), searchParams.then(parseFilters)]);
  const [, options] = await Promise.all([requireViewer(), getFilterOptions()]);
  return (
    <>
      <AllTeamsHeader view="board" filters={filters} options={options} />
      <BoardView filters={filters} viewerId={id} scope="all" from="all" />
    </>
  );
}
