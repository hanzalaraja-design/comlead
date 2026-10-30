import Link from "next/link";
import { cn } from "@/lib/utils";
import { taskHref, type TaskFrom } from "@/lib/tasks/scope";
import { CornerDownRight, ListChecks } from "lucide-react";
import { MeetingTag, ProjectTag, StatusBadge } from "@/components/tasks/task-badges";
import { CollaboratorsChip, InlineDue, InlineOwner, InlinePriority, PeopleProvider } from "@/components/tasks/inline-edit";
import { getPeople } from "@/lib/auth";
import { StatusSelect } from "@/components/tasks/status-select";
import { OPEN_STATUSES, personName } from "@/lib/labels";
import { CompleteButton } from "@/components/tasks/complete-button";
import { ON_TIME_STYLES, onTimeStatus } from "@/lib/tasks/ontime";
import { formatPKT, todayPKT } from "@/lib/time";
import type { TaskListRow } from "@/lib/tasks/queries";

/**
 * One list that works on phones and desktop: on phones each task is a card;
 * from md up it lines up as table columns. Owner, due date, priority and
 * status change right in the row.
 */
export async function TaskList({
  tasks,
  showDepartment = true,
  showCompleted = false,
  showOwner = true,
  showProject = true,
  from,
}: {
  tasks: TaskListRow[];
  /** Off inside a project, where every task is in it. */
  showProject?: boolean;
  /** Where the list sits, so the task page's breadcrumb leads back here. */
  from?: TaskFrom;
  showDepartment?: boolean;
  showCompleted?: boolean;
  /** Off on My tasks, where every task is yours. */
  showOwner?: boolean;
}) {
  const people = await getPeople();
  const names = new Map(people.map((p) => [p.id, personName(p)]));
  // Who handed it over, when that wasn't the owner themselves.
  const byName = (t: TaskListRow) => (t.assigned_by && t.assigned_by !== t.owner_id ? names.get(t.assigned_by) : undefined);
  const cols = showOwner ? "md:grid-cols-[7.5rem_minmax(0,1fr)_11rem_8rem_9rem]" : "md:grid-cols-[7.5rem_minmax(0,1fr)_8rem_9rem]";
  return (
    <PeopleProvider people={people}>
    <div className="overflow-hidden surface">
      <div className={cn("hidden gap-3 bg-subtle px-4 py-2.5 text-[13px] font-bold text-ink md:grid", cols)}>
        <span>Status</span>
        <span>Task</span>
        {showOwner && <span>Owner</span>}
        <span>Priority</span>
        <span>{showCompleted ? "Completed" : "Due"}</span>
      </div>
      <ul className="divide-y divide-line">
        {tasks.map((t) => (
          <TaskListItem key={t.id} task={t} showDepartment={showDepartment} showCompleted={showCompleted} showOwner={showOwner} cols={cols} from={from} showProject={showProject} assignedBy={byName(t)} />
        ))}
      </ul>
    </div>
    </PeopleProvider>
  );
}

function TaskListItem({
  task: t,
  showDepartment,
  showCompleted,
  showOwner,
  cols,
  from,
  showProject,
  assignedBy,
}: {
  task: TaskListRow;
  showProject: boolean;
  assignedBy?: string;
  showDepartment: boolean;
  showCompleted: boolean;
  showOwner: boolean;
  cols: string;
  from?: TaskFrom;
}) {
  const today = todayPKT();
  const onTime = t.status === "done" ? onTimeStatus(t.due_date, t.completed_at) : null;
  return (
    <li
      className={cn(
        "relative px-4 py-3 hover:bg-subtle/60 md:grid md:items-center md:gap-3 md:py-2",
        cols,
        t.overdue && "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-danger",
        t.status === "done" && "opacity-70",
      )}
    >
      <div className="hidden md:block">
        <StatusSelect taskId={t.id} status={t.status} className="relative z-10" />
      </div>

      <div className="min-w-0">
        <div className="flex items-start gap-2.5">
          {OPEN_STATUSES.includes(t.status) && (
            <CompleteButton
              taskId={t.id}
              title={t.title}
              dueByToday={t.overdue || (!!t.due_date && t.due_date <= today)}
              // Subtasks get a square box.
              className={cn("mt-0.5", t.parent_task_id && "rounded-md")}
            />
          )}
          <Link href={taskHref(t.id, from)} className="block min-w-0 font-semibold leading-snug text-ink after:absolute after:inset-0">
            <span className={t.status === "cancelled" ? "line-through opacity-60" : undefined}>{t.title}</span>
          </Link>
        </div>
        <div className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", OPEN_STATUSES.includes(t.status) && "pl-[30px]")}>
          {showProject && t.project && <ProjectTag name={t.project.name} kind={t.project.kind} />}
          {t.meeting && <MeetingTag title={t.meeting.title} date={t.meeting.meeting_date} />}
          {showDepartment && t.department && <span>{t.department.name}</span>}
          {!t.department_id && !t.project_id && !t.parent_task_id && (!t.owner_id || t.owner_id === t.created_by) && !t.collaborators?.length && (
            <span className="font-medium text-brand-primary">Private</span>
          )}
          {t.parent && (
            <span className="inline-flex min-w-0 items-center gap-1 font-medium text-ink">
              <CornerDownRight className="h-3 w-3 shrink-0" /> <span className="truncate">Subtask of {t.parent.title}</span>
            </span>
          )}
          {!!t.subtasks?.length && (
            <span
              className="inline-flex items-center gap-1 font-medium text-ink"
              title={`${t.subtasks.filter((s) => s.status === "done").length} of ${t.subtasks.length} subtasks done`}
            >
              <ListChecks className="h-3 w-3" /> {t.subtasks.filter((s) => s.status === "done").length}/{t.subtasks.length}
            </span>
          )}
          {t.status === "blocked" && t.blocked_reason && (
            <span className="font-medium text-ink">Blocked: {t.blocked_reason}</span>
          )}
        </div>
      </div>

      {/* Phone: one compact row. Tick to finish; status shows only when it's not To do. */}
      <div className={cn("mt-2 flex flex-wrap items-center gap-2 md:hidden", OPEN_STATUSES.includes(t.status) && "pl-[30px]")}>
        {t.status !== "todo" && <StatusBadge status={t.status} />}
        <InlinePriority taskId={t.id} priority={t.priority} />
        {onTime ? (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", ON_TIME_STYLES[onTime.tone])}>{onTime.label}</span>
        ) : (
          <InlineDue taskId={t.id} date={t.due_date} time={t.due_time} overdue={t.overdue} />
        )}
        {assignedBy && <span className="text-xs text-muted-foreground">from {assignedBy}</span>}
        {showOwner && (
          <span className="ml-auto flex items-center gap-1.5">
            <InlineOwner taskId={t.id} owner={t.owner} compact />
            <CollaboratorsChip ids={(t.collaborators ?? []).map((c) => c.user_id)} />
          </span>
        )}
      </div>

      {showOwner && (
        <div className="hidden min-w-0 items-center gap-1.5 md:flex">
          <InlineOwner taskId={t.id} owner={t.owner} />
          <CollaboratorsChip ids={(t.collaborators ?? []).map((c) => c.user_id)} />
        </div>
      )}
      <div className="hidden md:block">
        <InlinePriority taskId={t.id} priority={t.priority} />
      </div>
      <div className="hidden md:block">
        {showCompleted ? (
          <span className="flex flex-col items-start gap-1">
            <span className="text-xs text-muted-foreground">{formatPKT(t.completed_at, "d MMM, h:mm a")}</span>
            {onTime && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", ON_TIME_STYLES[onTime.tone])}>{onTime.label}</span>}
          </span>
        ) : (
          <InlineDue taskId={t.id} date={t.due_date} time={t.due_time} overdue={t.overdue} />
        )}
      </div>
    </li>
  );
}
