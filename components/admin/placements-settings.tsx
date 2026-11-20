"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS, type PlacementRole, type Section } from "@/lib/placements";
import { removeTabPerson, saveExtraTeams, saveSection, saveTabAccess, saveTeams } from "@/app/(app)/admin/placements/actions";
import { hideSection } from "@/app/(app)/placements/actions";

type TeamKey = PlacementRole | "content";
const TEAM_LABELS: Record<TeamKey, string> = { ...ROLE_LABELS, content: "Content" };
const ROLE_HINT: Record<TeamKey, string> = {
  content: "Plans, makes and reports on Paid social content.",
  commercial: "Books brands into slots and gets reminders when bookings are ending.",
  design: "Gets told when a banner needs making or changing.",
  tech: "Gets told when a banner is ready to go live or needs taking down.",
};

export function PlacementTeams({
  departments,
  initial,
}: {
  departments: { id: string; name: string }[];
  initial: Record<TeamKey, string | null>;
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
      {(["commercial", "design", "tech", "content"] as const).map((r) => (
        <div key={r} className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
          <Label htmlFor={`team-${r}`}>{TEAM_LABELS[r]}</Label>
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
          Section{section.archived ? " (hidden)" : ""}
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
      <div className="flex gap-2">
        <Button type="submit" variant={dirty ? "default" : "outline"} disabled={pending || !dirty}>
          Save
        </Button>
        {section.archived && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await hideSection(section.key, false);
                if (res.ok) toast.success(`${section.name} is back on the homepage.`);
                else toast.error(res.error);
              })
            }
          >
            Bring back
          </Button>
        )}
      </div>
    </form>
  );
}

export type TabAccess = {
  key: string;
  label: string;
  owner: string | null;
  teams: string[];
  people: { id: string; name: string }[];
};

/**
 * Who sees each Placements tab (Design, Tech and Admins see them all), whose
 * lead gives access when someone asks, and who was given access that way.
 */
export function TabAccessRow({ tab, departments }: { tab: TabAccess; departments: { id: string; name: string }[] }) {
  const [teams, setTeams] = useState(tab.teams);
  const [owner, setOwner] = useState(tab.owner);
  const [pending, start] = useTransition();
  const dirty = owner !== tab.owner || [...teams].sort().join() !== [...tab.teams].sort().join();
  return (
    <div className="space-y-3 border-b border-line px-4 py-4 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{tab.label}</h3>
        <Button
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const res = await saveTabAccess(tab.key, teams, owner);
              if (res.ok) toast.success(`${tab.label} saved.`);
              else toast.error(res.error);
            })
          }
        >
          Save
        </Button>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-xs text-ink-muted">Teams that see it</legend>
        <div className="flex flex-wrap gap-1.5">
          {departments.map((d) => {
            const on = teams.includes(d.id);
            return (
              <label
                key={d.id}
                className={
                  on
                    ? "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-brand-primary bg-brand-bg px-3 py-1 text-sm text-ink"
                    : "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-sm text-ink-muted"
                }
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() => setTeams((t) => (on ? t.filter((x) => x !== d.id) : [...t, d.id]))}
                />
                {d.name}
              </label>
            );
          })}
        </div>
      </fieldset>
      <label className="grid gap-1.5 text-xs text-ink-muted sm:grid-cols-[180px_1fr] sm:items-center">
        Whose lead gives access
        <select value={owner ?? ""} onChange={(e) => setOwner(e.target.value || null)} className="field h-9 px-3 text-sm text-ink">
          <option value="">Admins only</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {tab.people.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-ink-muted">Also given access</p>
          <div className="flex flex-wrap gap-1.5">
            {tab.people.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-subtle py-1 pl-3 pr-1 text-sm text-ink">
                {p.name}
                <button
                  type="button"
                  aria-label={`Remove ${p.name} from ${tab.label}`}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await removeTabPerson(tab.key, p.id);
                      if (res.ok) toast.success(`${p.name} removed.`);
                      else toast.error(res.error);
                    })
                  }
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-white"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Teams picked from chips, used for "also sees Paid social" and "also edits the layout". */
function TeamChips({ legend, departments, value, onChange }: { legend: string; departments: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {departments.map((d) => {
          const on = value.includes(d.id);
          return (
            <label
              key={d.id}
              className={
                on
                  ? "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-brand-primary bg-brand-bg px-3 py-1 text-sm text-ink"
                  : "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-sm text-ink-muted"
              }
            >
              <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== d.id) : [...value, d.id])} />
              {d.name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Teams besides Commercial and Content who see Paid social, and besides Commercial who edit the homepage layout. */
export function ExtraTeams({ departments, paidSocial, layout }: { departments: { id: string; name: string }[]; paidSocial: string[]; layout: string[] }) {
  const [ps, setPs] = useState(paidSocial);
  const [ly, setLy] = useState(layout);
  const [pending, start] = useTransition();
  const same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
  const dirty = !same(ps, paidSocial) || !same(ly, layout);
  return (
    <div className="surface space-y-4 p-4 md:p-5">
      <div className="space-y-1">
        <TeamChips legend="Also see Paid social" departments={departments} value={ps} onChange={setPs} />
        <p className="text-xs text-ink-muted">They can look and comment. Asking, planning, approving and delivering stay with Commercial and Content.</p>
      </div>
      <div className="space-y-1">
        <TeamChips legend="Also edit the homepage layout" departments={departments} value={ly} onChange={setLy} />
        <p className="text-xs text-ink-muted">Move, add and hide homepage sections, like Commercial.</p>
      </div>
      <div className="flex justify-end">
        <Button
          variant={dirty ? "default" : "outline"}
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const res = await saveExtraTeams(ps, ly);
              if (res.ok) toast.success("Saved.");
              else toast.error(res.error);
            })
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}
