import { AllTeamsHeader } from "@/components/tasks/all-teams-header";
import { CalendarView } from "@/components/tasks/task-views";
import { requireViewer, viewerId } from "@/lib/auth";
import { parseFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";

export const metadata = { title: "Calendar · All teams · Highfy Tasks" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const [id, filters] = [await viewerId(), parseFilters(raw)];
  const month = typeof raw.month === "string" ? raw.month : undefined;
  const [, options] = await Promise.all([requireViewer(), getFilterOptions()]);
  return (
    <>
      <AllTeamsHeader view="calendar" filters={filters} options={options} month={month} />
      <CalendarView filters={filters} viewerId={id} scope="all" from="all" month={month} />
    </>
  );
}
