"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelect } from "@/components/multi-select";
import { RichTextEditor } from "@/components/rich-text-editor";
import { PRIORITIES, personName } from "@/lib/labels";
import type { Meeting, PersonRef, SubTeam, TaskPriority, TaskStatus } from "@/lib/types";
import { deleteMeeting, saveMeeting } from "@/app/(app)/meetings/actions";
import { StatusBadge } from "@/components/tasks/task-badges";

export type ActionItemRow = {
  id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
};

type DraftItem = { key: string; title: string; owner_id: string | null; due_date: string | null; priority: TaskPriority };

const fieldClass = "h-9 rounded-md border bg-background px-2 text-sm";

export function MeetingEditor({
  meeting,
  attendeeIds,
  actionItems,
  people,
  memberIds,
  subTeams,
  canDelete,
}: {
  meeting: Meeting;
  attendeeIds: string[];
  actionItems: ActionItemRow[];
  people: PersonRef[];
  /** Department members: suggested owners. */
  memberIds: string[];
  subTeams: SubTeam[];
  /** Only Leads and Admin may delete a meeting. */
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState(meeting.title ?? "");
  const [date, setDate] = useState(meeting.meeting_date);
  const [time, setTime] = useState(meeting.meeting_time?.slice(0, 5) ?? "");
  const [subTeam, setSubTeam] = useState(meeting.sub_team_id ?? "");
  const [attendees, setAttendees] = useState(attendeeIds);
  const [agenda, setAgenda] = useState(meeting.agenda ?? "");
  const [minutes, setMinutes] = useState(meeting.minutes ?? "");
  const [decisions, setDecisions] = useState<string[]>(meeting.decisions);
  const [decisionDraft, setDecisionDraft] = useState("");
  const [existing, setExisting] = useState(actionItems);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);

  const owners = people.filter((p) => memberIds.includes(p.id) || attendees.includes(p.id));
  const ownerSelect = (value: string | null, onChange: (v: string | null) => void) => (
    <select aria-label="Owner" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={`${fieldClass} min-w-0`}>
      <option value="">Owner…</option>
      {owners.map((p) => (
        <option key={p.id} value={p.id}>
          {personName(p)}
        </option>
      ))}
    </select>
  );
  const prioritySelect = (value: TaskPriority, onChange: (v: TaskPriority) => void) => (
    <select aria-label="Priority" value={value} onChange={(e) => onChange(e.target.value as TaskPriority)} className={fieldClass}>
      {PRIORITIES.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </select>
  );

  function addDecision() {
    const d = decisionDraft.trim();
    if (!d) return;
    setDecisions((ds) => [...ds, d]);
    setDecisionDraft("");
  }

  function save() {
    const pendingDecision = decisionDraft.trim();
    startTransition(async () => {
      const res = await saveMeeting(meeting.id, {
        title: title || null,
        meeting_date: date,
        meeting_time: time || null,
        sub_team_id: subTeam || null,
        attendees,
        agenda: agenda || null,
        minutes: minutes || null,
        decisions: pendingDecision ? [...decisions, pendingDecision] : decisions,
        existingItems: existing.map(({ id, title, owner_id, due_date, priority }) => ({ id, title, owner_id, due_date, priority })),
        newItems: drafts
          .filter((d) => d.title.trim())
          .map(({ title, owner_id, due_date, priority }) => ({ title, owner_id, due_date, priority })),
      });
      if (res.ok) {
        toast.success(drafts.some((d) => d.title.trim()) ? "Saved. Action items added as tasks." : "Saved");
        router.push(`/meetings/${meeting.id}`);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="m-title">Title</Label>
          <Input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly meeting" className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-date">Date</Label>
          <Input id="m-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-time">Time</Label>
          <Input id="m-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-10" />
        </div>
        {subTeams.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="m-sub">Sub-team</Label>
            <select id="m-sub" value={subTeam} onChange={(e) => setSubTeam(e.target.value)} className={`${fieldClass} h-10 w-full`}>
              <option value="">Whole department</option>
              {subTeams.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Attendees</Label>
          <div>
            <MultiSelect
              label="Attendees"
              className="h-10 w-full justify-between rounded-md"
              options={people.map((p) => ({ value: p.id, label: personName(p), hint: p.email }))}
              value={attendees}
              onChange={setAttendees}
              searchable
            />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="m-agenda">Agenda</Label>
        <Textarea id="m-agenda" value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={4} placeholder="One topic per line" />
      </div>

      <div className="space-y-1.5">
        <Label>Minutes</Label>
        <RichTextEditor name="minutes" defaultValue={meeting.minutes} onChange={setMinutes} minHeight="12rem" placeholder="What was discussed…" />
      </div>

      <div className="space-y-2">
        <Label>Decisions</Label>
        <ul className="space-y-1">
          {decisions.map((d, i) => (
            <li key={i} className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
              <span className="flex-1">{d}</span>
              <button type="button" aria-label="Remove decision" onClick={() => setDecisions((ds) => ds.filter((_, j) => j !== i))}>
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            value={decisionDraft}
            onChange={(e) => setDecisionDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDecision();
              }
            }}
            placeholder="Add a decision"
          />
          <Button type="button" variant="outline" onClick={addDecision}>
            Add
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Action items</Label>
        <p className="text-xs text-muted-foreground">Each action item becomes a task in this department when you save.</p>
        <ul className="space-y-2">
          {existing.map((item) => (
            <li key={item.id} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_10rem_9rem_7rem_6rem] sm:items-center">
              <Input
                value={item.title}
                onChange={(e) => setExisting((xs) => xs.map((x) => (x.id === item.id ? { ...x, title: e.target.value } : x)))}
              />
              {ownerSelect(item.owner_id, (v) => setExisting((xs) => xs.map((x) => (x.id === item.id ? { ...x, owner_id: v } : x))))}
              <Input
                type="date"
                value={item.due_date ?? ""}
                onChange={(e) =>
                  setExisting((xs) => xs.map((x) => (x.id === item.id ? { ...x, due_date: e.target.value || null } : x)))
                }
              />
              {prioritySelect(item.priority, (v) => setExisting((xs) => xs.map((x) => (x.id === item.id ? { ...x, priority: v } : x))))}
              <StatusBadge status={item.status} className="justify-self-start" />
            </li>
          ))}
          {drafts.map((item) => (
            <li
              key={item.key}
              className="grid gap-2 rounded-md border border-dashed p-2 sm:grid-cols-[minmax(0,1fr)_10rem_9rem_7rem_6rem] sm:items-center"
            >
              <Input
                autoFocus
                value={item.title}
                placeholder="What needs to happen?"
                onChange={(e) => setDrafts((xs) => xs.map((x) => (x.key === item.key ? { ...x, title: e.target.value } : x)))}
              />
              {ownerSelect(item.owner_id, (v) => setDrafts((xs) => xs.map((x) => (x.key === item.key ? { ...x, owner_id: v } : x))))}
              <Input
                type="date"
                value={item.due_date ?? ""}
                onChange={(e) =>
                  setDrafts((xs) => xs.map((x) => (x.key === item.key ? { ...x, due_date: e.target.value || null } : x)))
                }
              />
              {prioritySelect(item.priority, (v) => setDrafts((xs) => xs.map((x) => (x.key === item.key ? { ...x, priority: v } : x))))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-self-start text-muted-foreground"
                onClick={() => setDrafts((xs) => xs.filter((x) => x.key !== item.key))}
              >
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setDrafts((xs) => [...xs, { key: crypto.randomUUID(), title: "", owner_id: null, due_date: null, priority: "medium" }])
          }
        >
          <Plus className="h-4 w-4" /> Add action item
        </Button>
      </div>

      <div className="sticky bottom-16 z-20 -mx-4 flex items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-lg md:border md:px-3">
        <Button onClick={save} disabled={pending || !date} className="min-w-28">
          {pending ? "Saving…" : "Save minutes"}
        </Button>
        <Button variant="ghost" onClick={() => router.push(`/meetings/${meeting.id}`)}>
          Cancel
        </Button>
        {canDelete && (
        <Button
          variant="ghost"
          className="ml-auto text-red-600 hover:text-red-700"
          disabled={pending}
          onClick={() => {
            if (!confirm("Delete this meeting? Its action items stay as tasks.")) return;
            startTransition(async () => {
              const res = await deleteMeeting(meeting.id);
              if (res.ok) router.push("/meetings");
              else toast.error(res.error);
            });
          }}
        >
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
        )}
      </div>
    </div>
  );
}
