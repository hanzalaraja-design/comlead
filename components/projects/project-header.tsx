import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { PersonAvatar } from "@/components/person-avatar";
import { QuickAdd } from "@/components/tasks/quick-add";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskTabs } from "@/components/tasks/task-tabs";
import { getPeople, requireViewer } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { DOMAINS, CATEGORY_LABELS, PROJECT_COLUMNS, canManageProject, datesText, domainHref, getProjectMembers, getTeamNames, homeTeamFor, isProjectOwner, membersByProject, ownersOf, toProject } from "@/lib/projects";
import { LockButton } from "@/components/projects/lock-button";
import type { ProjectKind } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { getFilterOptions } from "@/lib/tasks/filter-options";
import { filtersToSearch, parseFilters, type TaskFilters } from "@/lib/tasks/filters";
import type { TaskView } from "@/lib/tasks/scope";
import { todayPKT } from "@/lib/time";

type Raw = Record<string, string | string[] | undefined>;

/**
 * One project, campaign or partnership: who's in it, who owns it, and the
 * filters that keep the views inside it. Opened under the wrong domain, it
 * moves to the right one.
 */
export async function loadProject(slug: string, raw: Raw, kind?: ProjectKind, rest = "") {
  const supabase = await createClient();
  const [viewer, { data }, named, departments, people] = await Promise.all([
    requireViewer(),
    supabase.from("projects").select(PROJECT_COLUMNS).eq("slug", slug).maybeSingle(),
    getProjectMembers(),
    getTeamNames(),
    getPeople(),
  ]);
  if (!data) notFound();
  const project = toProject(data as unknown as Parameters<typeof toProject>[0]);
  if (kind && project.kind !== kind) redirect(`${domainHref(project)}${rest}`);
  const memberIds = (await membersByProject([project]))[project.id] ?? [];
  const ownerIds = ownersOf(named, project.id);
  const isMember = viewer.isAdmin || memberIds.includes(viewer.id);
  const filters: TaskFilters = { ...parseFilters(raw), project: [project.slug] };
  return {
    viewer,
    project,
    filters,
    base: domainHref(project) as `/${string}`,
    teams: departments.filter((d) => project.team_ids.includes(d.id)),
    members: people.filter((p) => memberIds.includes(p.id)),
    owners: people.filter((p) => ownerIds.includes(p.id)),
    ownerIds,
    isOwner: isProjectOwner(viewer, project, named),
    canManage: canManageProject(viewer, project, named, isMember),
  };
}

type Loaded = Awaited<ReturnType<typeof loadProject>>;

/** "Brand + Design", or "Across teams" when it's just people picked by name. */
export function teamsText(names: string[]): string {
  if (!names.length) return "Across teams";
  return names.length <= 3 ? names.join(" + ") : `${names.slice(0, 2).join(" + ")} + ${names.length - 2} more`;
}

export async function ProjectHeader({ loaded, view, month }: { loaded: Loaded; view: TaskView; month?: string }) {
  const { project, filters, base, teams, members, owners, isOwner, canManage, viewer } = loaded;
  const d = DOMAINS[project.kind];
  const options = await getFilterOptions();
  const search = filtersToSearch({ ...filters, project: [], ...(view === "board" ? { status: [] } : {}) });
  const dates = datesText(project, todayPKT());
  // Add tasks into the project's team when you're in it.
  const quickDept = homeTeamFor(viewer, project);
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: d.plural, href: d.path }, project.name]}
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="rounded-full bg-subtle px-2 py-0.5 text-xs font-semibold text-ink">
              {project.category ? CATEGORY_LABELS[project.category] : d.label}
            </span>
            {project.archived && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-ink">Archived</span>}
            {dates && <span className="font-semibold text-brand-primary">{dates}</span>}
            <span>{teamsText(teams.map((t) => t.name))}</span>
            {owners.length > 0 && <span>Owners: {owners.map((o) => personName(o)).join(", ")}</span>}
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
            <LockButton projectId={project.id} locked={project.locked} canToggle={isOwner} />
            {canManage && (
              <Button asChild variant="outline" size="sm">
                <Link href={`${base}/edit`}>
                  <Settings2 className="h-4 w-4" /> Edit
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
      {project.locked && (
        <p className="-mt-2 mb-4 flex items-center gap-2 rounded-[12px] bg-warning-soft px-3 py-2 text-sm text-warning-ink">
          Locked. Only the owners{owners.length ? `, ${owners.map((o) => personName(o)).join(" and ")},` : ""} can change its details. Task owners can still update their own tasks.
        </p>
      )}
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
