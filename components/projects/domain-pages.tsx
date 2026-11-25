import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown, FolderKanban, LayoutGrid, List, Lock, Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { PersonAvatar } from "@/components/person-avatar";
import { ProjectForm } from "@/components/projects/project-form";
import { ProjectComments, type ProjectComment } from "@/components/projects/project-comments";
import { personName } from "@/lib/labels";
import { ProjectHeader, loadProject, teamsText } from "@/components/projects/project-header";
import { ProjectMeetings } from "@/components/projects/project-meetings";
import { JourneysView, journeySettings } from "@/components/projects/journeys/journeys-view";
import { BoardView, CalendarView, ListView } from "@/components/tasks/task-views";
import { getDepartments, getPeople, requireViewer } from "@/lib/auth";
import { CATEGORY_LABELS, DOMAINS, datesText, domainHref, getProjectMembers, getProjects, getTeamDirectory, getTeamNames, homeTeamFor, ownersOf } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import { formatPKT, todayPKT } from "@/lib/time";
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
  // Brand partnerships have their own list (components/partnerships/partnership-index.tsx).
  partnership: [{ key: "all", label: "All", test: () => true }],
};

export async function DomainIndexPage({ kind, raw }: { kind: ProjectKind; raw: Raw }) {
  const d = DOMAINS[kind];
  const today = todayPKT();
  const supabase = await createClient();
  const [, all, teams, people, named] = await Promise.all([requireViewer(), getProjects(), getTeamNames(), getPeople(), getProjectMembers()]);
  const mine = all.filter((p) => p.kind === kind);
  const tabs = TABS[kind];
  const tab = tabs.find((t) => t.key === raw.tab) ?? tabs[0];
  // Campaigns: all, sales or brand themes.
  const ctype = kind === "campaign" && (raw.type === "sale" || raw.type === "theme") ? raw.type : null;
  const isTheme = (p: Project) => p.campaign_type === "theme";
  const ofType = (p: Project) => !ctype || (ctype === "theme" ? isTheme(p) : !isTheme(p));
  const live = mine.filter((p) => !p.archived && tab.test(p, today) && ofType(p));
  const archived = mine.filter((p) => p.archived);
  // Campaigns: cards (default) or a compact list.
  const asList = kind === "campaign" && raw.view === "list";
  const linkTo = (o: { tab?: string; type?: string | null; list?: boolean }) => {
    const q = new URLSearchParams();
    const t = o.tab ?? tab.key;
    if (t !== tabs[0].key) q.set("tab", t);
    const ty = o.type === undefined ? ctype : o.type;
    if (ty) q.set("type", ty);
    if (o.list ?? asList) q.set("view", "list");
    return q.toString() ? `${d.path}?${q}` : d.path;
  };

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
            ) : kind === "campaign" ? (
              isTheme(p) ? (
                <span className="shrink-0 rounded-md bg-[#F3E6F6] px-2 py-0.5 text-[11px] font-bold text-[#6A1578]">Brand theme</span>
              ) : (
                <span className="shrink-0 rounded-md bg-[#FEF1E6] px-2 py-0.5 text-[11px] font-bold text-[#8A4A12]">Sale</span>
              )
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

  // List view: one row per campaign, same facts as the card.
  const COLS = "md:grid md:grid-cols-[minmax(0,1.6fr)_120px_230px_minmax(0,1.1fr)_84px] md:items-center md:gap-x-4";
  const row = (p: Project) => {
    const c = counts.get(p.id) ?? { open: 0, done: 0, overdue: 0, onTime: 0, dueDone: 0 };
    const total = c.open + c.done;
    const pct = total ? Math.round((c.done / total) * 100) : 0;
    const owners = ownersOf(named, p.id).map((id) => personById.get(id)).filter((x) => !!x);
    const dates = datesText(p, today);
    return (
      <li key={p.id} className={cn("relative flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3 first:border-t-0 hover:bg-canvas/60 md:px-5", COLS)}>
        <div className="min-w-0 basis-full md:basis-auto">
          <Link href={domainHref(p)} className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold text-ink after:absolute after:inset-0">
            <span className="truncate">{p.name}</span>
            {p.locked && <Lock className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-label="Locked" />}
          </Link>
          <p className="truncate text-xs text-ink-muted">{teamsText(p.team_ids.map((id) => teamName.get(id) ?? "Team"))}</p>
        </div>
        <span>
          {isTheme(p) ? (
            <span className="rounded-md bg-[#F3E6F6] px-2 py-0.5 text-[11px] font-bold text-[#6A1578]">Brand theme</span>
          ) : (
            <span className="rounded-md bg-[#FEF1E6] px-2 py-0.5 text-[11px] font-bold text-[#8A4A12]">Sale</span>
          )}
        </span>
        <span className="min-w-0 text-sm font-semibold text-brand-primary">{dates || <span className="font-normal text-ink-muted">No dates yet</span>}</span>
        <span className="flex min-w-0 basis-full flex-col gap-1 md:basis-auto">
          <span className="h-1.5 overflow-hidden rounded-full bg-subtle" aria-label={`${pct}% done`}>
            <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
          </span>
          <span className="text-xs text-ink-muted">
            {c.open} open · {c.done} done
            {c.overdue > 0 && <span className="font-semibold text-danger"> · {c.overdue} overdue</span>}
          </span>
        </span>
        <span className="hidden -space-x-1.5 md:flex" title={owners.length ? `Owners: ${owners.map((o) => o!.full_name || o!.email).join(", ")}` : "No owner"}>
          {owners.slice(0, 3).map((m) => (
            <PersonAvatar key={m!.id} person={m} className="h-6 w-6 ring-2 ring-white" />
          ))}
        </span>
      </li>
    );
  };
  const table = (list: Project[]) => (
    <div className="surface overflow-hidden">
      <div className={cn("hidden h-10 bg-[#F7F6F4] px-5 text-xs font-semibold uppercase tracking-wide text-ink-muted", COLS)}>
        <span>Campaign</span>
        <span>Type</span>
        <span>Dates</span>
        <span>Progress</span>
        <span>Owners</span>
      </div>
      <ul>{list.map(row)}</ul>
    </div>
  );

  return (
    <>
      <PageHeader
        breadcrumb={["Domains", d.plural]}
        title={d.plural}
        description={d.blurb}
        actions={
          <Button asChild size="sm">
            <Link href={`${d.path}/new${ctype === "theme" ? "?type=theme" : ""}`}>
              <Plus className="h-4 w-4" /> {ctype === "theme" ? "New brand theme" : `New ${d.label.toLowerCase()}`}
            </Link>
          </Button>
        }
      />
      {kind === "campaign" ? (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line">
          <nav aria-label="Type" className="flex gap-6">
            {(
              [
                [null, "All"],
                ["sale", "Sales"],
                ["theme", "Brand themes"],
              ] as const
            ).map(([k, label]) => {
              const n = mine.filter((p) => !p.archived && tab.test(p, today) && (!k || (k === "theme" ? isTheme(p) : !isTheme(p)))).length;
              return (
                <Link
                  key={label}
                  href={linkTo({ type: k })}
                  aria-current={ctype === k ? "page" : undefined}
                  className={cn(
                    "-mb-px border-b-2 px-0.5 pb-3 text-[15px] font-semibold",
                    ctype === k ? "border-ink text-ink" : "border-transparent text-ink-muted hover:text-ink",
                  )}
                >
                  {label}
                  <span className="ml-1 font-medium text-ink-muted/70">{n}</span>
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-subtle">
                {tab.label} <ChevronDown className="h-4 w-4 text-ink-muted" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {tabs.map((t) => (
                  <DropdownMenuItem key={t.key} asChild>
                    <Link href={linkTo({ tab: t.key })} className="flex justify-between">
                      <span className={cn(t === tab && "font-semibold")}>{t.label}</span>
                      <span className="text-ink-muted">{mine.filter((p) => !p.archived && t.test(p, today) && ofType(p)).length}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="inline-flex gap-0.5 rounded-[10px] bg-subtle p-0.5" role="group" aria-label="View">
              {(
                [
                  [false, "Cards", LayoutGrid],
                  [true, "List", List],
                ] as const
              ).map(([l, label, Icon]) => (
                <Link
                  key={label}
                  href={linkTo({ list: l })}
                  title={label}
                  aria-label={label}
                  aria-current={asList === l ? "page" : undefined}
                  className={cn(
                    "inline-flex h-7 w-8 items-center justify-center rounded-[8px]",
                    asList === l ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </Link>
              ))}
            </span>
          </div>
        </div>
      ) : (
        <div className="mb-4">
      <nav aria-label={`${d.plural} filter`} className="inline-flex gap-1 rounded-[12px] bg-white p-1 shadow-sm">
        {tabs.map((t) => {
          const n = mine.filter((p) => !p.archived && t.test(p, today) && ofType(p)).length;
          return (
            <Link
              key={t.key}
              href={linkTo({ tab: t.key })}
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
        </div>
      )}
      {live.length ? (
        asList ? (
          table(live)
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{live.map(card)}</ul>
        )
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
          {asList ? (
            <div className="mt-3 opacity-80">{table(archived)}</div>
          ) : (
            <ul className="mt-3 grid gap-3 opacity-80 sm:grid-cols-2 xl:grid-cols-3">{archived.map(card)}</ul>
          )}
        </details>
      )}
    </>
  );
}

type ItemProps = { kind: ProjectKind; params: Promise<{ slug: string }>; searchParams: Promise<Raw> };

export async function DomainListPage({ kind, params, searchParams }: ItemProps) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  const loaded = await loadProject(slug, raw, kind);
  if (raw.view === "meetings") {
    return (
      <>
        <ProjectHeader loaded={loaded} view="list" meetingsView />
        <ProjectMeetings project={loaded.project} canUnlink={loaded.canManage || loaded.viewer.isAdmin || loaded.members.some((m) => m.id === loaded.viewer.id)} />
      </>
    );
  }
  const journeys = await journeySettings(loaded.project.id);
  if (journeys.on) {
    return (
      <>
        <ProjectHeader loaded={loaded} view="list" journeys />
        <JourneysView
          project={loaded.project}
          base={loaded.base}
          raw={raw}
          viewerId={loaded.viewer.id}
          canEdit={loaded.isMember || loaded.canManage}
          people={journeys.people}
          quickDept={homeTeamFor(loaded.viewer, loaded.project) ?? undefined}
        />
      </>
    );
  }
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
      <ProjectCommentsSection projectId={loaded.project.id} viewerId={loaded.viewer.id} />
    </>
  );
}

/** Comments under the task list (none shown if the database hasn't got them yet). */
async function ProjectCommentsSection({ projectId, viewerId }: { projectId: string; viewerId: string }) {
  const supabase = await createClient();
  const [{ data, error }, people] = await Promise.all([
    supabase.from("project_comments").select("id, body, author_id, created_at").eq("project_id", projectId).order("created_at"),
    getPeople(),
  ]);
  if (error) return null;
  const byId = new Map(people.map((p) => [p.id, p]));
  const comments: ProjectComment[] = ((data ?? []) as { id: string; body: string; author_id: string; created_at: string }[]).map((c) => ({
    id: c.id,
    body: c.body,
    when: formatPKT(c.created_at, "d MMM, h:mm a"),
    author: byId.get(c.author_id) ?? null,
    authorName: personName(byId.get(c.author_id) ?? null),
    mine: c.author_id === viewerId,
  }));
  return <ProjectComments projectId={projectId} comments={comments} canComment />;
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

export async function DomainNewPage({ kind, searchParams }: { kind: ProjectKind; searchParams?: Promise<Raw> }) {
  const raw = searchParams ? await searchParams : {};
  const d = DOMAINS[kind];
  const [viewer, teams, people] = await Promise.all([requireViewer(), getTeamDirectory(), getPeople()]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader breadcrumb={[{ label: d.plural, href: d.path }, `New ${d.label.toLowerCase()}`]} title={`New ${d.label.toLowerCase()}`} />
      <div className="card-outlined p-4 md:p-6">
        <ProjectForm
          departments={teams.map((t) => ({ id: t.id, name: t.name }))}
          people={people}
          viewerId={viewer.id}
          defaultKind={kind}
          defaultCampaignType={raw.type === "theme" ? "theme" : undefined}
          // No teams until picked.
          defaultTeamIds={[]}
        />
      </div>
    </div>
  );
}
