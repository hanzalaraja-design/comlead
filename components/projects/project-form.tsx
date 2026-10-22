"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelect } from "@/components/multi-select";
import { personName } from "@/lib/labels";
import type { PersonRef, Project } from "@/lib/types";
import { createProject, setProjectArchived, updateProject } from "@/app/(app)/projects/actions";

const selectClass = "h-10 w-full field px-3 text-sm";

/** Start or change a project: what it is, whose it is, who's on it. */
export function ProjectForm({
  project,
  memberIds = [],
  departments,
  people,
  viewerId,
  defaultDepartmentId,
}: {
  project?: Project;
  /** People added by name (the home team is in anyway). */
  memberIds?: string[];
  /** Teams it can belong to: the ones you're in, plus its current one. */
  departments: { id: string; name: string }[];
  people: PersonRef[];
  viewerId: string;
  defaultDepartmentId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState(project?.kind ?? "project");
  const [departmentId, setDepartmentId] = useState(project ? project.department_id ?? "" : defaultDepartmentId ?? "");
  const [members, setMembers] = useState<string[]>(memberIds.filter((m) => m !== project?.created_by && m !== viewerId));

  function onSubmit(formData: FormData) {
    for (const m of members) formData.append("members", m);
    startTransition(async () => {
      if (project) {
        const res = await updateProject(project.id, formData);
        if (res.ok) {
          toast.success("Saved.");
          router.push(`/projects/${project.slug}`);
          router.refresh();
        } else toast.error(res.error);
      } else {
        const res = await createProject(formData);
        if (res.ok && res.data) {
          toast.success("Project started. Add its first tasks.");
          router.push(`/projects/${res.data.slug}`);
        } else if (!res.ok) toast.error(res.error);
      }
    });
  }

  function archive(archived: boolean) {
    startTransition(async () => {
      const res = await setProjectArchived(project!.id, archived);
      if (res.ok) {
        toast.success(archived ? "Archived. Its tasks are kept." : "Back in your projects.");
        router.push(archived ? "/projects" : `/projects/${project!.slug}`);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required maxLength={120} defaultValue={project?.name} autoFocus={!project} placeholder="My Zong App, 11.11" className="h-10" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="kind">Type</Label>
          <select id="kind" name="kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as Project["kind"])}>
            <option value="project">Project</option>
            <option value="campaign">Campaign</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="launch_date">{kind === "campaign" ? "Goes live" : "Launch date"} (optional)</Label>
          <Input id="launch_date" name="launch_date" type="date" defaultValue={project?.launch_date ?? ""} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="department_id">Team</Label>
          <select id="department_id" name="department_id" className={selectClass} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">Across teams (just the people below)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} (everyone in it)
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>{departmentId ? "Also add" : "People"}</Label>
          <MultiSelect
            label={departmentId ? "People from other teams" : "Add people"}
            options={people.filter((p) => p.id !== viewerId).map((p) => ({ value: p.id, label: personName(p), search: p.email }))}
            value={members}
            onChange={setMembers}
            searchable
            className="h-10 w-full justify-between rounded-[12px] text-sm"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">What it&apos;s for (optional)</Label>
        <Textarea id="description" name="description" rows={3} maxLength={2000} defaultValue={project?.description ?? ""} />
      </div>

      <p className="text-xs text-ink-muted">
        Everyone in the project can see its tasks, add tasks and edit them.
        {!project && " You'll lead it."} Leads, the team&apos;s admins and Admins can change the project itself.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? "Saving…" : project ? "Save changes" : "Start project"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        {project && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => archive(!project.archived)} className="ml-auto">
            {project.archived ? "Unarchive" : "Archive project"}
          </Button>
        )}
      </div>
    </form>
  );
}
