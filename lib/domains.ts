import type { ProjectKind } from "@/lib/types";

/** Projects, campaigns and partnerships: safe to use in the browser. */

export const KIND_LABELS = { project: "Project", campaign: "Campaign", partnership: "Partnership" } as const;

/** The three domains: where each lives and what it's for. */
export const DOMAINS: Record<ProjectKind, { label: string; plural: string; path: string; blurb: string }> = {
  project: { label: "Project", plural: "Projects", path: "/projects", blurb: "One-off projects, run within a team or by one person." },
  campaign: { label: "Campaign", plural: "Campaigns", path: "/campaigns", blurb: "Tasks and deliverables for the campaigns are tracked here." },
  partnership: {
    label: "Partnership",
    plural: "Partnerships",
    path: "/partnerships",
    blurb: "Everything we do with one partner brand: deals, campaigns, meetings and tasks.",
  },
};

// Stored as beauty / non_beauty; everything that isn't a beauty brand is a strategic partnership.
export const CATEGORY_LABELS = { beauty: "Beauty partnership", non_beauty: "Strategic partnership" } as const;

export const isProjectKind = (v: unknown): v is ProjectKind => v === "project" || v === "campaign" || v === "partnership";

/** Where a project, campaign or partnership lives. */
export const domainHref = (p: { kind: ProjectKind; slug: string }) => `${DOMAINS[p.kind].path}/${p.slug}`;
