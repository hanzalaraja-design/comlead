"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScheduleEditor } from "@/components/departments/team-manager";
import type { Department, SubTeam } from "@/lib/types";
import {
  createDepartment,
  createSubTeam,
  moveDepartment,
  renameDepartment,
  renameSubTeam,
  setDepartmentArchived,
  setSubTeamArchived,
} from "@/app/(app)/admin/actions";

type Result = { ok: boolean; error?: string };

function useRunner() {
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<Result>, success?: string, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (success) toast.success(success);
        after?.();
      } else toast.error(res.error ?? "Something went wrong");
    });
  return { pending, run };
}

/** Inline-editable name: saves on blur / Enter if changed. */
function NameField({ value, onSave, className }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value);
  const commit = () => {
    if (v.trim() && v.trim() !== value) onSave(v.trim());
    else setV(value);
  };
  return (
    <Input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())}
      className={className}
    />
  );
}

export function DepartmentsSetup({ departments, subTeams }: { departments: Department[]; subTeams: SubTeam[] }) {
  const { pending, run } = useRunner();
  const [newDept, setNewDept] = useState("");

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {departments.map((d, i) => (
          <DepartmentCard
            key={d.id}
            dept={d}
            subTeams={subTeams.filter((s) => s.department_id === d.id)}
            first={i === 0}
            last={i === departments.length - 1}
          />
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createDepartment(newDept), "Department added", () => setNewDept(""));
        }}
      >
        <Input value={newDept} onChange={(e) => setNewDept(e.target.value)} placeholder="New department name" className="max-w-xs" />
        <Button type="submit" disabled={pending || !newDept.trim()}>
          <Plus className="h-4 w-4" /> Add department
        </Button>
      </form>
    </div>
  );
}

function DepartmentCard({ dept, subTeams, first, last }: { dept: Department; subTeams: SubTeam[]; first: boolean; last: boolean }) {
  const { pending, run } = useRunner();
  const [newSub, setNewSub] = useState("");

  return (
    <li className={`space-y-4 rounded-lg border p-4 ${dept.archived ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <NameField value={dept.name} onSave={(v) => run(() => renameDepartment(dept.id, v), "Renamed")} className="h-9 max-w-xs font-medium" />
        <span className="text-xs text-muted-foreground">/{dept.slug}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Move up" disabled={first || pending} onClick={() => run(() => moveDepartment(dept.id, -1))}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Move down" disabled={last || pending} onClick={() => run(() => moveDepartment(dept.id, 1))}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => setDepartmentArchived(dept.id, !dept.archived), dept.archived ? "Restored" : "Archived")}
          >
            {dept.archived ? "Restore" : "Archive"}
          </Button>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Weekly meeting</p>
        <ScheduleEditor departmentId={dept.id} weekday={dept.meeting_weekday} time={dept.meeting_time} canEdit />
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Sub-teams</p>
        <ul className="flex flex-wrap gap-2">
          {subTeams.map((s) => (
            <li key={s.id} className={`flex items-center gap-1 ${s.archived ? "opacity-50" : ""}`}>
              <NameField value={s.name} onSave={(v) => run(() => renameSubTeam(s.id, v), "Renamed")} className="h-8 w-36 text-sm" />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground"
                disabled={pending}
                onClick={() => run(() => setSubTeamArchived(s.id, !s.archived), s.archived ? "Restored" : "Archived")}
              >
                {s.archived ? "Restore" : "Archive"}
              </Button>
            </li>
          ))}
          <li>
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => createSubTeam(dept.id, newSub), "Sub-team added", () => setNewSub(""));
              }}
            >
              <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Add sub-team" className="h-8 w-36 text-sm" />
              <Button type="submit" size="sm" variant="outline" className="h-8" disabled={pending || !newSub.trim()}>
                Add
              </Button>
            </form>
          </li>
        </ul>
      </div>
    </li>
  );
}
