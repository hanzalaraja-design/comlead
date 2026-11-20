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
import { ProjectMenu } from "@/components/projects/project-menu";
import { MeetingTag } from "@/components/tasks/task-badges";
import { RichTextView } from "@/components/rich-text-view";
import { LinkMeetingButton, type MeetingOption } from "@/components/projects/link-meeting-button";
import { cn } from "@/lib/utils";
import type { ProjectKind } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { getFilterOptions } from "@/lib/tasks/filter-options";
import { filtersToSearch, parseFilters, type TaskFilters } from "@/lib/tasks/filters";
import type { TaskView } from "@/lib/tasks/scope";
import { formatDate, todayPKT } from "@/lib/time";

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

export async function ProjectHeader({ loaded, view, month, meetingsView = false }: { loaded: Loaded; view: TaskView; month?: string; meetingsView?: boolean }) {
  const { project, filters, base, teams, members, owners, isOwner, canManage, viewer } = loaded;
  const d = DOMAINS[project.kind];
  const supabase = await createClient();
  const [options, meetingsRes, { count: taskCount }] = await Promise.all([
    getFilterOptions(),
    // Meetings about it (empty if the database hasn't got links yet).
    supabase
      .from("meeting_projects")
      .select("meeting:meetings(id, title, meeting_date)")
      .eq("project_id", project.id)
      .then((r) => (r.error ? { data: [] } : r)),
    // For the delete dialog: what stays behind.
    isOwner
      ? supabase.from("tasks").select("id", { count: "exact", head: true }).eq("project_id", project.id)
      : Promise.resolve({ count: 0 }),
  ]);
  const meetings = ((meetingsRes.data ?? []) as unknown as { meeting: { id: string; title: string | null; meeting_date: string } | null }[])
    .map((r) => r.meeting)
    .filter((m): m is { id: string; title: string | null; meeting_date: string } => !!m)
    .sort((a, b) => b.meeting_date.localeCompare(a.meeting_date));
  const inIt = viewer.isAdmin || canManage || members.some((m) => m.id === viewer.id);
  const meetingOptions = view === "list" && inIt && !project.archived ? await linkableMeetings(meetings.map((m) => m.id)) : [];
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
            <ProjectMenu
              projectId={project.id}
              name={project.name}
              kindLabel={d.label.toLowerCase()}
              listHref={d.path}
              tasks={taskCount ?? 0}
              meetings={meetings.length}
              canDelete={isOwner}
            />
          </>
        }
      />
      {project.locked && (
        <p className="-mt-2 mb-4 flex items-center gap-2 rounded-[12px] bg-warning-soft px-3 py-2 text-sm text-warning-ink">
          Locked. Only the owners{owners.length ? `, ${owners.map((o) => personName(o)).join(" and ")},` : ""} can change its details. Task owners can still update their own tasks.
        </p>
      )}
      {view === "list" && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line">
          <nav aria-label="Tasks or meetings" className="flex gap-1">
            <Link
              href={base}
              aria-current={!meetingsView ? "page" : undefined}
              className={cn("-mb-px inline-flex h-10 items-center border-b-2 px-3 text-[15px]", !meetingsView ? "border-brand-primary font-semibold text-ink" : "border-transparent text-ink-muted hover:text-ink")}
            >
              Tasks
            </Link>
            <Link
              href={`${base}?view=meetings`}
              aria-current={meetingsView ? "page" : undefined}
              className={cn("-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-[15px]", meetingsView ? "border-brand-primary font-semibold text-ink" : "border-transparent text-ink-muted hover:text-ink")}
            >
              Meetings <span className="text-ink-muted">{meetings.length}</span>
            </Link>
          </nav>
          {inIt && !project.archived && <div className="pb-1.5"><LinkMeetingButton projectId={project.id} projectName={project.name} options={meetingOptions} /></div>}
        </div>
      )}
      {view !== "list" && meetings.length > 0 && (
        <div className="-mt-2 mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-ink-muted">Meetings</span>
          {meetings.slice(0, 6).map((m) => (
            <Link key={m.id} href={`/meetings/${m.id}`} className="hover:opacity-80">
              <MeetingTag title={m.title} date={m.meeting_date} size="md" />
            </Link>
          ))}
        </div>
      )}
      {project.description && (
        <section className="-mt-2 mb-4 surface p-4">
          {project.description.trimStart().startsWith("<") ? (
            <RichTextView html={project.description} />
          ) : (
            <p className="whitespace-pre-line text-sm text-ink">{project.description}</p>
          )}
        </section>
      )}
      {!meetingsView && (
        <>
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
      )}
    </>
  );
}

/** Meetings you can see and could link: the last 90 days and what's coming, newest first. */
async function linkableMeetings(linkedIds: string[]): Promise<MeetingOption[]> {
  const supabase = await createClient();
  const from = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("meetings")
    .select("id, title, meeting_date, series_id")
    .gte("meeting_date", from)
    .order("meeting_date", { ascending: false })
    .limit(120);
  const rows = ((data ?? []) as { id: string; title: string | null; meeting_date: string; series_id: string | null }[]).filter((m) => !linkedIds.includes(m.id));
  const ids = rows.map((m) => m.id);
  const { data: items } = ids.length
    ? await supabase.from("tasks").select("meeting_id").in("meeting_id", ids).is("project_id", null).is("parent_task_id", null)
    : { data: [] };
  const unlinked = new Map<string, number>();
  for (const t of (items ?? []) as { meeting_id: string }[]) unlinked.set(t.meeting_id, (unlinked.get(t.meeting_id) ?? 0) + 1);
  return rows.map((m) => ({
    id: m.id,
    title: m.title || "Meeting",
    when: formatDate(m.meeting_date, "EEE d MMM"),
    recurring: !!m.series_id,
    unlinkedItems: unlinked.get(m.id) ?? 0,
  }));
}
