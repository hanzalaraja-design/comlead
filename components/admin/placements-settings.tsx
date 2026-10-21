"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS, type PlacementRole, type Section } from "@/lib/placements";
import { saveSection, saveTeams, sendTestEmail } from "@/app/(app)/admin/placements/actions";

const ROLE_HINT: Record<PlacementRole, string> = {
  commercial: "Books brands into slots and gets reminders when bookings are ending.",
  design: "Gets told when a banner needs making or changing.",
  tech: "Gets told when a banner is ready to go live or needs taking down.",
};

export function PlacementTeams({
  departments,
  initial,
}: {
  departments: { id: string; name: string }[];
  initial: Record<PlacementRole, string | null>;
}) {
  const [teams, setTeams] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <form
      className="surface space-y-4 p-4 md:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveTeams(teams);
          if (res.ok) toast.success("Teams saved.");
          else toast.error(res.error);
        });
      }}
    >
      {(["commercial", "design", "tech"] as const).map((r) => (
        <div key={r} className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
          <Label htmlFor={`team-${r}`}>{ROLE_LABELS[r]}</Label>
          <div className="space-y-1">
            <select
              id={`team-${r}`}
              value={teams[r] ?? ""}
              onChange={(e) => setTeams((t) => ({ ...t, [r]: e.target.value || null }))}
              className="h-10 w-full field px-3"
            >
              <option value="">Not set</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-ink-muted">{ROLE_HINT[r]}</p>
          </div>
        </div>
      ))}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save teams"}
      </Button>
    </form>
  );
}

export function SectionRow({ section }: { section: Section }) {
  const [name, setName] = useState(section.name);
  const [slots, setSlots] = useState(String(section.slots));
  const [labels, setLabels] = useState(section.labels.join(", "));
  const [size, setSize] = useState(section.size_hint ?? "");
  const [pending, start] = useTransition();
  const dirty =
    name !== section.name || slots !== String(section.slots) || labels !== section.labels.join(", ") || size !== (section.size_hint ?? "");
  return (
    <form
      className="grid gap-2 border-b border-line px-4 py-3 last:border-0 sm:grid-cols-[1.4fr_70px_1.4fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveSection(section.key, {
            name,
            slots: Number(slots),
            labels: section.kind === "icons" ? labels.split(",").map((x) => x.trim()) : section.labels,
            size_hint: size,
          });
          if (res.ok) toast.success(`${name} saved.`);
          else toast.error(res.error);
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`n-${section.key}`} className="text-xs text-ink-muted">
          Section
        </Label>
        <Input id={`n-${section.key}`} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`s-${section.key}`} className="text-xs text-ink-muted">
          Slots
        </Label>
        <Input id={`s-${section.key}`} type="number" min={1} max={30} value={slots} onChange={(e) => setSlots(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`l-${section.key}`} className="text-xs text-ink-muted">
          {section.kind === "icons" ? "Category names (comma separated)" : "Slot names"}
        </Label>
        <Input
          id={`l-${section.key}`}
          value={section.kind === "icons" ? labels : "Numbered"}
          onChange={(e) => setLabels(e.target.value)}
          disabled={section.kind !== "icons"}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`z-${section.key}`} className="text-xs text-ink-muted">
          Banner size
        </Label>
        <Input id={`z-${section.key}`} value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 1440×400" />
      </div>
      <Button type="submit" variant={dirty ? "default" : "outline"} disabled={pending || !dirty}>
        Save
      </Button>
    </form>
  );
}

export function TestEmailButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await sendTestEmail();
          if (res.ok) toast.success("Sent. Check your inbox.");
          else toast.error(res.error, { duration: 12000 });
        })
      }
    >
      <Mail className="h-4 w-4" /> {pending ? "Sending…" : "Send me a test email"}
    </Button>
  );
}
