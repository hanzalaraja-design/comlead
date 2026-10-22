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
  defaultTeamIds = [],
}: {
  project?: Project;
  /** People added by name (the home team is in anyway). */
  memberIds?: string[];
  /** Every team: any of them can be brought in. */
  departments: { id: string; name: string }[];
  people: PersonRef[];
  viewerId: string;
  defaultTeamIds?: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState(project?.kind ?? "project");
  const [teams, setTeams] = useState<string[]>(project ? project.team_ids : defaultTeamIds);
  const [start, setStart] = useState(project?.start_date ?? "");
  const [members, setMembers] = useState<string[]>(memberIds.filter((m) => m !== project?.created_by && m !== viewerId));

  function onSubmit(formData: FormData) {
    for (const m of members) formData.append("members", m);
    for (const t of teams) formData.append("teams", t);
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
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="start_date">{kind === "campaign" ? "Goes live" : "Starts"}</Label>
            <Input id="start_date" name="start_date" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="end_date">Ends</Label>
            <Input id="end_date" name="end_date" type="date" min={start || undefined} defaultValue={project?.end_date ?? ""} className="h-10" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Teams</Label>
          <MultiSelect
            label="Pick teams (everyone in them joins)"
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
            value={teams}
            onChange={setTeams}
            className="h-10 w-full justify-between rounded-[12px] text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label>{teams.length ? "Also add" : "People"}</Label>
          <MultiSelect
            label={teams.length ? "People from other teams" : "Add people"}
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
