import { MyHeader, myFilters } from "@/components/tasks/my-header";
import { CalendarView } from "@/components/tasks/task-views";
import { viewerId } from "@/lib/auth";
import { getFilterOptions } from "@/lib/tasks/filter-options";

export const metadata = { title: "Calendar · My tasks · Highfy Tasks" };

export default async function MyCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [id, raw, options] = await Promise.all([viewerId(), searchParams, getFilterOptions()]);
  const filters = myFilters(raw);
  const month = typeof raw.month === "string" ? raw.month : undefined;
  return (
    <>
      <MyHeader view="calendar" filters={filters} options={options} month={month} />
      <CalendarView filters={filters} viewerId={id} scope="my" from="my" month={month} />
    </>
  );
}
