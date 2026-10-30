/**
 * Creative requests: what Social, Ads, CRM and Partnerships ask Design for.
 * Pure helpers, shared by the Placements page, its actions and the daily email.
 */

export type Channel = "social" | "ads" | "crm" | "partnerships";
export const CHANNELS: { key: Channel; label: string }[] = [
  { key: "social", label: "Social" },
  { key: "ads", label: "Ads" },
  { key: "crm", label: "CRM" },
  { key: "partnerships", label: "Partnerships" },
];
export const CHANNEL_LABELS = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label])) as Record<Channel, string>;
export const isChannel = (v: unknown): v is Channel => CHANNELS.some((c) => c.key === v);

/** Tag colours, one per channel, plus the App / Website bookings Design also works on. */
export const CHANNEL_STYLES: Record<Channel | "web", string> = {
  web: "bg-brand-bg text-brand-primary",
  social: "bg-[#fbe7f0] text-[#b0306a]",
  ads: "bg-[#fdeedd] text-[#c25b00]",
  crm: "bg-info-soft text-info-ink",
  partnerships: "bg-[#e3f3f2] text-[#0f6e6e]",
};

export type RequestStatus = "requested" | "in_design" | "in_review" | "approved" | "live" | "cancelled";
export const STATUS_LABELS: Record<RequestStatus, string> = {
  requested: "Requested",
  in_design: "In design",
  in_review: "In review",
  approved: "Approved",
  live: "Live",
  cancelled: "Cancelled",
};
export const STATUS_STYLES: Record<RequestStatus, string> = {
  requested: "bg-subtle text-ink",
  in_design: "bg-info-soft text-info-ink",
  in_review: "bg-warning-soft text-warning-ink",
  approved: "bg-success-soft text-success-ink",
  live: "bg-success-soft text-success-ink",
  cancelled: "bg-subtle text-ink-muted",
};

export type CreativeRequest = {
  id: string;
  channel: Channel;
  title: string;
  formats: string | null;
  brief: string | null;
  project_id: string | null;
  needed_by: string | null;
  live_from: string | null;
  live_to: string | null;
  status: RequestStatus;
  change_note: string | null;
  ref_paths: string[];
  art_paths: string[];
  version: number;
  requested_by: string;
  designer_id: string | null;
  created_at: string;
  updated_at: string;
  live_at: string | null;
};

export const CREATIVE_COLUMNS =
  "id, channel, title, formats, brief, project_id, needed_by, live_from, live_to, status, change_note, ref_paths, art_paths, version, requested_by, designer_id, created_at, updated_at, live_at";

export const isOpen = (r: Pick<CreativeRequest, "status">) => r.status !== "live" && r.status !== "cancelled";

/** Soonest needed first; no date last. */
export const byNeeded = (a: CreativeRequest, b: CreativeRequest) =>
  (a.needed_by ?? "9999").localeCompare(b.needed_by ?? "9999") || a.created_at.localeCompare(b.created_at);

/**
 * A designer's day, in the order they should look at it: what's late or due
 * today, what was sent back, what's coming up, and what's waiting on someone else.
 */
export function designerGroups(requests: CreativeRequest[], designerId: string, today: string) {
  const mine = requests.filter((r) => r.designer_id === designerId && isOpen(r)).sort(byNeeded);
  const working = mine.filter((r) => r.status === "in_design" || r.status === "requested");
  return {
    changes: working.filter((r) => !!r.change_note),
    due: working.filter((r) => !r.change_note && !!r.needed_by && r.needed_by <= today),
    upcoming: working.filter((r) => !r.change_note && (!r.needed_by || r.needed_by > today)),
    waiting: mine.filter((r) => r.status === "in_review" || r.status === "approved"),
  };
}

/** New requests nobody has taken yet. */
export const upForGrabs = (requests: CreativeRequest[]) => requests.filter((r) => r.status === "requested" && !r.designer_id).sort(byNeeded);
