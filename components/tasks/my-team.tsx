import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { PersonAvatar } from "@/components/person-avatar";
import { QuickAdd } from "@/components/tasks/quick-add";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskTabs } from "@/components/tasks/task-tabs";
import { canLead, getDepartmentMembers, getDepartments, getPeople, isMemberOf, requireViewer } from "@/lib/auth";
import { OPEN_STATUSES, personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { filtersToSearch, parseFilters, type TaskFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";
import { viewHref, type TaskView } from "@/lib/tasks/scope";
import { weekEndPKT, weekStartPKT } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Department, PersonRef } from "@/lib/types";

type Raw = Record<string, string | string[] | undefined>;

/**
 * Tasks · My team: the team you're in (or the one picked, if you're in
 * several), with how much each person has on this week.
 */
export async function loadMyTeam(raw: Raw) {
  const [viewer, departments] = await Promise.all([requireViewer(), getDepartments()]);
  const live = departments.filter((d) => !d.archived);
  // Teams you're actually in; an Admin outside every team can pick any.
  const mine = live.filter((d) => viewer.memberDeptIds.includes(d.id));
  const choices = mine.length ? mine : viewer.isAdmin ? live : [];
  const wanted = typeof raw.team === "string" ? raw.team : undefined;
  const team = choices.find((d) => d.slug === wanted) ?? choices[0] ?? null;
  const filters: TaskFilters | null = team ? { ...parseFilters(raw), dept: [team.slug] } : null;
  return { viewer, team, choices, filters };
}

export async function MyTeamHeader({
  view,
  team,
  choices,
  filters,
  month,
}: {
  view: TaskView;
  team: Department | null;
  choices: Department[];
  filters: TaskFilters | null;
  month?: string;
}) {
  if (!team || !filters) {
    return (
      <>
        <PageHeader breadcrumb={["Tasks", "My team"]} title="My team" />
        <TaskTabs scope="team" view={view} />
        <p className="surface px-4 py-6 text-sm text-ink-muted">
          You&apos;re not in a team yet. Ask an Admin to add you, or see <Link href="/tasks" className="font-medium text-brand-primary hover:underline">All teams</Link>.
        </p>
      </>
    );
  }

  const viewer = await requireViewer();
  const supabase = await createClient();
  const [options, members, people, { data: open }] = await Promise.all([
    getFilterOptions({ departmentId: team.id }),
    getDepartmentMembers(),
    getPeople(),
    supabase.from("tasks").select("owner_id, due_date, overdue").eq("department_id", team.id).in("status", OPEN_STATUSES).limit(2000),
  ]);

  // Workload: open tasks due this week, overdue, and everything open, per person.
  const ws = weekStartPKT();
  const we = weekEndPKT();
  const byId = new Map(people.map((p) => [p.id, p]));
  const load = members
    .filter((m) => m.department_id === team.id)
    .map((m) => {
      const theirs = (open ?? []).filter((t) => t.owner_id === m.user_id);
      return {
        person: byId.get(m.user_id) as PersonRef | undefined,
        id: m.user_id,
        week: theirs.filter((t) => !t.overdue && t.due_date && t.due_date >= ws && t.due_date <= we).length,
        overdue: theirs.filter((t) => t.overdue).length,
        total: theirs.length,
      };
    })
    .filter((x) => x.person)
    .sort((a, b) => b.week + b.overdue - (a.week + a.overdue) || personName(a.person).localeCompare(personName(b.person)));
  const unassigned = (open ?? []).filter((t) => !t.owner_id).length;

  const keep = { team: team.slug };
  const tabSearch = (() => {
    const p = new URLSearchParams(filtersToSearch({ ...(view === "board" ? { ...filters, status: [] } : filters), dept: [] }).slice(1));
    p.set("team", team.slug);
    return `?${p}`;
  })();
  const personHref = (owner: string | null) => {
    const p = new URLSearchParams(filtersToSearch({ ...filters, dept: [], owner: owner ? (filters.owner.includes(owner) && filters.owner.length === 1 ? [] : [owner]) : [] }).slice(1));
    p.set("team", team.slug);
    if (month) p.set("month", month);
    return viewHref("team", view, `?${p}`);
  };
  const lead = canLead(viewer, team.id);
  const selected = filters.owner.length === 1 ? filters.owner[0] : null;

  return (
    <>
      <PageHeader
        breadcrumb={["Tasks", "My team", team.name]}
        title={team.name}
        description={selected ? `${personName(byId.get(selected))}'s tasks` : undefined}
        actions={
          <>
            {lead && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/departments/${team.slug}/team`}>
                  <Users className="h-4 w-4" /> Members
                </Link>
              </Button>
            )}
            <Button asChild size="sm">
              <Link href={`/tasks/new?dept=${team.slug}`}>
                <Plus className="h-4 w-4" /> New task
              </Link>
            </Button>
          </>
        }
      />
      <TaskTabs scope="team" view={view} search={tabSearch} />

      {choices.length > 1 && (
        <nav aria-label="Your teams" className="no-scrollbar -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
          {choices.map((d) => (
            <Link
              key={d.id}
              href={viewHref("team", view, `?team=${d.slug}`)}
              aria-current={d.id === team.id ? "page" : undefined}
              className={cn(
                "inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium",
                d.id === team.id ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:bg-subtle",
              )}
            >
              {d.name}
            </Link>
          ))}
        </nav>
      )}

      {/* Who has what this week. Tap a person to see only theirs. */}
      <section aria-label="Workload this week" className="mb-4">
        <h2 className="kicker mb-2 text-ink">This week</h2>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          {load.map((x) => (
            <Link
              key={x.id}
              href={personHref(x.id)}
              aria-current={selected === x.id ? "true" : undefined}
              className={cn(
                "flex min-w-[11rem] shrink-0 items-center gap-2.5 rounded-[14px] border bg-white px-3 py-2.5 transition-colors",
                selected === x.id ? "border-brand-primary ring-1 ring-brand-primary" : "border-line hover:bg-subtle",
              )}
            >
              <PersonAvatar person={x.person} className="h-8 w-8" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">{personName(x.person)}</span>
                <span className="flex flex-wrap gap-x-2 text-xs">
                  <span className="text-ink">{x.week} this week</span>
                  {x.overdue > 0 && <span className="font-semibold text-danger-ink">{x.overdue} overdue</span>}
                  <span className="text-ink-muted">{x.total} open</span>
                </span>
              </span>
            </Link>
          ))}
          {unassigned > 0 && (
            <Link
              href={personHref("none")}
              className="flex min-w-[9rem] shrink-0 items-center rounded-[14px] border border-dashed border-line bg-white px-3 py-2.5 text-sm text-ink-muted hover:bg-subtle"
            >
              {unassigned} unassigned
            </Link>
          )}
        </div>
      </section>

      {isMemberOf(viewer, team.id) && view === "list" && (
        <div className="mb-4">
          <QuickAdd departments={[{ id: team.id, name: team.name }]} defaultDepartmentId={team.id} />
        </div>
      )}
      <TaskFilterBar
        filters={filters}
        options={options}
        hide={view === "board" ? ["dept", "status", "sort"] : view === "calendar" ? ["dept", "sort", "when"] : ["dept"]}
        preserve={{ ...keep, ...(month ? { month } : {}) }}
      />
    </>
  );
}
