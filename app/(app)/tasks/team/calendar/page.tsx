import { MyTeamHeader, loadMyTeam } from "@/components/tasks/my-team";
import { CalendarView } from "@/components/tasks/task-views";

export const metadata = { title: "Calendar · My team · Highfy Tasks" };

export default async function MyTeamCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const { viewer, team, choices, filters } = await loadMyTeam(raw);
  const month = typeof raw.month === "string" ? raw.month : undefined;
  return (
    <>
      <MyTeamHeader view="calendar" team={team} choices={choices} filters={filters} month={month} />
      {team && filters && (
        <CalendarView filters={filters} viewerId={viewer.id} scope="team" from="team" month={month} extra={{ team: team.slug }} />
      )}
    </>
  );
}
