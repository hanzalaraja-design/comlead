import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { PersonAvatar } from "@/components/person-avatar";
import { launchText } from "@/components/projects/project-header";
import { TaskTabs } from "@/components/tasks/task-tabs";
import { getDepartments, getPeople, requireViewer } from "@/lib/auth";
import { KIND_LABELS, getProjects, membersByProject } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata = { title: "Projects · Highfy Tasks" };

type Counts = { open: number; done: number; overdue: number };

export default async function ProjectsPage() {
  const supabase = await createClient();
  const [, projects, departments, people] = await Promise.all([requireViewer(), getProjects(), getDepartments(), getPeople()]);
  const ids = projects.map((p) => p.id);
  const [members, { data: rows }] = await Promise.all([
    membersByProject(projects),
    ids.length
      ? supabase.from("tasks").select("project_id, status, overdue").in("project_id", ids).neq("status", "cancelled").limit(10000)
      : Promise.resolve({ data: [] as { project_id: string; status: string; overdue: boolean }[] }),
  ]);

  const counts = new Map<string, Counts>();
  for (const r of rows ?? []) {
    const c = counts.get(r.project_id as string) ?? { open: 0, done: 0, overdue: 0 };
    if (r.status === "done") c.done++;
    else c.open++;
    if (r.overdue) c.overdue++;
    counts.set(r.project_id as string, c);
  }
  const teamName = new Map(departments.map((d) => [d.id, d.name]));
  const personById = new Map(people.map((p) => [p.id, p]));
  const live = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);

  const card = (p: Project) => {
    const c = counts.get(p.id) ?? { open: 0, done: 0, overdue: 0 };
    const total = c.open + c.done;
    const pct = total ? Math.round((c.done / total) * 100) : 0;
    const who = (members[p.id] ?? []).map((id) => personById.get(id)).filter((x) => !!x);
    const launch = launchText(p.launch_date, p.kind);
    return (
      <li key={p.id}>
        <Link href={`/projects/${p.slug}`} className="block h-full surface p-4 transition-shadow hover:shadow-md">
          <div className="flex items-start justify-between gap-2">
            <h2 className="min-w-0 text-[17px] font-semibold leading-snug text-ink">{p.name}</h2>
            <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-xs font-semibold text-ink">{KIND_LABELS[p.kind]}</span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            {p.department_id ? `${teamName.get(p.department_id) ?? "Team"} team` : "Across teams"}
            {launch && <span className="font-semibold text-brand-primary"> · {launch}</span>}
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-subtle" aria-label={`${pct}% done`}>
            <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-muted">
            <span>
              {c.open} open · {c.done} done
              {c.overdue > 0 && <span className="font-semibold text-danger"> · {c.overdue} overdue</span>}
            </span>
            <span className="flex -space-x-1.5">
              {who.slice(0, 5).map((m) => (
                <PersonAvatar key={m!.id} person={m} className="h-6 w-6 ring-2 ring-white" />
              ))}
              {who.length > 5 && <span className="pl-2.5">+{who.length - 5}</span>}
            </span>
          </div>
        </Link>
      </li>
    );
  };

  return (
    <>
      <PageHeader
        breadcrumb={["Tasks", "Projects"]}
        title="Projects"
        actions={
          <Button asChild size="sm">
            <Link href="/projects/new">
              <Plus className="h-4 w-4" /> New project
            </Link>
          </Button>
        }
      />
      <TaskTabs scope="projects" />
      {live.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{live.map(card)}</ul>
      ) : (
        <EmptyState>
          <span className="flex flex-col items-center gap-2">
            <FolderKanban className="h-6 w-6 text-ink-muted" />
            No projects yet. Start one for an app, a launch or a campaign, and bring in people from any team.
          </span>
        </EmptyState>
      )}
      {archived.length > 0 && (
        <details className="mt-8">
          <summary className={cn("kicker cursor-pointer text-ink")}>Archived · {archived.length}</summary>
          <ul className="mt-3 grid gap-3 opacity-80 sm:grid-cols-2 xl:grid-cols-3">{archived.map(card)}</ul>
        </details>
      )}
    </>
  );
}
