import { MyTeamHeader, loadMyTeam } from "@/components/tasks/my-team";
import { ByToggle, PeriodTabs, WhatsUp, loadPeriodTasks, readBy, readPeriod } from "@/components/tasks/whats-up";

export const metadata = { title: "My team · Highfy Tasks" };

export default async function MyTeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const { viewer, team, choices, filters } = await loadMyTeam(raw);
  const period = readPeriod(raw, "this_week");
  const by = readBy(raw);
  const data = team && filters ? await loadPeriodTasks(filters, period, viewer.id) : null;
  return (
    <>
      <MyTeamHeader view="list" team={team} choices={choices} filters={filters} />
      {team && data && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <PeriodTabs path="/tasks/team" raw={raw} period={period} fallback="this_week" />
            <ByToggle path="/tasks/team" raw={raw} by={by} />
          </div>
          <WhatsUp data={data} period={period} by={by} path="/tasks/team" raw={raw} from="team" showDepartment={false} completedHref={`/tasks/team?team=${team.slug}&status=done&period=open`} />
        </>
      )}
    </>
  );
}
