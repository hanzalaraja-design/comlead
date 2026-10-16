import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { SavedViews } from "@/components/tasks/saved-views";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskList } from "@/components/tasks/task-list";
import { getDepartments, requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";
import { TASK_LIMIT, fetchTasks } from "@/lib/tasks/queries";
import type { SavedView } from "@/lib/types";

export const metadata = { title: "All tasks · Highfy Tasks" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  const filters = parseFilters(await searchParams);
  const supabase = await createClient();

  const [departments, options, viewsRes] = await Promise.all([
    getDepartments(),
    getFilterOptions(),
    supabase.from("saved_views").select("id, name, path, created_at").order("name"),
  ]);
  const { tasks, truncated, error } = await fetchTasks(filters, { viewerId: viewer.id, departments });

  return (
    <>
      <PageHeader
        title="All tasks"
        description={`${tasks.length}${truncated ? "+" : ""} task${tasks.length === 1 ? "" : "s"}`}
        actions={
          <Button asChild size="sm">
            <Link href="/tasks/new">
              <Plus className="h-4 w-4" /> New task
            </Link>
          </Button>
        }
      />
      <SavedViews views={(viewsRes.data ?? []) as SavedView[]} />
      <TaskFilterBar filters={filters} options={options} />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {tasks.length ? (
        <TaskList tasks={tasks} showCompleted={filters.sort === "completed"} />
      ) : (
        <EmptyState>No tasks match these filters.</EmptyState>
      )}
      {truncated && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Showing the first {TASK_LIMIT}. Narrow the filters to see the rest.
        </p>
      )}
    </>
  );
}
