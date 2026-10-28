import { cn } from "@/lib/utils";
import { PRIORITY_STYLES, STATUS_STYLES, priorityLabel, statusLabel } from "@/lib/labels";
import { addDaysISO, formatDate, formatDue, todayPKT } from "@/lib/time";
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
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", PRIORITY_STYLES[priority], className)}>
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
  const today = todayPKT();
  const soon = !overdue && date <= addDaysISO(today, 1);
  return (
    <span
      className={cn(
        "whitespace-nowrap text-[13px] font-medium",
        overdue
          ? "rounded-full bg-danger-soft px-2 py-0.5 font-semibold text-danger-ink"
          : soon
            ? "rounded-full bg-warning-soft px-2 py-0.5 font-semibold text-warning-ink"
            : "text-ink-muted",
        className,
      )}
    >
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

/*
 * Where a task comes from, as small tinted tags: purple for a project,
 * blue for a meeting. The team stays plain grey text beside them.
 */
const TAG = "inline-flex max-w-full items-center gap-1.5 rounded-md font-semibold";
const TAG_SIZE = { sm: "h-[22px] px-2 text-xs", md: "h-7 px-2.5 text-[13px]" } as const;

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0", className)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0", className)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </svg>
  );
}

/** Purple for projects, orange for campaigns, green for partnerships. */
const KIND_TAG = {
  project: "bg-[#F3E6F6] text-[#6A1578]",
  campaign: "bg-[#FDEBDC] text-[#8A3B0A]",
  partnership: "bg-[#DDF2E9] text-[#0F5A41]",
} as const;

export function ProjectTag({
  name,
  kind = "project",
  prefix,
  size = "sm",
  className,
}: {
  name: string;
  kind?: keyof typeof KIND_TAG;
  prefix?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span className={cn(TAG, TAG_SIZE[size], KIND_TAG[kind], className)}>
      <FolderIcon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} />
      <span className="truncate">
        {prefix && `${prefix} · `}
        {name}
      </span>
    </span>
  );
}

export function MeetingTag({
  title,
  date,
  prefix,
  size = "sm",
  className,
}: {
  title: string | null;
  date: string;
  prefix?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span className={cn(TAG, TAG_SIZE[size], "bg-[#E5EEF9] text-[#1D4F8C]", className)}>
      <CalendarIcon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} />
      <span className="truncate">
        {prefix && `${prefix} · `}
        {title || "Meeting"} · {formatDate(date, "d MMM")}
      </span>
    </span>
  );
}
