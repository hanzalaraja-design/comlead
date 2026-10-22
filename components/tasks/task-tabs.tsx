import Link from "next/link";
import { CalendarDays, KanbanSquare, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { SCOPES, viewHref, type TaskScope, type TaskView } from "@/lib/tasks/scope";

const VIEWS = [
  { key: "list", label: "List", icon: List },
  { key: "board", label: "Board", icon: KanbanSquare },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
] as const;

/**
 * Tasks has three ways in (My tasks, My team, All teams) and each can be seen
 * as a list, board or calendar. `search` keeps the filters when switching view.
 */
export function TaskTabs({ scope, view, search = "" }: { scope: TaskScope; view: TaskView; search?: string }) {
  return (
    <div className="-mx-4 mb-4 flex flex-col gap-2 border-b border-line px-4 md:mx-0 md:flex-row md:items-end md:justify-between md:px-0">
      <nav aria-label="Tasks" className="no-scrollbar flex gap-5 overflow-x-auto">
        {SCOPES.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            aria-current={scope === s.key ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-1 text-[15px] font-semibold",
              scope === s.key ? "border-brand-primary text-ink" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <nav aria-label="View" className="mb-2 flex gap-1 self-start rounded-full bg-subtle p-1 md:self-auto">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={viewHref(scope, v.key, search)}
            aria-current={view === v.key ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
              view === v.key ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink",
            )}
          >
            <v.icon className="h-4 w-4" />
            {v.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
