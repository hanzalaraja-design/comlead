import { MeetingLinks } from "@/components/meetings/meeting-links";
import { getProjects } from "@/lib/projects";
import type { ProjectKind } from "@/lib/types";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { notFound } from "next/navigation";
import { History, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/person-avatar";
import { RichTextView } from "@/components/rich-text-view";
import { TaskList } from "@/components/tasks/task-list";
import { MeetingEditor } from "@/components/meetings/meeting-editor";
import { canLead, getDepartmentMembers, getDepartments, getPeople, requireViewer } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { isAiConfigured } from "@/lib/ai/claude";
import { withTaskSelect, type TaskListRow } from "@/lib/tasks/queries";
import { formatDate, formatPKT, formatTime } from "@/lib/time";
import type { Meeting, PersonRef } from "@/lib/types";

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

  const [departments, people, members, attendeesRes, itemsRes, prevRes, linksRes, allProjects, logRes] = await Promise.all([
    getDepartments(),
    getPeople(),
    getDepartmentMembers(),
    supabase.from("meeting_attendees").select("user_id").eq("meeting_id", id),
    withTaskSelect((select) => supabase.from("tasks").select(select).eq("meeting_id", id).order("created_at")),
    // Carry forward: the department's previous meeting.
    supabase
      .from("meetings")
      .select("id, title, meeting_date")
      .eq(meeting.series_id ? "series_id" : "department_id", meeting.series_id ?? meeting.department_id)
      .or(`meeting_date.lt.${meeting.meeting_date},and(meeting_date.eq.${meeting.meeting_date},created_at.lt."${meeting.created_at}")`)
      .order("meeting_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // What it's about (empty if the database hasn't got links yet).
    supabase
      .from("meeting_projects")
      .select("project:projects(id, name, slug, kind)")
      .eq("meeting_id", id)
      .then((r) => (r.error ? { data: [] } : r)),
    getProjects(),
    // Who wrote and edited the minutes.
    supabase.rpc("meeting_minutes_log", { p_meeting_id: id }).then((r) => (r.error ? { data: [] } : r)),
  ]);
  const linked = ((linksRes.data ?? []) as unknown as { project: { id: string; name: string; slug: string; kind: ProjectKind } | null }[])
    .map((r) => r.project)
    .filter((p): p is { id: string; name: string; slug: string; kind: ProjectKind } => !!p);

  const dept = departments.find((d) => d.id === meeting.department_id);
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const attendeeIds = (attendeesRes.data ?? []).map((a) => a.user_id as string);
  const items = (itemsRes.data ?? []) as unknown as TaskListRow[];
  const prev = prevRes.data as { id: string; title: string | null; meeting_date: string } | null;

  let prevItems: TaskListRow[] = [];
  if (prev) {
    const { data } = await withTaskSelect((select) => supabase.from("tasks").select(select).eq("meeting_id", prev.id).order("created_at"));
    prevItems = (data ?? []) as unknown as TaskListRow[];
  }

  // One line per sitting: saves by the same person within an hour count once.
  const minutesLog: { person: PersonRef | undefined; at: string }[] = [];
  for (const e of (logRes.data ?? []) as { actor_id: string | null; created_at: string }[]) {
    const last = minutesLog[minutesLog.length - 1];
    const person = e.actor_id ? peopleById.get(e.actor_id) : undefined;
    if (last && last.person?.id === person?.id && Date.parse(e.created_at) - Date.parse(last.at) < 3600_000) last.at = e.created_at;
    else minutesLog.push({ person, at: e.created_at });
  }

  const isLead = canLead(viewer, meeting.department_id);
  // Anyone in the meeting can write the minutes (the database enforces the same rule).
  const canEdit = isLead || attendeeIds.includes(viewer.id) || meeting.created_by === viewer.id;

  const carryForward = prev && (
    <section className="surface bg-muted/30 p-4">
      <h2 className="kicker mb-1 flex items-center gap-2 text-ink">
        <History className="h-4 w-4" /> Last time&apos;s action items
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
        <PageHeader
          breadcrumb={[
            { label: "Meetings", href: "/meetings" },
            ...(dept ? [{ label: dept.name, href: `/meetings?dept=${dept.slug}` }] : []),
            { label: formatDate(meeting.meeting_date, "d MMM yyyy"), href: `/meetings/${id}` },
            "Edit",
          ]}
          title="Edit minutes"
        />
        <div className="hidden md:block">{carryForward}</div>
        {prev && (
          <details className="surface p-4 md:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink">
              <History className="h-4 w-4" /> Last time&apos;s action items
              <span className="rounded-full bg-subtle px-2 text-xs font-normal text-ink-muted">{prevItems.length}</span>
            </summary>
            <div className="mt-3">
              {prevItems.length ? <TaskList tasks={prevItems} showDepartment={false} /> : <p className="text-sm text-muted-foreground">No action items last time.</p>}
            </div>
          </details>
        )}
        {viewer.isAdmin && !isAiConfigured() && (
          <p className="text-sm text-ink-muted">
            The meeting assistant is off on this deployment.{" "}
            <Link href="/admin/assistant" className="underline">
              Check its setup
            </Link>
            .
          </p>
        )}
        <div className="card-outlined p-4 md:p-6">
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
          canDelete={isLead || meeting.created_by === viewer.id}
          aiEnabled={isAiConfigured()}
        />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Meetings", href: "/meetings" },
          ...(dept ? [{ label: dept.name, href: `/meetings?dept=${dept.slug}` }] : []),
          formatDate(meeting.meeting_date, "d MMM yyyy"),
        ]}
        title={meeting.title || `${dept?.name ?? ""} weekly meeting`}
        description={
          <>
            {formatDate(meeting.meeting_date, "EEEE d MMMM yyyy")}
            {meeting.meeting_time && ` · ${formatTime(meeting.meeting_time)}`}
            <MeetingLinks
              meetingId={id}
              linked={linked}
              options={allProjects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name, slug: p.slug, kind: p.kind }))}
              editable={canEdit}
            />
          </>
        }
        actions={
          canEdit && (
            <Button asChild size="sm">
              <Link href={`/meetings/${id}?edit=1`}>
                <Pencil className="h-4 w-4" /> Edit minutes
              </Link>
            </Button>
          )
        }
      />

      {attendeeIds.length > 0 && (
        <section className="surface p-4 md:p-6">
          <h2 className="kicker mb-2 text-ink">Attendees</h2>
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
        <section className="surface p-4 md:p-6">
          <h2 className="kicker mb-2 text-ink">Agenda</h2>
          <p className="whitespace-pre-wrap text-sm">{meeting.agenda}</p>
        </section>
      )}

      <section className="surface p-4 md:p-6">
        <h2 className="kicker mb-2 text-ink">Minutes</h2>
        {meeting.minutes ? (
          <RichTextView html={meeting.minutes} />
        ) : (
          <p className="text-sm text-muted-foreground">No minutes yet.</p>
        )}
        {minutesLog.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-ink-muted">
            {minutesLog.map((e, i) => (
              <li key={i} className="flex items-center gap-2">
                <PersonAvatar person={e.person} className="h-5 w-5" />
                <span>
                  <span className="font-semibold text-ink">{e.person ? personName(e.person) : "Someone"}</span> {i === 0 ? "wrote the minutes" : "edited them"} ·{" "}
                  {formatPKT(e.at, "d MMM, h:mm a")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="kicker mb-2 text-ink">Action items</h2>
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
