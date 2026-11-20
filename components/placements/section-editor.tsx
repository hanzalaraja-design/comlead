"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, EyeOff, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SECTION_KINDS, type Section, type SectionKind, type Surface } from "@/lib/placements";
import { addSection } from "@/app/(app)/placements/actions";

const SHOWS: { key: string; label: string; value: Surface[] }[] = [
  { key: "both", label: "Website + App", value: ["web", "app"] },
  { key: "web", label: "Website", value: ["web"] },
  { key: "app", label: "App", value: ["app"] },
];

/** A section's header in edit mode: drag handle, name, up and down, Hide. */
export function SectionEditBar({
  section,
  first,
  last,
  busy,
  onMove,
  onHide,
  onDragStart,
}: {
  section: Section;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
  onHide: () => void;
  onDragStart: () => void;
}) {
  const kind = SECTION_KINDS.find((k) => k.kind === section.kind);
  const btn = "inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-line bg-white text-ink hover:bg-subtle disabled:opacity-40";
  return (
    <div className="flex items-center gap-2 rounded-[12px] border border-line bg-white px-2 py-1.5">
      <span
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", section.key);
          onDragStart();
        }}
        title="Drag to move"
        aria-hidden="true"
        className="flex h-8 w-6 cursor-grab items-center justify-center text-ink-muted active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-ink">{section.name}</span>
        <span className="truncate text-xs text-ink-muted">
          {kind?.label ?? section.kind}
          {section.slots > 1 ? ` · ${section.slots} slots` : ""}
        </span>
      </span>
      <button type="button" className={btn} disabled={busy || first} onClick={() => onMove(-1)} aria-label={`Move ${section.name} up`}>
        <ArrowUp className="h-4 w-4" />
      </button>
      <button type="button" className={btn} disabled={busy || last} onClick={() => onMove(1)} aria-label={`Move ${section.name} down`}>
        <ArrowDown className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onHide}
        className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-line bg-white px-2.5 text-sm text-ink hover:bg-subtle disabled:opacity-40"
      >
        <EyeOff className="h-3.5 w-3.5" /> Hide
      </button>
    </div>
  );
}

/** Pick what the new section looks like, name it, and add it to the bottom. */
export function AddSectionForm({ onDone }: { onDone: (key: string | null) => void }) {
  const [kind, setKind] = useState<SectionKind>("banner");
  const [name, setName] = useState("");
  const [slots, setSlots] = useState(1);
  const [shows, setShows] = useState("both");
  const [size, setSize] = useState("");
  const [pending, start] = useTransition();
  const single = kind === "banner" || kind === "text" || kind === "badge";

  const save = () =>
    start(async () => {
      const res = await addSection({
        name,
        kind,
        slots: single ? 1 : slots,
        shows_on: SHOWS.find((s) => s.key === shows)!.value,
        size_hint: size,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${name.trim()} added at the bottom. Drag it where you want it.`);
      onDone(res.data?.key ?? null);
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">Pick what it looks like. It appears on the homepage map and in bookings straight away.</p>
      <div role="radiogroup" aria-label="What it looks like" className="grid grid-cols-2 gap-2">
        {SECTION_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="radio"
            aria-checked={kind === k.kind}
            onClick={() => {
              setKind(k.kind);
              setSlots(k.slots);
            }}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-[12px] border px-3 py-2.5 text-left",
              kind === k.kind ? "border-brand-primary bg-brand-bg" : "border-line bg-white hover:bg-subtle",
            )}
          >
            <span className="text-sm font-semibold text-ink">{k.label}</span>
            <span className="text-xs text-ink-muted">{k.hint}</span>
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Name
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Glow Rewards" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        {!single && (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Slots
            <Input type="number" min={1} max={30} value={slots} onChange={(e) => setSlots(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          Shows on
          <select value={shows} onChange={(e) => setShows(e.target.value)} className="h-10 rounded-[10px] border border-line bg-white px-2.5 text-sm">
            {SHOWS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Size note for Design (optional)
        <Input value={size} onChange={(e) => setSize(e.target.value)} maxLength={80} placeholder="e.g. 1200 x 400" />
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onDone(null)} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending || !name.trim()}>
          {pending ? "Adding…" : "Add to the bottom"}
        </Button>
      </div>
    </div>
  );
}
