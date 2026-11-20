import Link from "next/link";
import { EmptyState } from "@/components/page-header";
import { QuickAdd } from "@/components/tasks/quick-add";
import { TaskList } from "@/components/tasks/task-list";
import { SelectableTasks } from "@/components/tasks/selectable-tasks";
import { ProjectComments, type ProjectComment } from "@/components/projects/project-comments";
import { JourneyCards } from "@/components/projects/journeys/journey-cards";
import { JourneyDetail, type Journey, type JourneyPeople } from "@/components/projects/journeys/journey-detail";
import { getPeople } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { withTaskSelect, type TaskListRow } from "@/lib/tasks/queries";
import { formatPKT } from "@/lib/time";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { PartField } from "@/components/projects/terms-panel";

type Raw = Record<string, string | string[] | undefined>;
type PartRow = { id: string; name: string; stage: string; description: string | null; fields: PartField[]; updated_at: string };

/** Does this project use journeys? False before the database has them. */
export async function journeySettings(projectId: string): Promise<{ on: boolean; people: Record<string, string> }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("has_journeys, journey_people").eq("id", projectId).maybeSingle();
  if (error || !data) return { on: false, people: {} };
  return { on: !!data.has_journeys, people: (data.journey_people ?? {}) as Record<string, string> };
}

/**
 * A project split into journeys: the journey cards, the picked journey (where
 * it stands, Mergn, what it is, its description, its tasks and comments), and
 * an Other tasks tab for work that isn't part of one journey.
 */
export async function JourneysView({
  project,
  base,
  raw,
  viewerId,
  canEdit,
  people: who,
  quickDept,
}: {
  project: Project;
  base: string;
  raw: Raw;
  viewerId: string;
  canEdit: boolean;
  people: Record<string, string>;
  quickDept?: string;
}) {
  const supabase = await createClient();
  const [partsRes, people] = await Promise.all([
    supabase.from("project_parts").select("id, name, stage, description, fields, updated_at").eq("project_id", project.id).eq("kind", "journey").order("sort").order("created_at"),
    getPeople(),
  ]);
  const parts = (partsRes.data ?? []) as PartRow[];
  const name = (id?: string) => (id ? personName(people.find((p) => p.id === id) ?? null) : null);
  const journeyPeople: JourneyPeople = { build: name(who.build), review: name(who.review), live: name(who.live) };
  const other = raw.view === "other";
  const selected = parts.find((p) => p.id === raw.journey) ?? parts[0] ?? null;

  const { data: taskData } = await withTaskSelect((select) =>
    supabase
      .from("tasks")
      .select(`${select}, part_id`)
      .eq("project_id", project.id)
      .is("parent_task_id", null)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at"),
  );
  const allTasks = (taskData ?? []) as unknown as (TaskListRow & { part_id: string | null })[];
  const otherTasks = allTasks.filter((t) => !t.part_id || !parts.some((p) => p.id === t.part_id));
  const moveTo = parts.map((p) => ({ id: p.id, name: p.name }));

  const tab = (on: boolean) =>
    cn("inline-flex h-11 items-center gap-1.5 border-b-2 px-3 text-[15px]", on ? "border-brand-primary font-semibold text-ink" : "border-transparent text-ink-muted hover:text-ink");

  return (
    <>
      <nav aria-label="View" className="mb-4 flex gap-1 border-b border-line">
        <Link href={base} aria-current={!other ? "page" : undefined} className={tab(!other)}>
          Journeys <span className="text-ink-muted">{parts.length}</span>
        </Link>
        <Link href={`${base}?view=other`} aria-current={other ? "page" : undefined} className={tab(other)}>
          Other tasks <span className="text-ink-muted">{otherTasks.length}</span>
        </Link>
      </nav>

      {other ? (
        <section className="space-y-3">
          <p className="text-sm text-ink-muted">Work that isn&apos;t part of one journey, like setup, tools and integrations. Tick tasks and use Journey to move them into one.</p>
          {canEdit && <QuickAdd departments={[]} defaultDepartmentId={quickDept} projectId={project.id} />}
          {otherTasks.length ? (
            <SelectableTasks ids={otherTasks.map((t) => t.id)} parts={moveTo}>
              <TaskList tasks={otherTasks} selectable showProject={false} from="project" />
            </SelectableTasks>
          ) : (
            <EmptyState>Every task is in a journey.</EmptyState>
          )}
        </section>
      ) : (
        <>
          <JourneyCards
            projectId={project.id}
            journeys={parts.map((p) => ({ id: p.id, name: p.name, stage: p.stage, who: p.fields.find((f) => /who/i.test(f.label))?.value ?? "" }))}
            selectedId={selected?.id ?? null}
            base={base}
            canEdit={canEdit}
          />
          {selected ? (
            <SelectedJourney
              key={selected.id}
              part={selected}
              project={project}
              tasks={allTasks.filter((t) => t.part_id === selected.id)}
              moveTo={moveTo}
              people={journeyPeople}
              canEdit={canEdit}
              startEditing={raw.edit === "1"}
              viewerId={viewerId}
              quickDept={quickDept}
            />
          ) : (
            <EmptyState>No journeys yet. Start one with New journey.</EmptyState>
          )}
        </>
      )}
    </>
  );
}

async function SelectedJourney({
  part,
  project,
  tasks,
  moveTo,
  people,
  canEdit,
  startEditing,
  viewerId,
  quickDept,
}: {
  part: PartRow;
  project: Project;
  tasks: TaskListRow[];
  moveTo: { id: string; name: string }[];
  people: JourneyPeople;
  canEdit: boolean;
  startEditing: boolean;
  viewerId: string;
  quickDept?: string;
}) {
  const supabase = await createClient();
  const [{ data: commentData }, everyone, { data: liveLog }] = await Promise.all([
    supabase.from("project_comments").select("id, body, author_id, created_at").eq("project_id", project.id).eq("part_id", part.id).order("created_at"),
    getPeople(),
    part.stage === "live"
      ? supabase.from("activity_log").select("created_at").eq("entity_id", part.id).eq("action", "journey.stage_changed").contains("new_value", { stage: "live" }).order("created_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] }),
  ]);
  const byId = new Map(everyone.map((p) => [p.id, p]));
  const comments: ProjectComment[] = ((commentData ?? []) as { id: string; body: string; author_id: string; created_at: string }[]).map((c) => ({
    id: c.id,
    body: c.body,
    when: formatPKT(c.created_at, "d MMM, h:mm a"),
    author: byId.get(c.author_id) ?? null,
    authorName: personName(byId.get(c.author_id) ?? null),
    mine: c.author_id === viewerId,
  }));
  const liveAt = (liveLog as { created_at: string }[] | null)?.[0]?.created_at;
  const journey: Journey = {
    id: part.id,
    name: part.name,
    stage: part.stage,
    description: part.description,
    fields: Array.isArray(part.fields) ? part.fields : [],
    liveSince: liveAt ? formatPKT(liveAt, "d MMM") : null,
  };

  return (
    <>
      <JourneyDetail journey={journey} people={people} canEdit={canEdit} startEditing={startEditing} />
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-ink">
          Tasks for {part.name} <span className="font-normal text-ink-muted">· {tasks.length}</span>
        </h2>
        {canEdit && <QuickAdd departments={[]} defaultDepartmentId={quickDept} projectId={project.id} partId={part.id} />}
        {tasks.length ? (
          <SelectableTasks ids={tasks.map((t) => t.id)} parts={moveTo}>
            <TaskList tasks={tasks} selectable showProject={false} from="project" />
          </SelectableTasks>
        ) : (
          <EmptyState>No tasks in this journey yet.</EmptyState>
        )}
      </section>
      <ProjectComments projectId={project.id} partId={part.id} comments={comments} canComment title={`Comments on ${part.name}`} />
    </>
  );
}
