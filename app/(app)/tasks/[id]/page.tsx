import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, NotebookPen, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/person-avatar";
import { RichTextView } from "@/components/rich-text-view";
import { DueLabel, PriorityBadge, TagList } from "@/components/tasks/task-badges";
import { StatusSelect } from "@/components/tasks/status-select";
import { TaskComments } from "@/components/tasks/task-comments";
import { TaskAttachments } from "@/components/tasks/task-attachments";
import { DeleteTaskButton } from "@/components/tasks/task-actions-menu";
import { TaskForm } from "@/components/tasks/task-form";
import { canLead, getPeople, isMemberOf, requireViewer } from "@/lib/auth";
import { describeActivity } from "@/lib/activity";
import { personName, sourceLabel } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { getTaskFormData } from "@/lib/tasks/form-data";
import { TASK_SELECT, type TaskListRow } from "@/lib/tasks/queries";
import { formatDate, formatPKT } from "@/lib/time";
import type { ActivityEntry, PersonRef } from "@/lib/types";

export default async function TaskPage({
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

  const { data: taskData } = await supabase.from("tasks").select(TASK_SELECT).eq("id", id).maybeSingle();
  if (!taskData) notFound();
  const task = taskData as unknown as TaskListRow;

  const [collabRes, commentsRes, filesRes, historyRes, people] = await Promise.all([
    supabase.from("task_collaborators").select("user_id").eq("task_id", id),
    supabase
      .from("task_comments")
      .select("id, body, created_at, author_id")
      .eq("task_id", id)
      .order("created_at"),
    supabase
      .from("task_attachments")
      .select("id, file_name, storage_path, size_bytes, uploaded_by, created_at")
      .eq("task_id", id)
      .order("created_at"),
    supabase
      .from("activity_log")
      .select("*")
      .eq("task_id", id)
      .neq("entity_type", "meeting")
      .order("created_at", { ascending: false })
      .limit(50),
    getPeople(),
  ]);

  const peopleById = new Map<string, PersonRef>(people.map((p) => [p.id, p]));
  const person = (pid: unknown) => (typeof pid === "string" ? peopleById.get(pid) ?? null : null);
  const collaboratorIds = (collabRes.data ?? []).map((c) => c.user_id as string);

  // Mirrors the database rules so the UI only offers what will work.
  const isLead = canLead(viewer, task.department_id);
  const isOwner = task.owner_id === viewer.id;
  const isCollaborator = collaboratorIds.includes(viewer.id);
  const isCreator = task.created_by === viewer.id;
  // People in the meeting an action item came from can edit and reassign it.
  const isMeetingEditor = task.meeting_id
    ? ((await supabase.rpc("can_edit_meeting", { p_meeting_id: task.meeting_id })).data as boolean | null) === true
    : false;
  const canEdit = isLead || isOwner || isCollaborator || isCreator || isMeetingEditor;
  const canContribute = isMemberOf(viewer, task.department_id) || isOwner || isCollaborator;
  const canDelete = isLead || (isCreator && (!task.owner_id || isOwner));
  const canReassign = isLead || isOwner || !task.owner_id || isMeetingEditor;

  if (edit && canEdit) {
    const formData = await getTaskFormData(viewer, task.department_id);
    return (
      <div className="mx-auto max-w-2xl">
        <Link href={`/tasks/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to task
        </Link>
        <h1 className="mb-5 text-xl font-semibold">Edit task</h1>
        <TaskForm
          task={task}
          collaboratorIds={collaboratorIds}
          departments={isLead ? formData.departments : formData.departments.filter((d) => d.id === task.department_id)}
          subTeams={formData.subTeams}
          people={formData.people}
          membersByDept={formData.membersByDept}
          canReassign={canReassign}
          canMove={isLead}
        />
      </div>
    );
  }

  const createdBy = person(task.created_by);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link
          href={task.department ? `/departments/${task.department.slug}` : "/tasks"}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {task.department?.name ?? "Tasks"}
        </Link>
        <div className="flex items-center gap-1">
          {canEdit && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/tasks/${id}?edit=1`}>
                <Pencil className="h-4 w-4" /> Edit
              </Link>
            </Button>
          )}
          {canDelete && <DeleteTaskButton taskId={id} title={task.title} />}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          <div>
            <h1 className="text-xl font-semibold leading-snug md:text-2xl">{task.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusSelect taskId={id} status={task.status} disabled={!canEdit} />
              <PriorityBadge priority={task.priority} />
              <DueLabel date={task.due_date} time={task.due_time} overdue={task.overdue} className="text-sm" />
            </div>
            {task.status === "blocked" && (
              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                <span className="font-medium">Blocked:</span> {task.blocked_reason || "No reason given"}
              </p>
            )}
          </div>

          {task.description ? (
            <RichTextView html={task.description} />
          ) : (
            <p className="text-sm text-muted-foreground">No description.</p>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold">Comments</h2>
            <TaskComments
              taskId={id}
              canComment={canContribute}
              comments={(commentsRes.data ?? []).map((c) => ({
                id: c.id as string,
                body: c.body as string,
                created_at: c.created_at as string,
                created_label: formatPKT(c.created_at as string, "d MMM, h:mm a"),
                author: person(c.author_id),
                mine: c.author_id === viewer.id,
              }))}
            />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">Files</h2>
            <TaskAttachments
              taskId={id}
              canUpload={canContribute}
              attachments={(filesRes.data ?? []).map((a) => ({
                id: a.id as string,
                file_name: a.file_name as string,
                storage_path: a.storage_path as string,
                size_bytes: a.size_bytes as number | null,
                uploaded_label: `${personName(person(a.uploaded_by))}, ${formatPKT(a.created_at as string, "d MMM")}`,
                canDelete: a.uploaded_by === viewer.id || canDelete,
              }))}
            />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">History</h2>
            {(historyRes.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No history you can see.</p>
            ) : (
              <ol className="space-y-2 border-l pl-4">
                {((historyRes.data ?? []) as ActivityEntry[]).map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="font-medium">{e.actor_id ? personName(person(e.actor_id)) : "System"}</span>{" "}
                    <span className="text-muted-foreground">{describeActivity(e, { person })}</span>
                    <span className="block text-xs text-muted-foreground">{formatPKT(e.created_at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="h-fit space-y-4 rounded-lg border p-4 text-sm lg:sticky lg:top-8">
          <Detail label="Owner">
            <span className="flex items-center gap-2">
              <PersonAvatar person={task.owner} /> {personName(task.owner)}
            </span>
          </Detail>
          {collaboratorIds.length > 0 && (
            <Detail label="Collaborators">
              <ul className="space-y-1">
                {collaboratorIds.map((cid) => (
                  <li key={cid} className="flex items-center gap-2">
                    <PersonAvatar person={person(cid)} /> {personName(person(cid))}
                  </li>
                ))}
              </ul>
            </Detail>
          )}
          <Detail label="Department">
            {task.department?.name}
            {task.sub_team && <span className="text-muted-foreground"> · {task.sub_team.name}</span>}
          </Detail>
          <Detail label="Source">
            {sourceLabel(task.source)}
            {task.meeting && (
              <Link href={`/meetings/${task.meeting.id}`} className="mt-1 flex items-center gap-1 text-primary hover:underline">
                <NotebookPen className="h-3.5 w-3.5" />
                {task.meeting.title || "Meeting"} · {formatDate(task.meeting.meeting_date, "d MMM")}
              </Link>
            )}
          </Detail>
          {task.start_date && (
            <Detail label="Start date">{formatDate(task.start_date, "EEE d MMM yyyy")}</Detail>
          )}
          {task.tags.length > 0 && (
            <Detail label="Tags">
              <TagList tags={task.tags} />
            </Detail>
          )}
          <Detail label="Created">
            {formatPKT(task.created_at)}
            {createdBy && <span className="block text-muted-foreground">by {personName(createdBy)}</span>}
          </Detail>
          <Detail label="Updated">{formatPKT(task.updated_at)}</Detail>
          {task.completed_at && <Detail label="Completed">{formatPKT(task.completed_at)}</Detail>}
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div>{children}</div>
    </div>
  );
}
