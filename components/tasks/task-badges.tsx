import { cn } from "@/lib/utils";
import { PRIORITY_STYLES, STATUS_STYLES, priorityLabel, statusLabel } from "@/lib/labels";
import { formatDue } from "@/lib/time";
import type { TaskPriority, TaskStatus } from "@/lib/types";

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLES[status], className)}>
      {statusLabel(status)}
    </span>
  );
}

export function PriorityBadge({ priority, className }: { priority: TaskPriority; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium", PRIORITY_STYLES[priority], className)}>
      {priorityLabel(priority)}
    </span>
  );
}

export function DueLabel({
  date,
  time,
  overdue,
  className,
}: {
  date: string | null;
  time: string | null;
  overdue?: boolean;
  className?: string;
}) {
  if (!date) return <span className={cn("text-xs text-muted-foreground", className)}>No date</span>;
  return (
    <span className={cn("text-xs", overdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground", className)}>
      {overdue && "Overdue · "}
      {formatDue(date, time)}
    </span>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          #{t}
        </span>
      ))}
    </span>
  );
}
