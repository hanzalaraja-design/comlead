"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Department } from "@/lib/types";
import {
  createDepartment,
  moveDepartment,
  renameDepartment,
  setDepartmentArchived,
  setDepartmentKind,
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

export function DepartmentsSetup({ departments }: { departments: Department[] }) {
  const { pending, run } = useRunner();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"department" | "project">("department");

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {departments.map((d, i) => (
          <DepartmentRow key={d.id} dept={d} first={i === 0} last={i === departments.length - 1} />
        ))}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createDepartment(name, kind), kind === "project" ? "Project team added" : "Department added", () => setName(""));
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="max-w-xs" />
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="h-9 field px-2 text-sm">
          <option value="department">Department</option>
          <option value="project">Project team</option>
        </select>
        <Button type="submit" disabled={pending || !name.trim()}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>
    </div>
  );
}

function DepartmentRow({ dept, first, last }: { dept: Department; first: boolean; last: boolean }) {
  const { pending, run } = useRunner();
  return (
    <li className={`flex flex-wrap items-center gap-2 surface p-3 ${dept.archived ? "opacity-60" : ""}`}>
      <NameField value={dept.name} onSave={(v) => run(() => renameDepartment(dept.id, v), "Renamed")} className="h-9 max-w-xs font-medium" />
      <select
        aria-label={`${dept.name} kind`}
        value={dept.kind}
        disabled={pending}
        onChange={(e) => run(() => setDepartmentKind(dept.id, e.target.value as Department["kind"]), "Updated")}
        className="h-9 field px-2 text-sm"
      >
        <option value="department">Department</option>
        <option value="project">Project team</option>
      </select>
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
    </li>
  );
}
