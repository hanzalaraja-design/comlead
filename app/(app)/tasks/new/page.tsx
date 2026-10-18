import { EmptyState, PageHeader } from "@/components/page-header";
import { TaskForm } from "@/components/tasks/task-form";
import { requireViewer } from "@/lib/auth";
import { getTaskFormData } from "@/lib/tasks/form-data";

export const metadata = { title: "New task · Highfy Tasks" };

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; owner?: string }>;
}) {
  const viewer = await requireViewer();
  const { dept } = await searchParams;
  const data = await getTaskFormData(viewer);
  const defaultDept = data.departments.find((d) => d.slug === dept)?.id;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader breadcrumb={[{ label: "Tasks", href: "/tasks" }, "New task"]} title="New task" />
      {data.departments.length === 0 ? (
        <EmptyState>You aren&apos;t in a department yet, so you can&apos;t create tasks. Ask an Admin to add you.</EmptyState>
      ) : (
        <div className="card-outlined p-4 md:p-6">
        <TaskForm
          departments={data.departments}
          people={data.people}
          membersByDept={data.membersByDept}
          defaultDepartmentId={defaultDept}
          defaultOwnerId={viewer.id}
          canReassign
          canMove
        />
        </div>
      )}
    </div>
  );
}
