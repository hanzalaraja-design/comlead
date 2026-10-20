import type { SectionKind, StatusKey } from "@/lib/placements";

/** Status chip colours, shared by the map, the lists and the details panel. */
export const STATUS_CHIP: Record<StatusKey | "empty", string> = {
  live: "bg-success-soft text-success-ink",
  ending: "bg-warning-soft text-warning-ink",
  ready: "bg-info-soft text-info-ink",
  booked: "bg-subtle text-ink",
  late: "bg-danger-soft text-danger-ink",
  changed: "bg-brand-bg text-brand-primary",
  empty: "bg-subtle text-ink-muted",
};

/** A slot's card on the map before there's a banner to show. */
export const STATUS_CARD: Record<StatusKey, string> = {
  live: "bg-success-soft text-success-ink",
  ending: "bg-warning-soft text-warning-ink",
  ready: "bg-info-soft text-info-ink",
  booked: "border-[1.5px] border-dashed border-ink-muted/50 bg-subtle text-ink",
  late: "border-[1.5px] border-dashed border-danger/60 bg-danger-soft text-danger-ink",
  changed: "border-[1.5px] border-dashed border-brand-primary/60 bg-brand-bg text-brand-primary",
};

export const WRAP: Record<SectionKind, string> = {
  banner: "flex flex-col gap-2",
  text: "flex flex-col gap-2",
  badge: "flex flex-col gap-2",
  carousel: "no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5",
  icons: "no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5",
  tiles: "grid grid-cols-3 gap-2",
};

export const SLOT: Record<SectionKind, string> = {
  banner: "h-[88px] w-full rounded-[12px]",
  text: "min-h-[42px] w-full rounded-[8px]",
  badge: "min-h-[44px] w-full rounded-[8px]",
  carousel: "h-[118px] w-[196px] shrink-0 rounded-[12px]",
  tiles: "h-[100px] rounded-[12px]",
  icons: "size-[76px] shrink-0 rounded-full",
};
