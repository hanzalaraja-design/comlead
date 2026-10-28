import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { notFound } from "next/navigation";
import { CornerDownRight, FolderKanban, NotebookPen } from "lucide-react";
import { CollaboratorsField, InlineNotes, InlineTitle, LinkTags, TaskLockSwitch, TeamsField } from "@/components/tasks/task-inline";
import { InlineDue, InlineOwner, InlinePriority, PeopleProvider } from "@/components/tasks/inline-edit";
import { getProjects, getTeamNames } from "@/lib/projects";
import { SubtaskSection } from "@/components/tasks/subtasks";
import { DOMAINS, domainHref } from "@/lib/domains";
import { PersonAvatar } from "@/components/person-avatar";
import { DueLabel, PriorityBadge, StatusBadge } from "@/components/tasks/task-badges";
import { StatusSelect } from "@/components/tasks/status-select";
import { TaskComments } from "@/components/tasks/task-comments";
import { TaskAttachments } from "@/components/tasks/task-attachments";
import { TaskMenu } from "@/components/tasks/task-actions-menu";
import { BackLink } from "@/components/return-to";
import { TaskForm } from "@/components/tasks/task-form";
import { canLead, getPeople, isMemberOf, requireViewer } from "@/lib/auth";
import { describeActivity } from "@/lib/activity";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { getTaskFormData } from "@/lib/tasks/form-data";
import { TASK_SELECT, withTaskSelect, type TaskListRow } from "@/lib/tasks/queries";
import { formatDate, formatPKT } from "@/lib/time";
import { isTaskFrom, taskHref, taskTrail } from "@/lib/tasks/scope";
import type { ActivityEntry, PersonRef, TaskStatus } from "@/lib/types";

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; from?: string }>;
}) {
  const [{ id }, { edit, from: fromParam }] = await Promise.all([params, searchParams]);
  const from = isTaskFrom(fromParam) ? fromParam : undefined;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const viewer = await requireViewer();
  const supabase = await createClient();

  const { data: taskData } = await withTaskSelect((select) => supabase.from("tasks").select(select).eq("id", id).maybeSingle());
  if (!taskData) notFound();
  const task = taskData as unknown as TaskListRow;

  const [collabRes, commentsRes, filesRes, historyRes, people, subtasksRes, teamsRes, teamNames, allProjects, meetingsRes, dbCanEdit, dbCanDelete] = await Promise.all([
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
    // "Needed from others": soonest first, finished last.
    task.parent_task_id
      ? Promise.resolve({ data: [] })
      : supabase.from("tasks").select(TASK_SELECT).eq("parent_task_id", id).order("due_date", { ascending: true, nullsFirst: false }).order("created_at").then((r) => (r.error ? { data: [] } : r)),
    // Its extra teams (empty if the database hasn't got them yet).
    supabase.from("task_teams").select("department_id").eq("task_id", id).then((r) => (r.error ? { data: [] } : r)),
    getTeamNames(),
    getProjects(),
    supabase.from("meetings").select("id, title, meeting_date").order("meeting_date", { ascending: false }).limit(40),
    // The database's own answer, which knows about locks and every team.
    supabase.rpc("can_edit_task", { p_task_id: id }),
    supabase.rpc("can_delete_task", { p_task_id: id }),
  ]);
  const extraTeamIds = ((teamsRes.data ?? []) as { department_id: string }[]).map((t) => t.department_id);
  const subtasks = ((subtasksRes.data ?? []) as unknown as TaskListRow[]).sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));
  // Everyone who got this same task, when it was given to several people at once.
  const { data: setData } = task.set_id
    ? await supabase.from("tasks").select("id, status, owner_id, due_date").eq("set_id", task.set_id).is("deleted_at", null)
    : { data: null };
  const set = (setData ?? []) as { id: string; status: TaskStatus; owner_id: string | null; due_date: string | null }[];

  const peopleById = new Map<string, PersonRef>(people.map((p) => [p.id, p]));
  // Opening the task counts as reading any mentions of you in it.
  await supabase.from("task_mentions").update({ seen_at: new Date().toISOString() }).eq("task_id", id).eq("user_id", viewer.id).is("seen_at", null);
  const person = (pid: unknown) => (typeof pid === "string" ? peopleById.get(pid) ?? null : null);
  const collaboratorIds = (collabRes.data ?? []).map((c) => c.user_id as string);

  // Mirrors the database rules so the UI only offers what will work.
  const isLead = canLead(viewer, task.department_id);
  const isOwner = task.owner_id === viewer.id;
  const isCollaborator = collaboratorIds.includes(viewer.id);
  const isCreator = task.created_by === viewer.id;
  // People in the meeting an action item came from can edit and reassign it.
  const rpcTrue = async (fn: string, args: Record<string, string>) => ((await supabase.rpc(fn, args)).data as boolean | null) === true;
  const [isMeetingEditor, inProject, managesProject, editsParent] = await Promise.all([
    task.meeting_id ? rpcTrue("can_edit_meeting", { p_meeting_id: task.meeting_id }) : false,
    // Everyone in a project shares its tasks.
    task.project_id ? rpcTrue("is_project_member", { p_project_id: task.project_id }) : false,
    task.project_id ? rpcTrue("can_manage_project", { p_project_id: task.project_id }) : false,
    // Whoever runs the main task runs its subtasks too.
    task.parent_task_id ? rpcTrue("can_edit_task", { p_task_id: task.parent_task_id }) : false,
  ]);
  const canEdit =
    typeof dbCanEdit.data === "boolean" ? dbCanEdit.data : isLead || isOwner || isCollaborator || isCreator || isMeetingEditor || inProject || editsParent;
  const locked = !!task.locked;
  const canContribute = isMemberOf(viewer, task.department_id) || isOwner || isCollaborator || inProject;
  const canDelete =
    typeof dbCanDelete.data === "boolean" ? dbCanDelete.data : isLead || managesProject || editsParent || (isCreator && (!task.owner_id || isOwner));
  // Anyone who can edit a task can hand it to anyone.
  const canReassign = canEdit;

  if (edit && canEdit) {
    const formData = await getTaskFormData(viewer, task.department_id ?? undefined, task.project_id ?? undefined);
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader
          breadcrumb={[{ label: "Tasks", href: "/my" }, { label: task.title, href: taskHref(id, from) }, "Edit"]}
          title="Edit task"
        />
        <div className="card-outlined p-4 md:p-6">
        <TaskForm
          task={task}
          collaboratorIds={collaboratorIds}
          departments={isLead ? formData.departments : formData.departments.filter((d) => d.id === task.department_id)}
          people={formData.people}
          membersByDept={formData.membersByDept}
          projects={formData.projects}
          membersByProject={formData.membersByProject}
          canReassign={canReassign}
          canMove={isLead}
          isSubtask={!!task.parent_task_id}
        />
        </div>
      </div>
    );
  }

  const createdBy = person(task.created_by);
  const trail = task.parent
    ? [{ label: "Tasks", href: "/my" }, { label: shortTitle(task.parent.title), href: `/tasks/${task.parent.id}` }]
    : taskTrail(from, task, personName(task.owner));
  const home = trail[trail.length - 1];

  return (
    <PeopleProvider people={people}>
    <div className="mx-auto max-w-5xl">
      <BackLink taskId={id} fallback={home} />
      <PageHeader
        breadcrumb={[...trail, shortTitle(task.title)]}
        title={<InlineTitle taskId={id} title={task.title} editable={canEdit} />}
        description={
          (canEdit || task.project || task.meeting) && (
            <LinkTags
              taskId={id}
              project={task.project ?? null}
              meeting={task.meeting ?? null}
              projects={allProjects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name, slug: p.slug, kind: p.kind }))}
              meetings={(meetingsRes.data ?? []) as { id: string; title: string | null; meeting_date: string }[]}
              editable={canEdit && !task.parent_task_id}
            />
          )
        }
        actions={<TaskMenu taskId={id} title={task.title} subtasks={subtasks.length} canDelete={canDelete} fallback={home.href} />}
      />
      {locked && (
        <p className="-mt-2 mb-4 rounded-[12px] bg-warning-soft px-3 py-2 text-sm text-warning-ink">
          Locked by its owner{task.owner ? `, ${personName(task.owner)}` : ""}. Only they can change it.
        </p>
      )}
      {canEdit && !locked && <p className="-mt-3 mb-4 text-xs text-ink-muted">Click any field to change it. It saves as you go.</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          <div className="card-outlined space-y-4 p-4 md:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusSelect taskId={id} status={task.status} disabled={!canEdit} />
              {canEdit ? <InlinePriority taskId={id} priority={task.priority} /> : <PriorityBadge priority={task.priority} />}
              {canEdit ? (
                <InlineDue taskId={id} date={task.due_date} time={task.due_time} overdue={task.overdue} />
              ) : (
                <DueLabel date={task.due_date} time={task.due_time} overdue={task.overdue} className="text-sm" />
              )}
            </div>
            {task.status === "blocked" && (
              <p className="rounded-[12px] bg-warning-soft px-3 py-2 text-sm text-warning-ink">
                <span className="font-medium">Blocked:</span> {task.blocked_reason || "No reason given"}
              </p>
            )}
            {task.parent && (
              <p className="flex items-center gap-1.5 rounded-[12px] bg-subtle px-3 py-2 text-sm text-ink">
                <CornerDownRight className="h-4 w-4 shrink-0 text-ink-muted" />
                <span>
                  Part of <Link href={`/tasks/${task.parent.id}`} className="font-semibold text-brand-primary hover:underline">{task.parent.title}</Link>
                  {task.created_by && task.created_by !== task.owner_id && <> · asked by {personName(createdBy)}</>}
                </span>
              </p>
            )}
            <InlineNotes taskId={id} html={task.description} editable={canEdit} />
          </div>

          {!task.parent_task_id && (
            <SubtaskSection
              parentId={id}
              parentDue={task.due_date}
              people={people}
              canAdd={canEdit && !["done", "cancelled"].includes(task.status)}
              subtasks={subtasks.map((s) => ({
                id: s.id,
                title: s.title,
                status: s.status,
                due_date: s.due_date,
                due_time: s.due_time,
                overdue: s.overdue,
                owner: s.owner,
                completed_at: s.completed_at,
              }))}
            />
          )}

          {set.length > 1 && (
            <section className="surface p-4 md:p-6">
              <h2 className="kicker mb-3 flex items-center gap-2 text-ink">
                Given to {set.length} people
                <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs text-success-ink">
                  {set.filter((t) => t.status === "done").length} of {set.length} done
                </span>
              </h2>
              <ul className="divide-y divide-line">
                {set.map((t) => (
                  <li key={t.id} className="relative flex items-center gap-3 py-2">
                    <PersonAvatar person={person(t.owner_id)} className="h-7 w-7" />
                    <Link href={`/tasks/${t.id}`} className="flex-1 text-sm font-medium text-ink after:absolute after:inset-0">
                      {personName(person(t.owner_id))}
                      {t.id === task.id && <span className="ml-1.5 text-xs font-normal text-ink-muted">(this one)</span>}
                    </Link>
                    <StatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section id="comments" className="surface scroll-mt-6 p-4 md:p-6">
            <h2 className="kicker mb-3 text-ink">Comments</h2>
            <TaskComments
              taskId={id}
              canComment={canContribute}
              people={people}
              viewerId={viewer.id}
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

          <section className="surface p-4 md:p-6">
            <h2 className="kicker mb-3 text-ink">Files</h2>
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

          {(historyRes.data ?? []).length > 0 && (
            <details className="surface group p-4 md:p-6">
              <summary className="kicker cursor-pointer list-none text-ink">
                History <span className="font-normal text-ink-muted">· {(historyRes.data ?? []).length}</span>
                <span className="ml-1 text-xs font-normal text-ink-muted group-open:hidden">(show)</span>
              </summary>
              <ol className="mt-3 space-y-2 border-l pl-4">
                {((historyRes.data ?? []) as ActivityEntry[]).map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="font-medium">{e.actor_id ? personName(person(e.actor_id)) : "System"}</span>{" "}
                    <span className="text-muted-foreground">{describeActivity(e, { person })}</span>
                    <span className="block text-xs text-muted-foreground">{formatPKT(e.created_at)}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>

        <aside className="h-fit space-y-4 surface p-4 text-sm lg:sticky lg:top-8">
          <Detail label="Owner">
            {canEdit && canReassign ? (
              <InlineOwner taskId={id} owner={task.owner} />
            ) : (
              <span className="flex items-center gap-2">
                <PersonAvatar person={task.owner} /> {personName(task.owner)}
              </span>
            )}
          </Detail>
          {task.owner_id && task.assigned_by && (
            <Detail label="Assigned by">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <PersonAvatar person={person(task.assigned_by)} />
                {task.assigned_by === task.owner_id ? "Themselves" : personName(person(task.assigned_by))}
                {task.assigned_at && <span className="text-ink-muted">· {formatPKT(task.assigned_at, "d MMM")}</span>}
              </span>
            </Detail>
          )}
          {(canEdit || collaboratorIds.length > 0) && (
            <Detail label="Collaborators">
              <CollaboratorsField taskId={id} value={collaboratorIds} people={people} ownerId={task.owner_id} editable={canEdit} />
            </Detail>
          )}
          {task.project && (
            <Detail label={DOMAINS[task.project.kind].label}>
              <Link href={domainHref(task.project)} className="flex items-center gap-1 text-primary hover:underline">
                <FolderKanban className="h-3.5 w-3.5" />
                {task.project.name}
              </Link>
            </Detail>
          )}
          {!task.parent && (
            <Detail label="Teams">
              {task.department || task.project ? (
                <TeamsField taskId={id} mainId={task.department_id} value={extraTeamIds} teams={teamNames} editable={canEdit} />
              ) : (
                <p className="text-sm text-ink">{task.owner_id && task.owner_id !== task.created_by ? "None, a direct task" : "Private"}</p>
              )}
            </Detail>
          )}
          {task.meeting && (
            <Detail label="From meeting">
              <Link href={`/meetings/${task.meeting.id}`} className="flex items-center gap-1 text-primary hover:underline">
                <NotebookPen className="h-3.5 w-3.5" />
                {task.meeting.title || "Meeting"} · {formatDate(task.meeting.meeting_date, "d MMM")}
              </Link>
            </Detail>
          )}
          {(isOwner || viewer.isAdmin || locked) && (
            <div className="border-t border-line pt-3">
              <TaskLockSwitch taskId={id} locked={locked} canToggle={isOwner || viewer.isAdmin} />
            </div>
          )}
          <p className="text-xs text-ink-muted">
            Added {formatPKT(task.created_at, "d MMM")}
            {createdBy && ` by ${personName(createdBy)}`}
            {task.completed_at && ` · done ${formatPKT(task.completed_at, "d MMM")}`}
          </p>
        </aside>
      </div>
    </div>
    </PeopleProvider>
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

const shortTitle = (t: string) => (t.length > 40 ? `${t.slice(0, 38).trimEnd()}…` : t);
