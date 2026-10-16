import { addDays, format, startOfWeek } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageHeader } from "@/components/page-header";
import { getDepartments, isMemberOf, requireViewer } from "@/lib/auth";
import { nowPKT, todayPKT } from "@/lib/time";
import type { Department } from "@/lib/types";
import { createMeeting } from "../actions";

export const metadata = { title: "New meeting · Highfy Tasks" };

/** This week's scheduled day if it hasn't passed, else today. */
function suggestedDate(d: Department | undefined): string {
  const today = todayPKT();
  if (!d?.meeting_weekday) return today;
  const scheduled = format(addDays(startOfWeek(nowPKT(), { weekStartsOn: 1 }), d.meeting_weekday - 1), "yyyy-MM-dd");
  return scheduled >= today ? scheduled : today;
}

export default async function NewMeetingPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; error?: string }>;
}) {
  const viewer = await requireViewer();
  const { dept: deptSlug, error } = await searchParams;
  const departments = (await getDepartments()).filter((d) => !d.archived && isMemberOf(viewer, d.id));
  const selected = departments.find((d) => d.slug === deptSlug) ?? departments[0];

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New meeting" description="Last week's action items will be shown at the top." />
      {departments.length === 0 ? (
        <EmptyState>You need to be in a department to start a meeting. Ask an Admin to add you.</EmptyState>
      ) : (
        <form action={createMeeting} className="space-y-4">
          {error && <p className="text-sm text-red-600">{error === "invalid" ? "Please check the date." : error}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="department_id">Department</Label>
            <select
              id="department_id"
              name="department_id"
              defaultValue={selected?.id}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" defaultValue={selected ? `${selected.name} weekly` : ""} className="h-10" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="meeting_date">Date</Label>
              <Input id="meeting_date" name="meeting_date" type="date" required defaultValue={suggestedDate(selected)} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting_time">Time</Label>
              <Input id="meeting_time" name="meeting_time" type="time" defaultValue={selected?.meeting_time?.slice(0, 5) ?? ""} className="h-10" />
            </div>
          </div>
          <Button type="submit" className="w-full sm:w-auto">
            Create and write minutes
          </Button>
        </form>
      )}
    </div>
  );
}
