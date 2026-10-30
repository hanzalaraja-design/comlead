"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/rich-text-editor";
import { MultiSelect } from "@/components/multi-select";
import { personName } from "@/lib/labels";
import { DOMAINS } from "@/lib/domains";
import { cn } from "@/lib/utils";
import type { PartnerCategory, PersonRef, Project, ProjectKind } from "@/lib/types";
import { createProject, setProjectArchived, updateProject } from "@/app/(app)/projects/actions";

const selectClass = "h-10 w-full field px-3 text-sm";

/** Start or change a project, campaign or partnership: what it is, who owns it, who's on it. */
export function ProjectForm({
  project,
  ownerIds = [],
  memberIds = [],
  departments,
  people,
  viewerId,
  defaultKind = "project",
  defaultTeamIds = [],
  canPickOwners = true,
}: {
  project?: Project;
  /** Its owners now (they can lock it). */
  ownerIds?: string[];
  /** People added by name: the ones working on it. */
  memberIds?: string[];
  /** Every team: any of them can be brought in. */
  departments: { id: string; name: string }[];
  people: PersonRef[];
  viewerId: string;
  defaultKind?: ProjectKind;
  defaultTeamIds?: string[];
  /** Only owners change who the owners are. */
  canPickOwners?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<ProjectKind>(project?.kind ?? defaultKind);
  const [category, setCategory] = useState<PartnerCategory | null>(project?.category ?? null);
  const [owners, setOwners] = useState<string[]>(project ? ownerIds : [viewerId]);
  const [teams, setTeams] = useState<string[]>(project ? project.team_ids : defaultTeamIds);
  const [start, setStart] = useState(project?.start_date ?? "");
  const [members, setMembers] = useState<string[]>(memberIds.filter((m) => !ownerIds.includes(m)));
  const d = DOMAINS[kind];
  const personOptions = people.map((p) => ({ value: p.id, label: personName(p), search: p.email }));

  function onSubmit(formData: FormData) {
    for (const m of members) formData.append("members", m);
    for (const o of owners) formData.append("owners", o);
    for (const t of teams) formData.append("teams", t);
    if (category) formData.set("category", category);
    startTransition(async () => {
      const res = project ? await updateProject(project.id, formData) : await createProject(formData);
      if (res.ok && res.data) {
        toast.success(project ? "Saved." : `${d.label} started. Add its first tasks.`);
        router.push(res.data.href);
        router.refresh();
      } else if (!res.ok) toast.error(res.error);
    });
  }

  function archive(archived: boolean) {
    startTransition(async () => {
      const res = await setProjectArchived(project!.id, archived);
      if (res.ok) {
        toast.success(archived ? "Archived. Its tasks are kept." : `Back in ${d.plural.toLowerCase()}.`);
        router.push(archived ? d.path : `${d.path}/${project!.slug}`);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            required
            maxLength={120}
            defaultValue={project?.name}
            autoFocus={!project}
            placeholder={kind === "campaign" ? "11.11, White Friday" : kind === "partnership" ? "L’Oréal Paris, Daraz" : "My Zong App"}
            className="h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kind">Type</Label>
          <select id="kind" name="kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as ProjectKind)}>
            <option value="project">Project</option>
            <option value="campaign">Campaign</option>
            <option value="partnership">Partnership</option>
          </select>
        </div>
      </div>
      <p className="-mt-2 text-xs text-ink-muted">{d.blurb}</p>

      {kind === "partnership" && (
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-sm font-medium">Brand</legend>
          <div className="inline-flex gap-1 rounded-[12px] bg-subtle p-1">
            {(["beauty", "non_beauty"] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
                className={cn("h-9 rounded-[9px] px-4 text-sm font-semibold", category === c ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink")}
              >
                {c === "beauty" ? "Beauty brand" : "Non-beauty brand"}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Owners</Label>
          <MultiSelect
            label="Pick owners"
            options={personOptions}
            value={owners}
            onChange={canPickOwners ? setOwners : () => toast.error("Only its owners can change who owns it.")}
            searchable
            className="h-10 w-full justify-between rounded-[12px] text-sm"
          />
          <p className="text-xs text-ink-muted">Owners can lock it so only they can change it.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="start_date">{kind === "campaign" ? "Goes live" : "Starts"}</Label>
            <Input id="start_date" name="start_date" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="end_date">{kind === "project" ? "Target" : "Ends"}</Label>
            <Input id="end_date" name="end_date" type="date" min={start || undefined} defaultValue={project?.end_date ?? ""} className="h-10" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Teams</Label>
          <MultiSelect
            label="Pick teams"
            options={departments.map((x) => ({ value: x.id, label: x.name }))}
            value={teams}
            onChange={setTeams}
            className="h-10 w-full justify-between rounded-[12px] text-sm"
          />
          <p className="text-xs text-ink-muted">
            {teams.length ? "It shows in these teams' lists. Only the people you pick below are on it." : kind === "project" ? "No team = an individual project, just its owners and the people below." : "Only the people you pick below are on it."}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>People</Label>
          <MultiSelect
            label="Add people"
            options={personOptions.filter((p) => !owners.includes(p.value))}
            value={members}
            onChange={setMembers}
            searchable
            className="h-10 w-full justify-between rounded-[12px] text-sm"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Description (optional)</Label>
        <RichTextEditor name="description" defaultValue={project?.description} placeholder="The brief: goals, deals, links. Paste a table straight from Excel." />
      </div>

      <p className="text-xs text-ink-muted">
        Everyone in it can see its tasks, add tasks and edit them. While it&apos;s unlocked they can change these details too.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? "Saving…" : project ? "Save changes" : `Start ${d.label.toLowerCase()}`}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        {project && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => archive(!project.archived)} className="ml-auto">
            {project.archived ? "Unarchive" : "Archive"}
          </Button>
        )}
      </div>
    </form>
  );
}
