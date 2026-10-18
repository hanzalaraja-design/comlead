"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelect } from "@/components/multi-select";
import { personName } from "@/lib/labels";
import { FREQUENCIES, describeSeries, type Frequency } from "@/lib/series";
import { cn } from "@/lib/utils";
import type { PersonRef } from "@/lib/types";
import { cancelSeries, saveSeries } from "@/app/(app)/meetings/series-actions";

export type SeriesFormValues = {
  title: string;
  department_id: string;
  kind: "internal" | "external";
  frequency: Frequency;
  start_date: string;
  meeting_time: string;
  duration_minutes: number;
  department_ids: string[];
  user_ids: string[];
  external_emails: string[];
};

const DURATIONS = [15, 30, 45, 60, 90, 120];

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
            value === o.value ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:bg-subtle",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SeriesForm({
  id,
  initial,
  departments,
  people,
  canCancel,
}: {
  id: string | null;
  initial: SeriesFormValues;
  /** Departments the person can set meetings up in. */
  departments: { id: string; name: string; invitable: boolean; mine: boolean }[];
  people: PersonRef[];
  canCancel: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState(initial);
  const [emails, setEmails] = useState(initial.external_emails.join("\n"));
  const set = <K extends keyof SeriesFormValues>(k: K, value: SeriesFormValues[K]) => setV((x) => ({ ...x, [k]: value }));
  const homeOptions = departments.filter((d) => d.mine);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const external_emails = emails
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    startTransition(async () => {
      const res = await saveSeries(id, { ...v, external_emails });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(id ? "Meeting updated. Outlook will follow." : "Meeting set up. Invites are on their way.");
      router.push("/meetings");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="card-outlined space-y-6 p-4 md:p-6">
      <div className="space-y-1.5">
        <Label htmlFor="s-title">Name</Label>
        <Input id="s-title" value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="Marketing weekly" className="h-10" required />
      </div>

      <div className="space-y-2">
        <Label>How often</Label>
        <Segmented label="How often" value={v.frequency} onChange={(f) => set("frequency", f)} options={FREQUENCIES} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="s-date">{v.frequency === "once" ? "Date" : "First meeting"}</Label>
          <Input id="s-date" type="date" required value={v.start_date} onChange={(e) => set("start_date", e.target.value)} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-time">Time</Label>
          <Input id="s-time" type="time" required value={v.meeting_time} onChange={(e) => set("meeting_time", e.target.value)} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-duration">Length</Label>
          <select
            id="s-duration"
            value={v.duration_minutes}
            onChange={(e) => set("duration_minutes", Number(e.target.value))}
            className="h-10 w-full field px-3"
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d < 60 ? `${d} min` : `${d / 60} hour${d > 60 ? "s" : ""}`}
              </option>
            ))}
          </select>
        </div>
      </div>
      {v.start_date && v.meeting_time && (
        <p className="-mt-3 text-sm text-ink-muted">{describeSeries({ frequency: v.frequency, start_date: v.start_date, meeting_time: v.meeting_time })}</p>
      )}

      <div className="space-y-2">
        <Label>Type</Label>
        <Segmented
          label="Type"
          value={v.kind}
          onChange={(k) => set("kind", k)}
          options={[
            { value: "internal", label: "Internal", icon: <Building2 className="h-4 w-4" /> },
            { value: "external", label: "External", icon: <Globe2 className="h-4 w-4" /> },
          ]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="s-home">Department</Label>
          <select id="s-home" value={v.department_id} onChange={(e) => set("department_id", e.target.value)} className="h-10 w-full field px-3">
            {homeOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-muted">Its people can see the minutes and manage the meeting.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Invite departments</Label>
          <MultiSelect
            label="Departments"
            className="h-10 w-full justify-between rounded-[12px]"
            options={departments.filter((d) => d.invitable).map((d) => ({ value: d.id, label: d.name }))}
            value={v.department_ids}
            onChange={(ids) => set("department_ids", ids)}
          />
          <p className="text-xs text-ink-muted">Everyone in these departments gets the invite.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Invite people</Label>
        <MultiSelect
          label="People"
          className="h-10 w-full justify-between rounded-[12px]"
          options={people.map((p) => ({ value: p.id, label: personName(p), hint: p.email }))}
          value={v.user_ids}
          onChange={(ids) => set("user_ids", ids)}
          searchable
        />
      </div>

      {v.kind === "external" && (
        <div className="space-y-1.5">
          <Label htmlFor="s-emails">Guests from outside Highfy</Label>
          <Textarea
            id="s-emails"
            rows={3}
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder={"ali@client.com\nsara@agency.pk"}
          />
          <p className="text-xs text-ink-muted">One email per line. They get the Outlook invite but no access to Highfy Tasks.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button type="submit" disabled={pending} className="min-w-32">
          {pending ? "Saving…" : id ? "Save changes" : "Set up meeting"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Back
        </Button>
        {id && canCancel && (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto text-danger hover:text-danger/80"
            disabled={pending}
            onClick={() => {
              if (!confirm("Cancel this meeting? Everyone invited gets a cancellation. Past minutes stay.")) return;
              startTransition(async () => {
                const res = await cancelSeries(id);
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("Meeting cancelled.");
                router.push("/meetings");
                router.refresh();
              });
            }}
          >
            Cancel meeting
          </Button>
        )}
      </div>
    </form>
  );
}
