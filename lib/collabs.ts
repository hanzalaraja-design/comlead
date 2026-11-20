/**
 * Paid social: Commercial asks Content for social content for a brand,
 * Content plans it from the media kit, Commercial approves, Content delivers
 * and reports. Shared by the pages, actions and forms.
 */

export const GOALS = ["Brand awareness", "Product awareness", "Product launch", "Offer or discount", "Engagement", "Other"] as const;

export const BUDGETS = ["Up to Rs 100,000", "Rs 100,000 – 250,000", "Rs 250,000 – 500,000", "Rs 500,000+"] as const;

export type CollabStatus = "requested" | "planned" | "changes" | "approved" | "live" | "reported";

export const STATUS_LABELS: Record<CollabStatus, string> = {
  requested: "Waiting for a plan",
  planned: "Plan sent: waiting for approval",
  changes: "Changes asked",
  approved: "In production",
  live: "All live: report due",
  reported: "Report shared",
};

export const STATUS_STYLES: Record<CollabStatus, string> = {
  requested: "bg-subtle text-ink",
  planned: "bg-warning-soft text-warning-ink",
  changes: "bg-danger-soft text-danger-ink",
  approved: "bg-info-soft text-info-ink",
  live: "bg-info-soft text-info-ink",
  reported: "bg-success-soft text-success-ink",
};

/** Board columns, left to right. */
export const COLUMNS: { key: string; title: string; statuses: CollabStatus[] }[] = [
  { key: "new", title: "New request", statuses: ["requested", "changes"] },
  { key: "planned", title: "Plan sent", statuses: ["planned"] },
  { key: "production", title: "In production", statuses: ["approved"] },
  { key: "live", title: "Live: report due", statuses: ["live"] },
  { key: "reported", title: "Report shared", statuses: ["reported"] },
];

export type CollabRequest = {
  id: string;
  brand: string;
  promote: string;
  goals: string[];
  go_live: string;
  budget: string;
  audience: string;
  key_message: string;
  link: string | null;
  refs: string | null;
  project_id: string | null;
  notes: string | null;
  status: CollabStatus;
  plan_note: string | null;
  change_note: string | null;
  total: number;
  total_max: number;
  report_summary: string | null;
  report_images: string[];
  requested_by: string;
  planned_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  reported_at: string | null;
  created_at: string;
  updated_at: string;
};

export const REQUEST_COLUMNS =
  "id, brand, promote, goals, go_live, budget, audience, key_message, link, refs, project_id, notes, status, plan_note, change_note, total, total_max, report_summary, report_images, requested_by, planned_by, approved_by, approved_at, reported_at, created_at, updated_at";

export type CollabItem = {
  id: string;
  request_id: string;
  rate_id: string | null;
  name: string;
  qty: number;
  unit_price: number;
  unit_price_max: number | null;
  idea: string | null;
  owner_id: string | null;
  due_date: string | null;
  task_id: string | null;
  live_url: string | null;
  live_at: string | null;
  reach: number | null;
  views: number | null;
  is_addon: boolean;
  sort: number;
};

export type CollabRate = { id: string; grp: "feed" | "reels" | "influencer" | "addon"; name: string; note: string | null; price: number; price_max: number | null; sort: number };

export const RATE_GROUPS: { key: CollabRate["grp"]; title: string }[] = [
  { key: "feed", title: "Feed posts" },
  { key: "reels", title: "Reels" },
  { key: "influencer", title: "Influencer reels" },
  { key: "addon", title: "Add-ons" },
];

/** 30000 → "30,000". */
export const money = (n: number) => n.toLocaleString("en-US");

/** A price, or a range ("250,000–500,000"), or "No charge". */
export const priceText = (price: number, max?: number | null) =>
  price === 0 && !max ? "No charge" : max && max > price ? `${money(price)}–${money(max)}` : money(price);

export const totalText = (r: Pick<CollabRequest, "total" | "total_max">) =>
  `Rs ${r.total_max > r.total ? `${money(r.total)}–${money(r.total_max)}` : money(r.total)}`;

/** The terms, as shown on the Terms tab and linked from the request form. */
export const TERMS: { title: string; points: string[] }[] = [
  {
    title: "Timeline",
    points: [
      "Content needs 15–20 working days to plan and produce, counted from plan approval and receipt of everything needed.",
      "Everything goes live within 30 days of approval, as long as assets and approvals arrive on time.",
    ],
  },
  {
    title: "The brief",
    points: [
      "Every request starts with the brief in this tab, so Content knows the goal, the audience and the key message.",
      "Anything not in the brief has to be agreed in the comments before production starts.",
    ],
  },
  { title: "Daily deals", points: ["One static post a day, at no charge. Book the slot in advance."] },
  {
    title: "Changes and assets",
    points: [
      "Brand assets and product details must arrive on time to avoid delays.",
      "Changing the plan after approval can move the dates.",
    ],
  },
  { title: "Report", points: ["When everything is live, Content shares a report with the links and results for each piece."] },
  {
    title: "Scope",
    points: [
      "Work outside the approved plan is agreed and costed separately.",
      "Dates may move if approvals or information are late, or for reasons outside our control.",
    ],
  },
];
