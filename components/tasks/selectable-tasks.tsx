import { BulkProvider, SelectAll } from "@/components/bulk-select";
import { BulkTasksBar, type PartTarget } from "@/components/tasks/bulk-tasks";
import { getPeople } from "@/lib/auth";
import { getProjects } from "@/lib/projects";

/**
 * Wraps one or more task lists so their rows can be ticked together: a
 * "Select all" above, and the bulk bar once something is ticked. Lists inside
 * pass `selectable` to TaskList.
 */
export async function SelectableTasks({
  ids,
  children,
  selectAll = true,
  parts,
}: {
  ids: string[];
  children: React.ReactNode;
  selectAll?: boolean;
  /** Journeys of the project, for "move to a journey". */
  parts?: PartTarget[];
}) {
  const [people, projects] = await Promise.all([getPeople(), getProjects()]);
  return (
    <BulkProvider ids={ids}>
      {selectAll && ids.length > 1 && (
        <div className="mb-2 flex justify-end">
          <SelectAll />
        </div>
      )}
      {children}
      <BulkTasksBar
        people={people}
        projects={projects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name, kind: p.kind }))}
        parts={parts}
      />
    </BulkProvider>
  );
}
