import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/person-avatar";
import { RichTextView } from "@/components/rich-text-view";
import { TaskList } from "@/components/tasks/task-list";
import { MeetingEditor } from "@/components/meetings/meeting-editor";
import { canLead, getDepartmentMembers, getDepartments, getPeople, getSubTeams, requireViewer } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { TASK_SELECT, type TaskListRow } from "@/lib/tasks/queries";
import { formatDate, formatPKT, formatTime } from "@/lib/time";
import type { Meeting } from "@/lib/types";

export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ id }, { edit }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const viewer = await requireViewer();
  const supabase = await createClient();

  const { data: meetingData } = await supabase.from("meetings").select("*").eq("id", id).maybeSingle();
  if (!meetingData) notFound();
  const meeting = meetingData as Meeting;

  const [departments, people, subTeams, members, attendeesRes, itemsRes, prevRes] = await Promise.all([
    getDepartments(),
    getPeople(),
    getSubTeams(),
    getDepartmentMembers(),
    supabase.from("meeting_attendees").select("user_id").eq("meeting_id", id),
    supabase.from("tasks").select(TASK_SELECT).eq("meeting_id", id).order("created_at"),
    // Carry forward: the department's previous meeting.
    supabase
      .from("meetings")
      .select("id, title, meeting_date")
      .eq("department_id", meeting.department_id)
      .or(`meeting_date.lt.${meeting.meeting_date},and(meeting_date.eq.${meeting.meeting_date},created_at.lt."${meeting.created_at}")`)
      .order("meeting_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const dept = departments.find((d) => d.id === meeting.department_id);
  const subTeam = subTeams.find((s) => s.id === meeting.sub_team_id);
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const attendeeIds = (attendeesRes.data ?? []).map((a) => a.user_id as string);
  const items = (itemsRes.data ?? []) as unknown as TaskListRow[];
  const prev = prevRes.data as { id: string; title: string | null; meeting_date: string } | null;

  let prevItems: TaskListRow[] = [];
  if (prev) {
    const { data } = await supabase.from("tasks").select(TASK_SELECT).eq("meeting_id", prev.id).order("created_at");
    prevItems = (data ?? []) as unknown as TaskListRow[];
  }

  const isLead = canLead(viewer, meeting.department_id);
  // Anyone in the meeting can write the minutes (the database enforces the same rule).
  const canEdit = isLead || attendeeIds.includes(viewer.id) || meeting.created_by === viewer.id;

  const carryForward = prev && (
    <section className="rounded-lg border bg-muted/30 p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4" /> Last week&apos;s action items
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        From{" "}
        <Link href={`/meetings/${prev.id}`} className="underline">
          {prev.title || "Meeting"} · {formatDate(prev.meeting_date, "EEE d MMM")}
        </Link>
        . Current status shown.
      </p>
      {prevItems.length ? (
        <TaskList tasks={prevItems} showDepartment={false} />
      ) : (
        <p className="text-sm text-muted-foreground">No action items last time.</p>
      )}
    </section>
  );

  if (edit && canEdit) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <Link href={`/meetings/${id}`} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <h1 className="text-xl font-semibold md:text-2xl">Edit minutes · {dept?.name}</h1>
        </div>
        {carryForward}
        <MeetingEditor
          meeting={meeting}
          attendeeIds={attendeeIds}
          actionItems={items.map((t) => ({
            id: t.id,
            title: t.title,
            owner_id: t.owner_id,
            due_date: t.due_date,
            priority: t.priority,
            status: t.status,
          }))}
          people={people}
          memberIds={members.filter((m) => m.department_id === meeting.department_id).map((m) => m.user_id)}
          subTeams={subTeams.filter((s) => s.department_id === meeting.department_id && !s.archived)}
          canDelete={isLead}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href={dept ? `/meetings?dept=${dept.slug}` : "/meetings"}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {dept?.name ?? "Meetings"} meetings
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold md:text-2xl">{meeting.title || `${dept?.name ?? ""} weekly meeting`}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDate(meeting.meeting_date, "EEEE d MMMM yyyy")}
              {meeting.meeting_time && ` · ${formatTime(meeting.meeting_time)}`}
              {subTeam && ` · ${subTeam.name}`}
            </p>
          </div>
          {canEdit && (
            <Button asChild size="sm">
              <Link href={`/meetings/${id}?edit=1`}>
                <Pencil className="h-4 w-4" /> Edit minutes
              </Link>
            </Button>
          )}
        </div>
      </div>

      {attendeeIds.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Attendees</h2>
          <ul className="flex flex-wrap gap-2">
            {attendeeIds.map((uid) => (
              <li key={uid} className="flex items-center gap-1.5 rounded-full bg-muted py-0.5 pl-0.5 pr-3 text-sm">
                <PersonAvatar person={peopleById.get(uid)} />
                {personName(peopleById.get(uid))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {carryForward}

      {meeting.agenda && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Agenda</h2>
          <p className="whitespace-pre-wrap text-sm">{meeting.agenda}</p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Minutes</h2>
        {meeting.minutes ? (
          <RichTextView html={meeting.minutes} />
        ) : (
          <p className="text-sm text-muted-foreground">No minutes yet.</p>
        )}
      </section>

      {meeting.decisions.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Decisions</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {meeting.decisions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Action items</h2>
        {items.length ? (
          <TaskList tasks={items} showDepartment={false} />
        ) : (
          <p className="text-sm text-muted-foreground">No action items.</p>
        )}
      </section>

      <p className="text-xs text-muted-foreground">Last updated {formatPKT(meeting.updated_at)}</p>
    </div>
  );
}
