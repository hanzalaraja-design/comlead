"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeSelect } from "@/components/time-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelect } from "@/components/multi-select";
import { RichTextEditor } from "@/components/rich-text-editor";
import { PRIORITIES, personName } from "@/lib/labels";
import type { Meeting, PersonRef, TaskPriority, TaskStatus } from "@/lib/types";
import { deleteMeeting, saveMeeting } from "@/app/(app)/meetings/actions";
import { StatusBadge } from "@/components/tasks/task-badges";
import { RichTextView } from "@/components/rich-text-view";
import { AiButton, DraftPanel } from "@/components/meetings/ai-assist";
import {
  createSuggestedTask,
  draftAgenda,
  suggestActionItems,
  tidyMinutes,
  type SuggestedItem,
  type TidyDraft,
} from "@/app/(app)/meetings/ai-actions";

export type ActionItemRow = {
  id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
};

type DraftItem = { key: string; title: string; owner_id: string | null; due_date: string | null; priority: TaskPriority };

const fieldClass = "h-9 field px-2 text-sm";

export function MeetingEditor({
  meeting,
  attendeeIds,
  actionItems,
  people,
  memberIds,
  canDelete,
  aiEnabled = false,
}: {
  meeting: Meeting;
  attendeeIds: string[];
  actionItems: ActionItemRow[];
  people: PersonRef[];
  /** Department members: suggested owners. */
  memberIds: string[];
  /** Only Leads and Admin may delete a meeting. */
  canDelete: boolean;
  /** Show the assistant (Claude API key set). Only editors see this editor at all. */
  aiEnabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState(meeting.title ?? "");
  const [date, setDate] = useState(meeting.meeting_date);
  const [time, setTime] = useState(meeting.meeting_time?.slice(0, 5) ?? "");
  const [attendees, setAttendees] = useState(attendeeIds);
  const [agenda, setAgenda] = useState(meeting.agenda ?? "");
  const [minutes, setMinutes] = useState(meeting.minutes ?? "");
  const [existing, setExisting] = useState(actionItems);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);

  // Assistant drafts: held here until the person accepts or discards them.
  const [aiBusy, setAiBusy] = useState<null | "tidy" | "suggest" | "agenda">(null);
  const [minutesKey, setMinutesKey] = useState(0);
  const [tidyDraft, setTidyDraft] = useState<TidyDraft | null>(null);
  const [agendaDraft, setAgendaDraft] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedItem[] | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  async function runTidy() {
    setAiBusy("tidy");
    const res = await tidyMinutes(meeting.id, minutes);
    setAiBusy(null);
    if (res.ok) setTidyDraft(res.data!);
    else toast.error(res.error);
  }

  function acceptTidy() {
    if (!tidyDraft) return;
    const before = minutes;
    setMinutes(tidyDraft.html);
    setMinutesKey((k) => k + 1);
    setTidyDraft(null);
    toast.success("Minutes replaced. Save to keep them.", {
      action: {
        label: "Undo",
        onClick: () => {
          setMinutes(before);
          setMinutesKey((k) => k + 1);
        },
      },
    });
  }

  async function runSuggest() {
    setAiBusy("suggest");
    const res = await suggestActionItems(meeting.id, minutes, [...existing, ...drafts].map((x) => x.title));
    setAiBusy(null);
    if (!res.ok) return toast.error(res.error);
    setSuggestions(res.data!);
    if (!res.data!.length) toast("No new action items found in these minutes.");
  }

  function editSuggestion(key: string, patch: Partial<SuggestedItem>) {
    setSuggestions((xs) => xs && xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  async function createFromSuggestion(item: SuggestedItem) {
    if (!item.title.trim()) return toast.error("Give the task a title first.");
    setCreating(item.key);
    const res = await createSuggestedTask(meeting.id, {
      title: item.title,
      owner_id: item.owner_id,
      due_date: item.due_date,
      priority: item.priority,
    });
    setCreating(null);
    if (!res.ok) return toast.error(res.error);
    setExisting((xs) => [...xs, res.data!]);
    setSuggestions((xs) => xs && xs.filter((x) => x.key !== item.key));
    toast.success("Task created.");
  }

  /** `auto`: the draft started by itself on open, so it stays quiet if there's nothing to say. */
  async function runAgenda(auto = false) {
    setAiBusy("agenda");
    const res = await draftAgenda(meeting.id);
    setAiBusy(null);
    if (res.ok) setAgendaDraft(res.data!);
    else if (!auto) toast.error(res.error);
  }

  // A fresh weekly meeting gets an agenda drafted as soon as it opens.
  const autoAgenda = useRef(false);
  useEffect(() => {
    if (autoAgenda.current || !aiEnabled || meeting.agenda || meeting.minutes) return;
    autoAgenda.current = true;
    void Promise.resolve().then(() => runAgenda(true));
    // Runs once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function save() {
    startTransition(async () => {
      const res = await saveMeeting(meeting.id, {
        title: title || null,
        meeting_date: date,
        meeting_time: time || null,
        attendees,
        agenda: agenda || null,
        minutes: minutes || null,
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
          <TimeSelect id="m-time" value={time} onChange={setTime} emptyLabel="No time" />
        </div>
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
        <div className="flex items-end justify-between gap-2">
          <Label htmlFor="m-agenda">Agenda</Label>
          {aiEnabled && (
            <AiButton onClick={() => runAgenda()} busy={aiBusy === "agenda"} disabled={aiBusy !== null}>
              {aiBusy === "agenda" ? "Drafting…" : "Draft agenda"}
            </AiButton>
          )}
        </div>
        {agendaDraft !== null && (
          <DraftPanel
            title="Agenda from last week's open items and overdue or blocked tasks"
            acceptLabel={agenda.trim() ? "Replace agenda" : "Use this agenda"}
            onAccept={() => {
              setAgenda(agendaDraft);
              setAgendaDraft(null);
            }}
            onDiscard={() => setAgendaDraft(null)}
          >
            <ol className="list-decimal space-y-0.5 pl-5 text-sm text-ink">
              {agendaDraft.split("\n").map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </DraftPanel>
        )}
        <Textarea id="m-agenda" value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={4} placeholder="One topic per line" />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-end justify-between gap-2">
          <Label>Minutes</Label>
          {aiEnabled && (
            <AiButton onClick={runTidy} busy={aiBusy === "tidy"} disabled={aiBusy !== null || !minutes}>
              {aiBusy === "tidy" ? "Tidying…" : "Tidy up"}
            </AiButton>
          )}
        </div>
        <RichTextEditor
          key={minutesKey}
          name="minutes"
          defaultValue={minutes}
          onChange={setMinutes}
          minHeight="12rem"
          placeholder="What was discussed…"
        />
        {tidyDraft && (
          <DraftPanel title="Tidied minutes" acceptLabel="Replace my notes" onAccept={acceptTidy} onDiscard={() => setTidyDraft(null)}>
            <div className="rounded-[12px] bg-white p-3">
              <RichTextView html={tidyDraft.html} className="text-sm" />
            </div>
          </DraftPanel>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-end justify-between gap-2">
          <Label>Action items</Label>
          {aiEnabled && (
            <AiButton onClick={runSuggest} busy={aiBusy === "suggest"} disabled={aiBusy !== null || !minutes}>
              {aiBusy === "suggest" ? "Reading minutes…" : "Suggest action items"}
            </AiButton>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Each action item becomes a task in this department when you save.</p>
        {suggestions && suggestions.length > 0 && (
          <DraftPanel title="Suggested action items" discardLabel="Dismiss all" onDiscard={() => setSuggestions(null)}>
            <ul className="space-y-2">
              {suggestions.map((item) => (
                <li key={item.key} className="space-y-2 rounded-[12px] border border-line bg-white p-2">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_9rem_7rem] sm:items-center">
                    <Input
                      aria-label="Suggested task"
                      value={item.title}
                      onChange={(e) => editSuggestion(item.key, { title: e.target.value })}
                    />
                    {ownerSelect(item.owner_id, (v) => editSuggestion(item.key, { owner_id: v }))}
                    <Input
                      type="date"
                      aria-label="Due date"
                      value={item.due_date ?? ""}
                      onChange={(e) => editSuggestion(item.key, { due_date: e.target.value || null })}
                    />
                    {prioritySelect(item.priority, (v) => editSuggestion(item.key, { priority: v }))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {item.reason && <p className="mr-auto text-xs text-ink-muted">{item.reason}</p>}
                    <Button
                      type="button"
                      size="sm"
                      className="ml-auto"
                      disabled={creating !== null}
                      onClick={() => createFromSuggestion(item)}
                    >
                      {creating === item.key ? "Creating…" : "Create task"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setSuggestions((xs) => xs && xs.filter((x) => x.key !== item.key))}
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </DraftPanel>
        )}
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

      <div className="sticky bottom-16 z-20 -mx-4 flex items-center gap-2 border-t bg-white/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-lg md:border md:px-3">
        <Button onClick={save} disabled={pending || !date} className="min-w-28">
          {pending ? "Saving…" : "Save minutes"}
        </Button>
        <Button variant="ghost" onClick={() => router.push(`/meetings/${meeting.id}`)}>
          Cancel
        </Button>
        {canDelete && (
        <Button
          variant="ghost"
          className="ml-auto text-danger hover:text-danger/80"
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
