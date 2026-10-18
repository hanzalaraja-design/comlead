import Link from "next/link";
import { cn } from "@/lib/utils";
import { NotebookPen } from "lucide-react";
import { PersonAvatar } from "@/components/person-avatar";
import { DueLabel, PriorityBadge, TagList } from "@/components/tasks/task-badges";
import { StatusSelect } from "@/components/tasks/status-select";
import { OPEN_STATUSES, personName } from "@/lib/labels";
import { CompleteButton } from "@/components/tasks/complete-button";
import { formatPKT, todayPKT } from "@/lib/time";
import type { TaskListRow } from "@/lib/tasks/queries";

/**
 * One list that works on phones and desktop: on phones each task is a card;
 * from md up it lines up as table columns.
 */
export function TaskList({
  tasks,
  showDepartment = true,
  showCompleted = false,
}: {
  tasks: TaskListRow[];
  showDepartment?: boolean;
  showCompleted?: boolean;
}) {
  return (
    <div className="overflow-hidden surface">
      <div className="hidden grid-cols-[7.5rem_minmax(0,1fr)_9rem_8rem_9rem] gap-3 bg-subtle px-4 py-2.5 text-[13px] font-bold text-ink md:grid">
        <span>Status</span>
        <span>Task</span>
        <span>Owner</span>
        <span>Priority</span>
        <span>{showCompleted ? "Completed" : "Due"}</span>
      </div>
      <ul className="divide-y divide-line">
        {tasks.map((t) => (
          <TaskListItem key={t.id} task={t} showDepartment={showDepartment} showCompleted={showCompleted} />
        ))}
      </ul>
    </div>
  );
}

function TaskListItem({
  task: t,
  showDepartment,
  showCompleted,
}: {
  task: TaskListRow;
  showDepartment: boolean;
  showCompleted: boolean;
}) {
  const today = todayPKT();
  return (
    <li
      className={cn(
        "relative px-4 py-3 hover:bg-subtle/60 md:grid md:grid-cols-[7.5rem_minmax(0,1fr)_9rem_8rem_9rem] md:items-center md:gap-3 md:py-2",
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
              className="mt-0.5"
            />
          )}
          <Link href={`/tasks/${t.id}`} className="block min-w-0 font-semibold leading-snug text-ink after:absolute after:inset-0">
            <span className={t.status === "cancelled" ? "line-through opacity-60" : undefined}>{t.title}</span>
          </Link>
        </div>
        <div className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", OPEN_STATUSES.includes(t.status) && "pl-[30px]")}>
          {!t.department_id && <span className="font-medium text-brand-primary">Personal</span>}
          {showDepartment && t.department && (
            <span>
              {t.department.name}
              {t.sub_team && ` · ${t.sub_team.name}`}
            </span>
          )}
          {!showDepartment && t.sub_team && <span>{t.sub_team.name}</span>}
          {t.meeting && (
            <span className="inline-flex items-center gap-1">
              <NotebookPen className="h-3 w-3" /> From meeting
            </span>
          )}
          {t.status === "blocked" && t.blocked_reason && (
            <span className="font-medium text-ink">Blocked: {t.blocked_reason}</span>
          )}
          <TagList tags={t.tags} />
        </div>
      </div>

      {/* Phone: one compact meta row */}
      <div className="mt-2 flex flex-wrap items-center gap-2 md:hidden">
        <StatusSelect taskId={t.id} status={t.status} className="relative z-10" />
        <PriorityBadge priority={t.priority} />
        <DueLabel date={t.due_date} time={t.due_time} overdue={t.overdue} />
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <PersonAvatar person={t.owner} className="h-5 w-5" />
        </span>
      </div>

      <div className="hidden items-center gap-2 text-sm md:flex">
        <PersonAvatar person={t.owner} />
        <span className="truncate">{personName(t.owner)}</span>
      </div>
      <div className="hidden md:block">
        <PriorityBadge priority={t.priority} />
      </div>
      <div className="hidden md:block">
        {showCompleted ? (
          <span className="text-xs text-muted-foreground">{formatPKT(t.completed_at, "d MMM, h:mm a")}</span>
        ) : (
          <DueLabel date={t.due_date} time={t.due_time} overdue={t.overdue} />
        )}
      </div>
    </li>
  );
}
