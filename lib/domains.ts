import type { PartnerCategory, ProjectKind } from "@/lib/types";

/** Projects, campaigns and partnerships: safe to use in the browser. */

export const KIND_LABELS = { project: "Project", campaign: "Campaign", partnership: "Brand partnership" } as const;

/** The three domains: where each lives and what it's for. */
export const DOMAINS: Record<ProjectKind, { label: string; plural: string; path: string; blurb: string }> = {
  project: { label: "Project", plural: "Projects", path: "/projects", blurb: "One-off projects, run within a team or by one person." },
  campaign: { label: "Campaign", plural: "Campaigns", path: "/campaigns", blurb: "Tasks and deliverables for the campaigns are tracked here." },
  partnership: {
    label: "Brand partnership",
    plural: "Brand partnerships",
    path: "/partnerships",
    blurb: "Everything we do with one partner brand: deals, campaigns, meetings and tasks.",
  },
};

/** Brand partnership categories, in the order they show. */
export const CATEGORIES: PartnerCategory[] = ["associations", "referral", "fintech"];
export const CATEGORY_LABELS: Record<PartnerCategory, string> = { associations: "Associations", referral: "Referral", fintech: "Fintech" };
export const isCategory = (v: unknown): v is PartnerCategory => CATEGORIES.includes(v as PartnerCategory);

export const isProjectKind = (v: unknown): v is ProjectKind => v === "project" || v === "campaign" || v === "partnership";

/** Where a project, campaign or partnership lives. */
export const domainHref = (p: { kind: ProjectKind; slug: string }) => `${DOMAINS[p.kind].path}/${p.slug}`;
