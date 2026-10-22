import { MyHeader, myFilters } from "@/components/tasks/my-header";
import { BoardView } from "@/components/tasks/task-views";
import { viewerId } from "@/lib/auth";
import { getFilterOptions } from "@/lib/tasks/filter-options";

export const metadata = { title: "Board · My tasks · Highfy Tasks" };

export default async function MyBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [id, filters, options] = await Promise.all([viewerId(), searchParams.then(myFilters), getFilterOptions()]);
  return (
    <>
      <MyHeader view="board" filters={filters} options={options} />
      <BoardView filters={filters} viewerId={id} scope="my" from="my" />
    </>
  );
}
