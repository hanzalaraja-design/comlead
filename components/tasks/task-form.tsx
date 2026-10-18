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
import type { Department, PersonRef, Task, TaskStatus } from "@/lib/types";
import { createTask, updateTask } from "@/app/(app)/tasks/actions";

export type TaskFormProps = {
  task?: Task;
  collaboratorIds?: string[];
  /** Departments the task may be placed in. */
  departments: Pick<Department, "id" | "name">[];
  people: PersonRef[];
  /** department_id → member user ids, to suggest owners. */
  membersByDept: Record<string, string[]>;
  defaultDepartmentId?: string;
  defaultOwnerId?: string;
  meetingId?: string;
  /** Members can't reassign someone else's task or move it between departments. */
  canReassign: boolean;
  canMove: boolean;
};

const selectClass = "h-10 w-full field px-3 text-sm disabled:opacity-60";

export function TaskForm(props: TaskFormProps) {
  const { task } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [departmentId, setDepartmentId] = useState(task?.department_id ?? props.defaultDepartmentId ?? props.departments[0]?.id ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [collaborators, setCollaborators] = useState<string[]>(props.collaboratorIds ?? []);
  // The extras stay folded away unless the task already uses them.
  const [more, setMore] = useState(
    !!task && !!(task.description || task.tags.length || task.due_time || (props.collaboratorIds ?? []).length),
  );

  const ownerIds = new Set(props.membersByDept[departmentId] ?? []);
  if (task?.owner_id) ownerIds.add(task.owner_id);
  if (props.defaultOwnerId) ownerIds.add(props.defaultOwnerId);
  const ownerOptions = props.people.filter((p) => ownerIds.has(p.id));
  const pickDepartment = props.departments.length > 1 && (!task || props.canMove);

  function onSubmit(formData: FormData) {
    for (const c of collaborators) formData.append("collaborators", c);
    startTransition(async () => {
      if (task) {
        const res = await updateTask(task.id, formData);
        if (res.ok) {
          toast.success("Saved.");
          router.refresh();
        } else toast.error(res.error);
      } else {
        const res = await createTask(formData);
        if (res.ok && res.data) {
          toast.success("Task created.");
          router.push(`/tasks/${res.data.id}`);
        } else if (!res.ok) toast.error(res.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      {props.meetingId && <input type="hidden" name="meeting_id" value={props.meetingId} />}
      {!pickDepartment && <input type="hidden" name="department_id" value={departmentId} />}
      {!task && <input type="hidden" name="status" value="todo" />}

      <div className="space-y-1.5">
        <Label htmlFor="title">What needs doing</Label>
        <Input id="title" name="title" required maxLength={300} defaultValue={task?.title} autoFocus={!task} className="h-10" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="owner_id">Owner</Label>
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
              {props.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
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
              options={props.people.map((p) => ({ value: p.id, label: personName(p), hint: p.email }))}
              value={collaborators}
              onChange={setCollaborators}
              searchable
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="due_time">Due time</Label>
            <TimeSelect id="due_time" name="due_time" defaultValue={task?.due_time ?? ""} disabled={!dueDate} emptyLabel="No time" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tags">Tags</Label>
            <Input id="tags" name="tags" defaultValue={task?.tags.join(", ")} placeholder="Q4, Birthday Bash" className="h-10" />
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
