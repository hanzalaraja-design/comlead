import { MyTeamHeader, loadMyTeam } from "@/components/tasks/my-team";
import { BoardView } from "@/components/tasks/task-views";
import { isMemberOf } from "@/lib/auth";

export const metadata = { title: "Board · My team · Highfy Tasks" };

export default async function MyTeamBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { viewer, team, choices, filters } = await loadMyTeam(await searchParams);
  return (
    <>
      <MyTeamHeader view="board" team={team} choices={choices} filters={filters} />
      {team && filters && (
        <BoardView
          filters={filters}
          viewerId={viewer.id}
          scope="team"
          from="team"
          extra={{ team: team.slug }}
          canEdit={isMemberOf(viewer, team.id)}
          showDepartment={false}
        />
      )}
    </>
  );
}
