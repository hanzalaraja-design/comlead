import Link from "next/link";
import { CalendarDays, GanttChart, KanbanSquare, List } from "lucide-react";
import { cn } from "@/lib/utils";

const VIEWS = [
  { key: "list", label: "List", href: "/tasks", icon: List },
  { key: "board", label: "Board", href: "/tasks/board", icon: KanbanSquare },
  { key: "calendar", label: "Calendar", href: "/tasks/calendar", icon: CalendarDays },
  { key: "timeline", label: "Timeline", href: "/tasks/timeline", icon: GanttChart },
] as const;

export type TaskView = (typeof VIEWS)[number]["key"];

/** Switch between task views, keeping the current filters (`search`, e.g. "?dept=marketing"). */
export function TaskViewTabs({ active, search = "" }: { active: TaskView; search?: string }) {
  return (
    <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b px-4 md:mx-0 md:px-0">
      {VIEWS.map((v) => (
        <Link
          key={v.key}
          href={v.href + search}
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm",
            active === v.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <v.icon className="h-4 w-4" />
          {v.label}
        </Link>
      ))}
    </nav>
  );
}
