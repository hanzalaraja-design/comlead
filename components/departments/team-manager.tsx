"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/person-avatar";
import { personName } from "@/lib/labels";
import { WEEKDAYS } from "@/lib/time";
import type { DeptRole, PersonRef } from "@/lib/types";
import { addMember, removeMember, setMeetingSchedule, setMemberRole } from "@/app/(app)/departments/actions";

type Member = { person: PersonRef; role: DeptRole };

export function TeamManager({
  departmentId,
  members,
  candidates,
  canManage,
  isAdmin,
}: {
  departmentId: string;
  members: Member[];
  candidates: PersonRef[];
  canManage: boolean;
  isAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (success) toast.success(success);
      } else toast.error(res.error ?? "Something went wrong");
    });

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line surface">
        {members.length === 0 && <li className="p-4 text-sm text-muted-foreground">No one yet.</li>}
        {members.map((m) => (
          <li key={m.person.id} className="flex items-center gap-3 px-3 py-2.5">
            <PersonAvatar person={m.person} className="h-8 w-8" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{personName(m.person)}</p>
              <p className="truncate text-xs text-muted-foreground">{m.person.email}</p>
            </div>
            {isAdmin ? (
              <select
                aria-label="Role"
                value={m.role}
                disabled={pending}
                onChange={(e) => run(() => setMemberRole(departmentId, m.person.id, e.target.value as DeptRole), "Role updated")}
                className="h-8 field px-2 text-xs"
              >
                <option value="member">Member</option>
                <option value="lead">Lead</option>
              </select>
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{m.role === "lead" ? "Lead" : "Member"}</span>
            )}
            {canManage && (isAdmin || m.role === "member") && (
              <button
                type="button"
                aria-label={`Remove ${personName(m.person)}`}
                disabled={pending}
                className="rounded p-1 text-muted-foreground hover:text-danger"
                onClick={() => {
                  if (confirm(`Remove ${personName(m.person)} from this department?`)) {
                    run(() => removeMember(departmentId, m.person.id), "Removed");
                  }
                }}
              >
                <UserMinus className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage && candidates.length > 0 && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!adding) return;
            run(async () => {
              const res = await addMember(departmentId, adding);
              if (res.ok) setAdding("");
              return res;
            }, "Added");
          }}
        >
          <select
            aria-label="Person to add"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            className="h-9 min-w-0 flex-1 field px-2 text-sm"
          >
            <option value="">Add a person…</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)} ({p.email})
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" disabled={!adding || pending}>
            Add
          </Button>
        </form>
      )}
    </div>
  );
}

const DURATIONS = [15, 30, 45, 60, 90, 120];

export function ScheduleEditor({
  departmentId,
  weekday,
  time,
  duration = 60,
  canEdit,
}: {
  departmentId: string;
  weekday: number | null;
  time: string | null;
  duration?: number;
  canEdit: boolean;
}) {
  const [day, setDay] = useState(weekday ? String(weekday) : "");
  const [t, setT] = useState(time?.slice(0, 5) ?? "");
  const [len, setLen] = useState(String(duration));
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const res = await setMeetingSchedule(departmentId, day ? Number(day) : null, t || null, Number(len));
          if (res.ok) toast.success("Schedule saved");
          else toast.error(res.error);
        });
      }}
    >
      <label className="space-y-1 text-xs">
        <span className="block text-muted-foreground">Day</span>
        <select
          value={day}
          disabled={!canEdit}
          onChange={(e) => setDay(e.target.value)}
          className="h-9 field px-2 text-sm"
        >
          <option value="">Not set</option>
          {WEEKDAYS.map((w, i) => (
            <option key={w} value={i + 1}>
              {w}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-xs">
        <span className="block text-muted-foreground">Time (PKT)</span>
        <input
          type="time"
          value={t}
          disabled={!canEdit}
          onChange={(e) => setT(e.target.value)}
          className="h-9 field px-2 text-sm"
        />
      </label>
      <label className="space-y-1 text-xs">
        <span className="block text-muted-foreground">Length</span>
        <select value={len} disabled={!canEdit} onChange={(e) => setLen(e.target.value)} className="field h-9">
          {[...new Set([...DURATIONS, duration])].sort((a, b) => a - b).map((d) => (
            <option key={d} value={d}>
              {d < 60 ? `${d} min` : `${d / 60} hr`}
            </option>
          ))}
        </select>
      </label>
      {canEdit && (
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
      )}
    </form>
  );
}
