import { AllTeamsHeader } from "@/components/tasks/all-teams-header";
import { ByToggle, PeriodTabs, WhatsUp, loadPeriodTasks, readBy, readPeriod } from "@/components/tasks/whats-up";
import { requireViewer, viewerId } from "@/lib/auth";
import { parseFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";

export const metadata = { title: "All teams · Highfy Tasks" };

/** Tasks · All teams: every team's tasks you can see, for the time picked. */
export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const [id, filters] = [await viewerId(), parseFilters(raw)];
  const period = readPeriod(raw, "this_week");
  const by = readBy(raw);
  const [, options, data] = await Promise.all([requireViewer(), getFilterOptions(), loadPeriodTasks(filters, period, id)]);
  return (
    <>
      <AllTeamsHeader view="list" filters={filters} options={options} period={period.key} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PeriodTabs path="/tasks" raw={raw} period={period} fallback="this_week" />
        <ByToggle path="/tasks" raw={raw} by={by} />
      </div>
      <WhatsUp data={data} period={period} by={by} path="/tasks" raw={raw} from="all" completedHref="/tasks?status=done&period=open" />
    </>
  );
}
