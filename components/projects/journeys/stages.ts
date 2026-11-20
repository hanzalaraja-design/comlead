/** A journey's stages. The main work is building it; Mergn sits apart. */
export const JOURNEY_STAGES = [
  { key: "idea", label: "Idea", role: "build", chip: "bg-subtle text-ink" },
  { key: "drafting", label: "Drafting", role: "build", chip: "bg-info-soft text-info-ink" },
  { key: "design", label: "Design", role: "build", chip: "bg-info-soft text-info-ink" },
  { key: "review", label: "Review", role: "review", chip: "bg-warning-soft text-warning-ink" },
  { key: "approved", label: "Approved", role: "live", chip: "bg-brand-bg text-brand-primary" },
  { key: "live", label: "Live", role: "live", chip: "bg-success-soft text-success-ink" },
] as const;

/** The four building stages shown as steps. */
export const BUILD_STAGES = JOURNEY_STAGES.slice(0, 4);

export type JourneyRole = "build" | "review" | "live";
