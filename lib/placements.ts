import { addDaysISO, formatDate } from "@/lib/time";

/**
 * Homepage placements: which brand is in which slot on highfy.pk, and who
 * has to do what next. Pure helpers, shared by the page, the actions and the
 * daily reminder. Dates are yyyy-MM-dd in Pakistan time.
 */

export type PlacementRole = "commercial" | "design" | "tech";
export const ROLE_LABELS: Record<PlacementRole, string> = { commercial: "Commercial", design: "Design", tech: "Tech" };

export type SectionKind = "banner" | "text" | "icons" | "carousel" | "tiles" | "badge";

export type Section = {
  key: string;
  name: string;
  kind: SectionKind;
  slots: number;
  labels: string[];
  size_hint: string | null;
  sort: number;
};

export type Stage = "booked" | "ready" | "live" | "ended";

export type Placement = {
  id: string;
  section_key: string;
  position: number;
  brand: string;
  starts_on: string;
  ends_on: string | null;
  comms: string | null;
  products: string | null;
  notes: string | null;
  inspo_paths: string[];
  artwork_path: string | null;
  stage: Stage;
  changed_from: { comms?: string | null; products?: string | null } | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export const PLACEMENT_COLUMNS =
  "id, section_key, position, brand, starts_on, ends_on, comms, products, notes, inspo_paths, artwork_path, stage, changed_from, created_by, created_at, updated_at";

/** Bookings that end within this many days show as "ending soon". */
export const ENDING_DAYS = 3;

/** Category icons ask which products to show; every other slot asks for the banner text. */
export const usesProducts = (s: Pick<Section, "kind">) => s.kind === "icons";

export function slotLabel(s: Section, position: number): string {
  if (s.labels[position - 1]) return s.labels[position - 1];
  if (s.slots === 1) return s.name;
  return `${s.kind === "tiles" ? "Tile" : "Slide"} ${position}`;
}

/** "Hero carousel · slide 3", or just "Announcement bar". */
export function slotName(s: Section, position: number): string {
  if (s.slots === 1) return s.name;
  const label = slotLabel(s, position);
  return `${s.name} · ${s.labels[position - 1] ? label : label.toLowerCase()}`;
}

/** The booking showing in a slot on a given day. */
export function activeOn(all: Placement[], key: string, position: number, date: string): Placement | undefined {
  return all
    .filter(
      (p) =>
        p.section_key === key &&
        p.position === position &&
        p.stage !== "ended" &&
        p.starts_on <= date &&
        (p.ends_on === null || p.ends_on >= date),
    )
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0];
}

/** The next booking in the same slot after this one, if any. */
export function nextAfter(all: Placement[], p: Placement): Placement | undefined {
  return all
    .filter((x) => x.section_key === p.section_key && x.position === p.position && x.stage !== "ended" && x.starts_on > p.starts_on)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0];
}

export const needsDesign = (p: Placement) => p.stage === "booked" || (!!p.changed_from && p.stage !== "ended");

export type StatusKey = "late" | "booked" | "changed" | "ready" | "live" | "ending";

export function statusOf(p: Placement, today: string): StatusKey {
  if (p.changed_from && p.stage !== "ended") return "changed";
  if (p.stage === "booked") return p.starts_on <= today ? "late" : "booked";
  if (p.stage === "ready") return "ready";
  if (p.ends_on !== null && p.ends_on <= addDaysISO(today, ENDING_DAYS)) return "ending";
  return "live";
}

export function relativeDay(date: string, today: string): string {
  if (date === today) return "today";
  if (date === addDaysISO(today, 1)) return "tomorrow";
  if (date === addDaysISO(today, -1)) return "yesterday";
  return formatDate(date, "EEE d MMM");
}

export function statusText(k: StatusKey, p: Placement, today: string): string {
  switch (k) {
    case "late":
      return "Not designed";
    case "booked":
      return "To design";
    case "changed":
      return "Changed";
    case "ready":
      return "Ready for tech";
    case "live":
      return "Live";
    case "ending":
      return p.ends_on! < today ? "Past its end date" : `Ends ${relativeDay(p.ends_on!, today)}`;
  }
}

export function datesText(p: Pick<Placement, "starts_on" | "ends_on">, today: string): string {
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  if (p.ends_on === null) return p.starts_on < addDaysISO(today, -1) ? `Ongoing since ${formatDate(p.starts_on, "d MMM")}` : `${cap(relativeDay(p.starts_on, today))} onwards`;
  return `${cap(relativeDay(p.starts_on, today))} – ${relativeDay(p.ends_on, today)}`;
}

// ---------------------------------------------------------------------------
// What each team has to do
// ---------------------------------------------------------------------------

/** Live bookings ending in the next few days with nothing booked after them. */
export function endingSoon(all: Placement[], today: string): Placement[] {
  const limit = addDaysISO(today, ENDING_DAYS);
  return all
    .filter((p) => p.stage === "live" && p.ends_on !== null && p.ends_on >= today && p.ends_on <= limit && !nextAfter(all, p))
    .sort((a, b) => a.ends_on!.localeCompare(b.ends_on!));
}

export function toDesign(all: Placement[]): Placement[] {
  return all.filter(needsDesign).sort((a, b) => a.starts_on.localeCompare(b.starts_on));
}

export function toPutLive(all: Placement[]): Placement[] {
  return all.filter((p) => p.stage === "ready").sort((a, b) => a.starts_on.localeCompare(b.starts_on));
}

export function toTakeDown(all: Placement[], today: string): Placement[] {
  return all.filter((p) => p.stage === "live" && p.ends_on !== null && p.ends_on <= today).sort((a, b) => a.ends_on!.localeCompare(b.ends_on!));
}

/** Empty slots on a day, per section. */
export function emptySlots(sections: Section[], all: Placement[], date: string) {
  return sections
    .map((s) => ({
      section: s,
      positions: Array.from({ length: s.slots }, (_, i) => i + 1).filter((n) => !activeOn(all, s.key, n, date)),
    }))
    .filter((x) => x.positions.length > 0);
}
