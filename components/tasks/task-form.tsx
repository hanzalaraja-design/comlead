"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TimeSelect } from "@/components/time-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelect } from "@/components/multi-select";
import { RichTextEditor } from "@/components/rich-text-editor";
import { PRIORITIES, STATUSES, personName } from "@/lib/labels";
import type { Department, PersonRef, ProjectKind, Task, TaskStatus } from "@/lib/types";
import { DOMAINS } from "@/lib/domains";
import { createTask, updateTask } from "@/app/(app)/tasks/actions";
import { askAboutOpenSubtasks } from "@/components/tasks/subtask-prompt";
import { NeededFromOthers, type SubtaskDraft } from "@/components/tasks/subtasks";
import { openSubtaskCount } from "@/lib/tasks/open-subtasks";

export type TaskFormProps = {
  task?: Task;
  collaboratorIds?: string[];
  /** Departments the task may be placed in. */
  departments: Pick<Department, "id" | "name">[];
  people: PersonRef[];
  /** department_id → member user ids, to suggest owners. */
  membersByDept: Record<string, string[]>;
  /** Projects the task may go in, and who's in each. */
  projects?: { id: string; name: string; kind?: ProjectKind; department_id: string | null }[];
  membersByProject?: Record<string, string[]>;
  defaultDepartmentId?: string;
  defaultProjectId?: string;
  defaultOwnerId?: string;
  meetingId?: string;
  /** Members can't reassign someone else's task or move it between departments. */
  canReassign: boolean;
  canMove: boolean;
  /** Editing a subtask: it stays with its main task, so no team or project. */
  isSubtask?: boolean;
};

const selectClass = "h-10 w-full field px-3 text-sm disabled:opacity-60";
const PRIVATE = "private";

export function TaskForm(props: TaskFormProps) {
  const { task } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const projects = props.projects ?? [];
  const [projectId, setProjectId] = useState(task ? task.project_id ?? "" : props.defaultProjectId ?? "");
  // A project's task goes in the project's team when you're in it.
  const projectTeam = (id: string) => {
    const home = projects.find((p) => p.id === id)?.department_id;
    return home && props.departments.some((d) => d.id === home) ? home : PRIVATE;
  };
  // New tasks start private unless opened from a team or project; a team task can't be made private again,
  // but in a project it can leave the team.
  const offerPrivate = !task || task.department_id === null;
  const offerNoTeam = offerPrivate || !!projectId;
  const [departmentId, setDepartmentId] = useState(
    task
      ? task.department_id ?? PRIVATE
      : props.defaultDepartmentId ?? (props.defaultProjectId ? projectTeam(props.defaultProjectId) : PRIVATE),
  );
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [collaborators, setCollaborators] = useState<string[]>(props.collaboratorIds ?? []);
  // New team tasks can go to several people at once: one task each.
  const [owners, setOwners] = useState<string[]>(props.defaultOwnerId ? [props.defaultOwnerId] : []);
  // Anyone can give a new task to anyone, several at once: one task each.
  const pickOwners = !task;
  const [drafts, setDrafts] = useState<SubtaskDraft[]>([]);
  const forOthers = pickOwners ? owners.some((o) => o !== props.defaultOwnerId) : !!task?.owner_id && task.owner_id !== task.created_by;
  // The extras stay folded away unless the task already uses them.
  const [more, setMore] = useState(
    !!task && !!(task.description || task.due_time || (props.collaboratorIds ?? []).length),
  );

  // Everyone can be given a task; people in the team or project come first.
  const near = new Set([...(props.membersByDept[departmentId] ?? []), ...(props.membersByProject?.[projectId] ?? [])]);
  const ownerOptions = [...props.people].sort((a, b) => Number(near.has(b.id)) - Number(near.has(a.id)));
  const pickDepartment = !props.isSubtask && (props.departments.length > 1 || offerNoTeam) && (!task || props.canMove || offerNoTeam);

  function onSubmit(formData: FormData) {
    for (const c of collaborators) formData.append("collaborators", c);
    if (pickOwners) {
      formData.delete("owner_id");
      formData.set("owner_id", owners[0] ?? "");
      for (const o of owners) formData.append("owner_ids", o);
    }
    if (!task && owners.length <= 1)
      for (const d of drafts) {
        if (!d.title.trim() || !d.owner_id) continue;
        formData.append("subtask_title", d.title);
        formData.append("subtask_owner", d.owner_id);
        formData.append("subtask_due", d.due_date);
      }
    startTransition(async () => {
      if (task) {
        let res = await updateTask(task.id, formData);
        // Done with subtasks still open: ask, then save with the answer.
        const open = !res.ok ? openSubtaskCount(res.error) : null;
        if (open !== null) {
          const choice = await askAboutOpenSubtasks(open);
          if (!choice) return;
          formData.set("subtasks", choice);
          res = await updateTask(task.id, formData);
        }
        if (res.ok) {
          toast.success("Saved.");
          router.refresh();
        } else toast.error(res.error);
      } else {
        const res = await createTask(formData);
        if (res.ok && res.data) {
          toast.success(res.data.count > 1 ? `${res.data.count} tasks created, one for each person.` : "Task created.");
          router.push(`/tasks/${res.data.id}`);
        } else if (!res.ok) toast.error(res.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      {props.meetingId && <input type="hidden" name="meeting_id" value={props.meetingId} />}
      {!pickDepartment && <input type="hidden" name="department_id" value={departmentId} />}
      {props.isSubtask && <input type="hidden" name="subtask" value="1" />}
      {!task && <input type="hidden" name="status" value="todo" />}

      <div className="space-y-1.5">
        <Label htmlFor="title">What needs doing</Label>
        <Input id="title" name="title" required maxLength={300} defaultValue={task?.title} autoFocus={!task} className="h-10" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="owner_id">{pickOwners ? "Owner (pick several to give everyone their own)" : "Owner"}</Label>
          {pickOwners ? (
            <MultiSelect
              label="Unassigned"
              options={ownerOptions.map((p) => ({ value: p.id, label: personName(p), search: p.email }))}
              value={owners}
              onChange={setOwners}
              searchable
              className="h-10 w-full justify-between rounded-[12px] text-sm"
            />
          ) : (
          <select
            id="owner_id"
            name="owner_id"
            className={selectClass}
            defaultValue={task ? task.owner_id ?? "" : props.defaultOwnerId ?? ""}
            disabled={!!task && !props.canReassign}
          >
            <option value="">Unassigned</option>
            {ownerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </select>
          )}
          {pickOwners && owners.length > 1 && (
            <p className="text-xs text-ink-muted">{owners.length} separate tasks, linked so you can see who&apos;s done.</p>
          )}
          {!!task && !props.canReassign && <input type="hidden" name="owner_id" value={task.owner_id ?? ""} />}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="due_date">Due</Label>
          <Input id="due_date" name="due_date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="priority">Priority</Label>
          <select id="priority" name="priority" className={selectClass} defaultValue={task?.priority ?? "medium"}>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {pickDepartment && (
          <div className="space-y-1.5">
            <Label htmlFor="department_id">Team</Label>
            <select id="department_id" name="department_id" className={selectClass} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              {offerNoTeam && (
                <option value={PRIVATE}>
                  {projectId ? "No team (just the project)" : forOthers ? "No team (just you and them)" : "Private (only you)"}
                </option>
              )}
              {props.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {!props.isSubtask && (projects.length > 0 || !!task?.project_id) && (
          <div className="space-y-1.5">
            <Label htmlFor="project_id">Project, campaign or partnership</Label>
            <select
              id="project_id"
              name="project_id"
              className={selectClass}
              value={projectId}
              onChange={(e) => {
                const next = e.target.value;
                setProjectId(next);
                // New tasks follow the project to its team; leaving a project can't leave a task teamless and shared.
                if (!task && next) setDepartmentId(projectTeam(next));
                else if (!next && departmentId === PRIVATE && !offerPrivate) setDepartmentId(task?.department_id ?? PRIVATE);
              }}
            >
              <option value="">None</option>
              {(["campaign", "partnership", "project"] as const).map((k) => {
                const list = projects.filter((p) => (p.kind ?? "project") === k);
                return list.length ? (
                  <optgroup key={k} label={DOMAINS[k].plural}>
                    {list.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
          </div>
        )}
        {task && (
          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <select id="status" name="status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {status === "blocked" && (
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="blocked_reason">What&apos;s in the way?</Label>
            <Textarea id="blocked_reason" name="blocked_reason" defaultValue={task?.blocked_reason ?? ""} rows={2} />
          </div>
        )}
      </div>

      {!task && (
        <NeededFromOthers
          people={props.people}
          drafts={drafts}
          onChange={setDrafts}
          disabledReason={owners.length > 1 ? "With several owners, add these on each task once it's created." : undefined}
        />
      )}
      <button
        type="button"
        onClick={() => setMore((m) => !m)}
        aria-expanded={more}
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"
      >
        <ChevronDown className={more ? "h-4 w-4 rotate-180 transition-transform" : "h-4 w-4 transition-transform"} />
        {more ? "Fewer details" : "More details"}
      </button>

      {/* Kept in the form when folded, so saving never drops them. */}
      <div className={more ? "space-y-4" : "hidden"}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Collaborators</Label>
            <MultiSelect
              label="Add people"
              className="h-10 w-full justify-between rounded-md"
              options={props.people.map((p) => ({ value: p.id, label: personName(p), search: p.email }))}
              value={collaborators}
              onChange={setCollaborators}
              searchable
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="due_time">Due time</Label>
            <TimeSelect id="due_time" name="due_time" defaultValue={task?.due_time ?? ""} disabled={!dueDate} emptyLabel="No time" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <RichTextEditor name="description" defaultValue={task?.description} placeholder="Details, links, context…" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? "Saving…" : task ? "Save changes" : "Create task"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
