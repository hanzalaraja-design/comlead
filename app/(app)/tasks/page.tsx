import { AllTeamsHeader } from "@/components/tasks/all-teams-header";
import { ListView } from "@/components/tasks/task-views";
import { requireViewer, viewerId } from "@/lib/auth";
import { parseFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";

export const metadata = { title: "All teams · Highfy Tasks" };

/** Tasks · All teams: every team's tasks you can see, as a list. */
export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [id, filters] = await Promise.all([viewerId(), searchParams.then(parseFilters)]);
  const [, options] = await Promise.all([requireViewer(), getFilterOptions()]);
  return (
    <>
      <AllTeamsHeader view="list" filters={filters} options={options} />
      <ListView filters={filters} viewerId={id} scope="all" from="all" />
    </>
  );
}
