import Link from "next/link";
import { notFound } from "next/navigation";
import { differenceInCalendarDays } from "date-fns";
import { Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { PersonAvatar } from "@/components/person-avatar";
import { QuickAdd } from "@/components/tasks/quick-add";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskTabs } from "@/components/tasks/task-tabs";
import { getDepartments, getPeople, requireViewer } from "@/lib/auth";
import { KIND_LABELS, PROJECT_COLUMNS, canManageProject, getProjectMembers, membersByProject } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import { getFilterOptions } from "@/lib/tasks/filter-options";
import { filtersToSearch, parseFilters, type TaskFilters } from "@/lib/tasks/filters";
import type { TaskView } from "@/lib/tasks/scope";
import { formatDate, parseISODate, todayPKT } from "@/lib/time";
import type { Project } from "@/lib/types";

type Raw = Record<string, string | string[] | undefined>;

/** One project: who's in it, and the filters that keep the views inside it. */
export async function loadProject(slug: string, raw: Raw) {
  const supabase = await createClient();
  const [viewer, { data }, named, departments, people] = await Promise.all([
    requireViewer(),
    supabase.from("projects").select(PROJECT_COLUMNS).eq("slug", slug).maybeSingle(),
    getProjectMembers(),
    getDepartments(),
    getPeople(),
  ]);
  if (!data) notFound();
  const project = data as Project;
  const memberIds = (await membersByProject([project]))[project.id] ?? [];
  const filters: TaskFilters = { ...parseFilters(raw), project: [project.slug] };
  return {
    viewer,
    project,
    filters,
    base: `/projects/${project.slug}` as const,
    team: departments.find((d) => d.id === project.department_id) ?? null,
    members: people.filter((p) => memberIds.includes(p.id)),
    canManage: canManageProject(viewer, project, named),
  };
}

type Loaded = Awaited<ReturnType<typeof loadProject>>;

export function launchText(date: string | null, kind: Project["kind"]): string | null {
  if (!date) return null;
  const days = differenceInCalendarDays(parseISODate(date), parseISODate(todayPKT()));
  const verb = kind === "campaign" ? "Goes live" : "Launches";
  const when = formatDate(date, "d MMM");
  if (days === 0) return `${verb} today`;
  if (days === 1) return `${verb} tomorrow · ${when}`;
  if (days > 1) return `${verb} ${when} · in ${days} days`;
  return `${kind === "campaign" ? "Went live" : "Launched"} ${when}`;
}

export async function ProjectHeader({ loaded, view, month }: { loaded: Loaded; view: TaskView; month?: string }) {
  const { project, filters, base, team, members, canManage, viewer } = loaded;
  const options = await getFilterOptions();
  const search = filtersToSearch({ ...filters, project: [], ...(view === "board" ? { status: [] } : {}) });
  const launch = launchText(project.launch_date, project.kind);
  // Add tasks into the project's team when you're in it.
  const quickDept = project.department_id && (viewer.isAdmin || viewer.memberDeptIds.includes(project.department_id)) ? project.department_id : null;
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Tasks", href: "/my" }, { label: "Projects", href: "/projects" }, project.name]}
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="rounded-full bg-subtle px-2 py-0.5 text-xs font-semibold text-ink">{KIND_LABELS[project.kind]}</span>
            {project.archived && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-ink">Archived</span>}
            {launch && <span className="font-semibold text-brand-primary">{launch}</span>}
            <span>{team ? `${team.name} team` : "Across teams"}</span>
            <span className="flex items-center -space-x-1.5" title={members.map((m) => m.full_name || m.email).join(", ")}>
              {members.slice(0, 6).map((m) => (
                <PersonAvatar key={m.id} person={m} className="h-6 w-6 ring-2 ring-white" />
              ))}
              {members.length > 6 && <span className="pl-2.5 text-xs">+{members.length - 6}</span>}
            </span>
          </span>
        }
        actions={
          <>
            {canManage && (
              <Button asChild variant="outline" size="sm">
                <Link href={`${base}/edit`}>
                  <Settings2 className="h-4 w-4" /> Edit project
                </Link>
              </Button>
            )}
            <Button asChild size="sm">
              <Link href={`/tasks/new?project=${project.slug}`}>
                <Plus className="h-4 w-4" /> New task
              </Link>
            </Button>
          </>
        }
      />
      {project.description && <p className="-mt-2 mb-4 max-w-3xl whitespace-pre-line text-sm text-ink-muted">{project.description}</p>}
      <TaskTabs scope="projects" view={view} search={search} base={base} />
      {view === "list" && !project.archived && (
        <div className="mb-4">
          <QuickAdd departments={[]} defaultDepartmentId={quickDept} projectId={project.id} />
        </div>
      )}
      <TaskFilterBar
        filters={filters}
        options={options}
        hide={view === "board" ? ["project", "status", "sort"] : view === "calendar" ? ["project", "sort", "when"] : ["project"]}
        preserve={month ? { month } : undefined}
      />
    </>
  );
}
