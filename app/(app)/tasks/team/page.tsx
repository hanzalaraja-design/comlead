import { MyTeamHeader, loadMyTeam } from "@/components/tasks/my-team";
import { ListView } from "@/components/tasks/task-views";

export const metadata = { title: "My team · Highfy Tasks" };

export default async function MyTeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { viewer, team, choices, filters } = await loadMyTeam(await searchParams);
  return (
    <>
      <MyTeamHeader view="list" team={team} choices={choices} filters={filters} />
      {team && filters && (
        <ListView filters={filters} viewerId={viewer.id} scope="team" from="team" extra={{ team: team.slug }} showDepartment={false} />
      )}
    </>
  );
}
