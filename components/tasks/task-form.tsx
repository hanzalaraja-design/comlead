"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelect } from "@/components/multi-select";
import { RichTextEditor } from "@/components/rich-text-editor";
import { PRIORITIES, STATUSES, personName } from "@/lib/labels";
import type { Department, PersonRef, SubTeam, Task, TaskStatus } from "@/lib/types";
import { createTask, updateTask } from "@/app/(app)/tasks/actions";

export type TaskFormProps = {
  task?: Task;
  collaboratorIds?: string[];
  /** Departments the task may be placed in. */
  departments: Pick<Department, "id" | "name">[];
  subTeams: SubTeam[];
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
  const [departmentId, setDepartmentId] = useState(
    task?.department_id ?? props.defaultDepartmentId ?? props.departments[0]?.id ?? "",
  );
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [collaborators, setCollaborators] = useState<string[]>(props.collaboratorIds ?? []);

  const subTeams = props.subTeams.filter((s) => s.department_id === departmentId && (!s.archived || s.id === task?.sub_team_id));
  const ownerIds = new Set(props.membersByDept[departmentId] ?? []);
  if (task?.owner_id) ownerIds.add(task.owner_id);
  if (props.defaultOwnerId) ownerIds.add(props.defaultOwnerId);
  const ownerOptions = props.people.filter((p) => ownerIds.has(p.id));

  function onSubmit(formData: FormData) {
    for (const c of collaborators) formData.append("collaborators", c);
    startTransition(async () => {
      if (task) {
        const res = await updateTask(task.id, formData);
        if (res.ok) {
          toast.success("Saved");
          router.refresh();
        } else toast.error(res.error);
      } else {
        const res = await createTask(formData);
        if (res.ok && res.data) {
          toast.success("Task created");
          router.push(`/tasks/${res.data.id}`);
        } else if (!res.ok) toast.error(res.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      {props.meetingId && <input type="hidden" name="meeting_id" value={props.meetingId} />}

      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required maxLength={300} defaultValue={task?.title} autoFocus={!task} className="h-10" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="department_id">Department</Label>
          <select
            id="department_id"
            name="department_id"
            className={selectClass}
            value={departmentId}
            disabled={!!task && !props.canMove}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            {props.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {!!task && !props.canMove && <input type="hidden" name="department_id" value={departmentId} />}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sub_team_id">Sub-team</Label>
          <select
            id="sub_team_id"
            name="sub_team_id"
            className={selectClass}
            defaultValue={task?.sub_team_id ?? ""}
            key={departmentId}
            disabled={!subTeams.length}
          >
            <option value="">{subTeams.length ? "None" : "No sub-teams"}</option>
            {subTeams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

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
          <Label>Collaborators</Label>
          <div>
            <MultiSelect
              label="Add people"
              className="h-10 w-full justify-between rounded-md"
              options={props.people.map((p) => ({ value: p.id, label: personName(p), hint: p.email }))}
              value={collaborators}
              onChange={setCollaborators}
              searchable
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
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

        {status === "blocked" && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="blocked_reason">Blocked reason</Label>
            <Textarea
              id="blocked_reason"
              name="blocked_reason"
              defaultValue={task?.blocked_reason ?? ""}
              placeholder="What's in the way?"
              rows={2}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="start_date">Start date (optional)</Label>
          <Input
            id="start_date"
            name="start_date"
            type="date"
            defaultValue={task?.start_date ?? ""}
            max={dueDate || undefined}
            className="h-10"
          />
        </div>
        <div className="hidden sm:block" />

        <div className="space-y-1.5">
          <Label htmlFor="due_date">Due date</Label>
          <Input
            id="due_date"
            name="due_date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="due_time">Time (optional)</Label>
          <Input
            id="due_time"
            name="due_time"
            type="time"
            defaultValue={task?.due_time?.slice(0, 5) ?? ""}
            disabled={!dueDate}
            className="h-10"
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="tags">Tags</Label>
          <Input id="tags" name="tags" defaultValue={task?.tags.join(", ")} placeholder="e.g. Q4, Birthday Bash" className="h-10" />
          <p className="text-xs text-muted-foreground">Separate tags with commas.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Description</Label>
        <RichTextEditor name="description" defaultValue={task?.description} placeholder="Details, links, context…" />
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
