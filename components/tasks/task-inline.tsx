"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Lock, LockOpen, Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/person-avatar";
import { RichTextEditor } from "@/components/rich-text-editor";
import { RichTextView } from "@/components/rich-text-view";
import { MeetingTag, ProjectTag } from "@/components/tasks/task-badges";
import { DOMAINS, domainHref } from "@/lib/domains";
import { personName } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { PersonRef, ProjectKind } from "@/lib/types";
import { setTaskCollaborators, setTaskTeams, updateTaskInline } from "@/app/(app)/tasks/actions";

/**
 * The task page edits in place: click a field, change it, it saves. A locked
 * task (or one you can't edit) shows the same fields, read-only.
 */

function useSaver() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run(work: () => Promise<{ ok: boolean; error?: string }>, onFail?: () => void, done?: string) {
    startTransition(async () => {
      const res = await work();
      if (res.ok) {
        if (done) toast.success(done);
        router.refresh();
      } else {
        onFail?.();
        toast.error(res.error || "That didn't save.");
      }
    });
  }
  return { pending, run };
}

export function InlineTitle({ taskId, title, editable }: { taskId: string; title: string; editable: boolean }) {
  const { pending, run } = useSaver();
  const [value, setValue] = useState(title);
  const [editing, setEditing] = useState(false);
  if (!editable) return <>{title}</>;
  function save() {
    setEditing(false);
    const next = value.trim();
    if (!next || next === title) return setValue(title);
    run(() => updateTaskInline(taskId, { title: next }), () => setValue(title));
  }
  return editing ? (
    <input
      autoFocus
      aria-label="Title"
      value={value}
      maxLength={300}
      disabled={pending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setValue(title);
          setEditing(false);
        }
      }}
      className="-ml-2 w-full rounded-[10px] bg-white px-2 py-0.5 outline-none ring-2 ring-[#C99BD3]"
    />
  ) : (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to rename"
      className="-ml-2 rounded-[10px] px-2 py-0.5 text-left hover:bg-white hover:ring-1 hover:ring-line"
    >
      {value}
    </button>
  );
}

export function InlineNotes({ taskId, html, editable }: { taskId: string; html: string | null; editable: boolean }) {
  const { pending, run } = useSaver();
  const [editing, setEditing] = useState(false);
  if (!editable) return html ? <RichTextView html={html} /> : null;
  if (!editing)
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="-m-2 block w-[calc(100%+1rem)] rounded-[10px] p-2 text-left hover:bg-subtle/60"
        title="Click to edit the notes"
      >
        {html ? <RichTextView html={html} /> : <span className="text-sm text-ink-muted">Add notes, links, context…</span>}
      </button>
    );
  return (
    <form
      action={(fd) => run(() => updateTaskInline(taskId, { description: String(fd.get("description") ?? "") }), undefined, "Notes saved.")}
      onSubmit={() => setEditing(false)}
      className="space-y-2"
    >
      <RichTextEditor name="description" defaultValue={html} placeholder="Notes, links, context…" />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save notes
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

type Choice = { id: string; label: string; person?: PersonRef };

/** Chips you add to and remove from: teams, collaborators. */
function ChipField({
  value,
  choices,
  editable,
  addLabel,
  onSave,
}: {
  value: string[];
  choices: Choice[];
  editable: boolean;
  addLabel: string;
  onSave: (next: string[]) => Promise<{ ok: boolean; error?: string }>;
}) {
  const { pending, run } = useSaver();
  const [ids, setIds] = useState(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const byId = new Map(choices.map((c) => [c.id, c]));
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return choices.filter((c) => !ids.includes(c.id) && (!q || c.label.toLowerCase().includes(q)));
  }, [choices, ids, query]);
  function save(next: string[]) {
    const before = ids;
    setIds(next);
    run(() => onSave(next), () => setIds(before));
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const c = byId.get(id);
        return (
          <span key={id} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-subtle pl-1 pr-2 text-[13px] font-medium text-ink">
            {c?.person !== undefined ? <PersonAvatar person={c.person} className="h-5 w-5" /> : <span className="w-1" />}
            {c?.label ?? "…"}
            {editable && (
              <button type="button" aria-label={`Remove ${c?.label ?? ""}`} disabled={pending} onClick={() => save(ids.filter((x) => x !== id))} className="text-ink-muted hover:text-ink">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        );
      })}
      {!ids.length && !editable && <span className="text-ink-muted">None</span>}
      {editable && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line px-2.5 text-[13px] text-ink-muted hover:text-ink">
              <Plus className="h-3.5 w-3.5" /> {addLabel}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <div className="border-b p-2">
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="h-8 w-full rounded-md bg-muted px-2 text-sm outline-none" />
            </div>
            <ul className="max-h-72 overflow-y-auto p-1">
              {shown.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                      save([...ids, c.id]);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-subtle"
                  >
                    {c.person !== undefined && <PersonAvatar person={c.person} className="h-5 w-5" />}
                    <span className="truncate">{c.label}</span>
                  </button>
                </li>
              ))}
              {!shown.length && <li className="px-2 py-1.5 text-sm text-ink-muted">Nothing else to add.</li>}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function TeamsField({ taskId, value, teams, editable }: { taskId: string; value: string[]; teams: { id: string; name: string }[]; editable: boolean }) {
  return (
    <ChipField
      value={value}
      choices={teams.map((t) => ({ id: t.id, label: t.name }))}
      editable={editable}
      addLabel="Add team"
      onSave={(next) => setTaskTeams(taskId, next)}
    />
  );
}

export function CollaboratorsField({
  taskId,
  value,
  people,
  ownerId,
  editable,
}: {
  taskId: string;
  value: string[];
  people: PersonRef[];
  ownerId: string | null;
  editable: boolean;
}) {
  return (
    <ChipField
      value={value}
      choices={people.filter((p) => p.id !== ownerId).map((p) => ({ id: p.id, label: personName(p), person: p }))}
      editable={editable}
      addLabel="Add"
      onSave={(next) => setTaskCollaborators(taskId, next)}
    />
  );
}

type LinkProject = { id: string; name: string; slug: string; kind: ProjectKind };
type LinkMeeting = { id: string; title: string | null; meeting_date: string };

/** What the task belongs to, as tags, and one search to link a project, campaign, partnership or meeting. */
export function LinkTags({
  taskId,
  project,
  meeting,
  projects,
  meetings,
  editable,
}: {
  taskId: string;
  project: LinkProject | null;
  meeting: LinkMeeting | null;
  projects: LinkProject[];
  meetings: LinkMeeting[];
  editable: boolean;
}) {
  const { pending, run } = useSaver();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = [
    ...(["campaign", "partnership", "project"] as const).map((k) => ({
      label: DOMAINS[k].plural,
      items: projects
        .filter((p) => p.kind === k && p.id !== project?.id && (!q || p.name.toLowerCase().includes(q)))
        .map((p) => ({ key: p.id, label: p.name, pick: () => run(() => updateTaskInline(taskId, { project_id: p.id }), undefined, `Linked to ${p.name}.`) })),
    })),
    {
      label: "Meetings",
      items: meetings
        .filter((m) => m.id !== meeting?.id && (!q || (m.title ?? "meeting").toLowerCase().includes(q)))
        .map((m) => ({
          key: m.id,
          label: `${m.title || "Meeting"} · ${m.meeting_date.slice(8, 10)}/${m.meeting_date.slice(5, 7)}`,
          pick: () => run(() => updateTaskInline(taskId, { meeting_id: m.id }), undefined, "Linked to the meeting."),
        })),
    },
  ].filter((g) => g.items.length);

  const unlink = (patch: { project_id?: null; meeting_id?: null }) => run(() => updateTaskInline(taskId, patch), undefined, "Unlinked.");

  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      {project && (
        <span className="inline-flex max-w-full items-center gap-1">
          <Link href={domainHref(project)} className="max-w-full hover:opacity-80">
            <ProjectTag name={project.name} kind={project.kind} prefix={DOMAINS[project.kind].label} size="md" />
          </Link>
          {editable && (
            <button type="button" aria-label={`Unlink ${project.name}`} disabled={pending} onClick={() => unlink({ project_id: null })} className="text-ink-muted hover:text-ink">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      )}
      {meeting && (
        <span className="inline-flex max-w-full items-center gap-1">
          <Link href={`/meetings/${meeting.id}`} className="max-w-full hover:opacity-80">
            <MeetingTag title={meeting.title} date={meeting.meeting_date} prefix="Meeting" size="md" />
          </Link>
          {editable && (
            <button type="button" aria-label="Unlink the meeting" disabled={pending} onClick={() => unlink({ meeting_id: null })} className="text-ink-muted hover:text-ink">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      )}
      {editable && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-line px-2.5 text-[13px] font-semibold text-ink-muted hover:text-ink">
              <Plus className="h-3.5 w-3.5" /> Link
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <div className="border-b p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Project, campaign, partnership or meeting…"
                className="h-8 w-full rounded-md bg-muted px-2 text-sm outline-none"
              />
            </div>
            <div className="max-h-80 overflow-y-auto p-1">
              {groups.map((g) => (
                <div key={g.label}>
                  <p className="px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-ink-muted">{g.label}</p>
                  {g.items.slice(0, 8).map((i) => (
                    <button
                      key={i.key}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setQuery("");
                        i.pick();
                      }}
                      className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-subtle"
                    >
                      <span className="truncate">{i.label}</span>
                    </button>
                  ))}
                </div>
              ))}
              {!groups.length && <p className="px-2 py-2 text-sm text-ink-muted">Nothing matches.</p>}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

/** Only the owner locks a task; then only they can change it. */
export function TaskLockSwitch({ taskId, locked, canToggle }: { taskId: string; locked: boolean; canToggle: boolean }) {
  const { pending, run } = useSaver();
  const [on, setOn] = useState(locked);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex flex-col">
        <span className="flex items-center gap-1.5 font-semibold text-ink">
          {on ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
          {on ? "Locked" : "Lock this task"}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Lock this task"
        disabled={!canToggle || pending}
        title={canToggle ? undefined : "Only the owner can lock or unlock it"}
        onClick={() => {
          const next = !on;
          setOn(next);
          run(() => updateTaskInline(taskId, { locked: next }), () => setOn(!next), next ? "Locked." : "Unlocked.");
        }}
        className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50", on ? "bg-brand-primary" : "bg-line")}
      >
        <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white transition-all", on ? "left-5" : "left-1")}>
          {on && <Check className="h-4 w-4 p-0.5 text-brand-primary" />}
        </span>
      </button>
    </div>
  );
}
