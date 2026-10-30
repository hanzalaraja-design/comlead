import Link from "next/link";
import { notFound } from "next/navigation";
import { FolderKanban, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { PersonAvatar } from "@/components/person-avatar";
import { ProjectForm } from "@/components/projects/project-form";
import { ProjectHeader, loadProject, teamsText } from "@/components/projects/project-header";
import { BoardView, CalendarView, ListView } from "@/components/tasks/task-views";
import { getDepartments, getPeople, requireViewer } from "@/lib/auth";
import { CATEGORY_LABELS, DOMAINS, datesText, domainHref, getProjectMembers, getProjects, getTeamDirectory, getTeamNames, ownersOf } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import { todayPKT } from "@/lib/time";
import type { Project, ProjectKind } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Projects, campaigns and partnerships share their pages; each lives under its
 * own path (/projects, /campaigns, /partnerships) with its own tabs.
 */

type Raw = Record<string, string | string[] | undefined>;
type Counts = { open: number; done: number; overdue: number; onTime: number; dueDone: number };

const TABS: Record<ProjectKind, { key: string; label: string; test: (p: Project, today: string) => boolean }[]> = {
  project: [
    { key: "all", label: "All", test: () => true },
    { key: "team", label: "Team projects", test: (p) => p.team_ids.length > 0 },
    { key: "individual", label: "Individual", test: (p) => p.team_ids.length === 0 },
  ],
  campaign: [
    { key: "live", label: "Live & upcoming", test: (p, today) => !p.end_date || p.end_date >= today },
    { key: "ended", label: "Ended", test: (p, today) => !!p.end_date && p.end_date < today },
  ],
  partnership: [
    { key: "beauty", label: "Beauty brands", test: (p) => p.category === "beauty" },
    { key: "non_beauty", label: "Non-beauty brands", test: (p) => p.category !== "beauty" },
  ],
};

export async function DomainIndexPage({ kind, raw }: { kind: ProjectKind; raw: Raw }) {
  const d = DOMAINS[kind];
  const today = todayPKT();
  const supabase = await createClient();
  const [, all, teams, people, named] = await Promise.all([requireViewer(), getProjects(), getTeamNames(), getPeople(), getProjectMembers()]);
  const mine = all.filter((p) => p.kind === kind);
  const tabs = TABS[kind];
  const tab = tabs.find((t) => t.key === raw.tab) ?? tabs[0];
  const live = mine.filter((p) => !p.archived && tab.test(p, today));
  const archived = mine.filter((p) => p.archived);

  const ids = mine.map((p) => p.id);
  const { data: rows } = ids.length
    ? await supabase
        .from("tasks")
        .select("project_id, status, overdue, due_date, completed_at")
        .in("project_id", ids)
        .is("parent_task_id", null)
        .neq("status", "cancelled")
        .limit(10000)
    : { data: [] };
  const counts = new Map<string, Counts>();
  for (const r of rows ?? []) {
    const c = counts.get(r.project_id as string) ?? { open: 0, done: 0, overdue: 0, onTime: 0, dueDone: 0 };
    if (r.status === "done") {
      c.done++;
      // On time: finished on or before its due date (Pakistan time).
      if (r.due_date && r.completed_at) {
        c.dueDone++;
        const doneDay = new Date(new Date(r.completed_at as string).getTime() + 5 * 3600_000).toISOString().slice(0, 10);
        if (doneDay <= (r.due_date as string)) c.onTime++;
      }
    } else c.open++;
    if (r.overdue) c.overdue++;
    counts.set(r.project_id as string, c);
  }
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const personById = new Map(people.map((p) => [p.id, p]));

  const card = (p: Project) => {
    const c = counts.get(p.id) ?? { open: 0, done: 0, overdue: 0, onTime: 0, dueDone: 0 };
    const total = c.open + c.done;
    const pct = total ? Math.round((c.done / total) * 100) : 0;
    const owners = ownersOf(named, p.id).map((id) => personById.get(id)).filter((x) => !!x);
    const dates = datesText(p, today);
    return (
      <li key={p.id}>
        <Link href={domainHref(p)} className="flex h-full flex-col gap-2.5 surface p-4 transition-shadow hover:shadow-md">
          <div className="flex items-start justify-between gap-2">
            <h2 className="min-w-0 text-[17px] font-semibold leading-snug text-ink">{p.name}</h2>
            {p.locked ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-subtle px-2 py-0.5 text-[11px] font-bold text-ink">
                <Lock className="h-3 w-3" /> Locked
              </span>
            ) : kind === "project" ? (
              <span className="shrink-0 rounded-md bg-[#F3E6F6] px-2 py-0.5 text-[11px] font-bold text-[#6A1578]">
                {p.team_ids.length ? "Team project" : "Individual"}
              </span>
            ) : null}
          </div>
          {dates && <p className="text-[13px] font-semibold text-brand-primary">{dates}</p>}
          <p className="text-[13px] text-ink-muted">
            {kind === "partnership" && p.category ? `${CATEGORY_LABELS[p.category]} · ` : ""}
            {teamsText(p.team_ids.map((id) => teamName.get(id) ?? "Team"))}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-subtle" aria-label={`${pct}% done`}>
            <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-auto flex items-center justify-between gap-2 text-xs text-ink-muted">
            <span>
              {c.open} open · {c.done} done
              {c.overdue > 0 && <span className="font-semibold text-danger"> · {c.overdue} overdue</span>}
              {c.dueDone > 0 && (
                <span className={cn("font-bold", c.onTime === c.dueDone ? "text-success-ink" : "text-warning-ink")}>
                  {" "}
                  · {c.onTime} of {c.dueDone} on time
                </span>
              )}
            </span>
            {owners.length > 0 && (
              <span className="flex items-center gap-1.5" title={`Owners: ${owners.map((o) => o!.full_name || o!.email).join(", ")}`}>
                <span className="flex -space-x-1.5">
                  {owners.slice(0, 3).map((m) => (
                    <PersonAvatar key={m!.id} person={m} className="h-6 w-6 ring-2 ring-white" />
                  ))}
                </span>
              </span>
            )}
          </div>
        </Link>
      </li>
    );
  };

  return (
    <>
      <PageHeader
        breadcrumb={["Domains", d.plural]}
        title={d.plural}
        description={d.blurb}
        actions={
          <Button asChild size="sm">
            <Link href={`${d.path}/new`}>
              <Plus className="h-4 w-4" /> New {d.label.toLowerCase()}
            </Link>
          </Button>
        }
      />
      <nav aria-label={`${d.plural} filter`} className="mb-4 inline-flex gap-1 rounded-[12px] bg-white p-1 shadow-sm">
        {tabs.map((t) => {
          const n = mine.filter((p) => !p.archived && t.test(p, today)).length;
          return (
            <Link
              key={t.key}
              href={t === tabs[0] ? d.path : `${d.path}?tab=${t.key}`}
              aria-current={t === tab ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center rounded-[9px] px-4 text-sm font-semibold",
                t === tab ? "bg-ink text-white" : "text-ink-muted hover:text-ink",
              )}
            >
              {t.label} · {n}
            </Link>
          );
        })}
      </nav>
      {live.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{live.map(card)}</ul>
      ) : (
        <EmptyState>
          <span className="flex flex-col items-center gap-2">
            <FolderKanban className="h-6 w-6 text-ink-muted" />
            Nothing here yet. Start one with “New {d.label.toLowerCase()}”.
          </span>
        </EmptyState>
      )}
      {archived.length > 0 && (
        <details className="mt-8">
          <summary className="kicker cursor-pointer text-ink">Archived · {archived.length}</summary>
          <ul className="mt-3 grid gap-3 opacity-80 sm:grid-cols-2 xl:grid-cols-3">{archived.map(card)}</ul>
        </details>
      )}
    </>
  );
}

type ItemProps = { kind: ProjectKind; params: Promise<{ slug: string }>; searchParams: Promise<Raw> };

export async function DomainListPage({ kind, params, searchParams }: ItemProps) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  const loaded = await loadProject(slug, raw, kind);
  return (
    <>
      <ProjectHeader loaded={loaded} view="list" />
      <ListView
        filters={loaded.filters}
        viewerId={loaded.viewer.id}
        scope={loaded.base}
        from="project"
        showProject={false}
        show={typeof raw.show === "string" ? raw.show : ""}
      />
    </>
  );
}

export async function DomainBoardPage({ kind, params, searchParams }: ItemProps) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  const loaded = await loadProject(slug, raw, kind, "/board");
  return (
    <>
      <ProjectHeader loaded={loaded} view="board" />
      <BoardView filters={loaded.filters} viewerId={loaded.viewer.id} scope={loaded.base} from="project" />
    </>
  );
}

export async function DomainCalendarPage({ kind, params, searchParams }: ItemProps) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  const loaded = await loadProject(slug, raw, kind, "/calendar");
  const month = typeof raw.month === "string" ? raw.month : undefined;
  return (
    <>
      <ProjectHeader loaded={loaded} view="calendar" month={month} />
      <CalendarView filters={loaded.filters} viewerId={loaded.viewer.id} scope={loaded.base} from="project" month={month} />
    </>
  );
}

export async function DomainEditPage({ kind, params }: { kind: ProjectKind; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [{ viewer, project, canManage, isOwner, ownerIds, base }, directory, visible, people, named] = await Promise.all([
    loadProject(slug, {}, kind, "/edit"),
    getTeamDirectory(),
    getDepartments(),
    getPeople(),
    getProjectMembers(),
  ]);
  if (!canManage) notFound();
  const d = DOMAINS[project.kind];
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader breadcrumb={[{ label: d.plural, href: d.path }, { label: project.name, href: base }, "Edit"]} title={`Edit ${d.label.toLowerCase()}`} />
      <div className="card-outlined p-4 md:p-6">
        <ProjectForm
          project={project}
          ownerIds={ownerIds}
          memberIds={named.filter((m) => m.project_id === project.id && m.role !== "lead").map((m) => m.user_id)}
          departments={[
            ...directory,
            // A project team brought in by the old setup stays listed so it isn't dropped.
            ...visible.filter((t) => project.team_ids.includes(t.id) && !directory.some((x) => x.id === t.id)),
          ].map((t) => ({ id: t.id, name: t.name }))}
          people={people}
          viewerId={viewer.id}
          canPickOwners={isOwner}
        />
      </div>
    </div>
  );
}

export async function DomainNewPage({ kind, searchParams }: { kind: ProjectKind; searchParams: Promise<Raw> }) {
  const d = DOMAINS[kind];
  const [viewer, teams, people, raw] = await Promise.all([requireViewer(), getTeamDirectory(), getPeople(), searchParams]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader breadcrumb={[{ label: d.plural, href: d.path }, `New ${d.label.toLowerCase()}`]} title={`New ${d.label.toLowerCase()}`} />
      <div className="card-outlined p-4 md:p-6">
        <ProjectForm
          departments={teams.map((t) => ({ id: t.id, name: t.name }))}
          people={people}
          viewerId={viewer.id}
          defaultKind={kind}
          defaultTeamIds={teams.filter((t) => t.slug === raw.team).map((t) => t.id)}
        />
      </div>
    </div>
  );
}
