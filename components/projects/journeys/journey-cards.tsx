"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { createPart, reorderParts } from "@/app/(app)/projects/parts-actions";
import { JOURNEY_STAGES } from "@/components/projects/journeys/stages";

export type JourneyCard = { id: string; name: string; stage: string; who: string };

/**
 * The journeys of a project, in order. Drag a card onto another to move it
 * (the numbers follow); no buttons for it, it's just to keep them in order.
 */
export function JourneyCards({ projectId, journeys, selectedId, base, canEdit }: { projectId: string; journeys: JourneyCard[]; selectedId: string | null; base: string; canEdit: boolean }) {
  const router = useRouter();
  const [order, setOrder] = useState(journeys.map((j) => j.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Keep up with journeys added or removed elsewhere.
  const ids = journeys.map((j) => j.id);
  const shown = [...order.filter((id) => ids.includes(id)), ...ids.filter((id) => !order.includes(id))];
  const byId = new Map(journeys.map((j) => [j.id, j]));

  const drop = (target: string) => {
    if (!dragging || dragging === target) return;
    const next = shown.filter((id) => id !== dragging);
    next.splice(next.indexOf(target), 0, dragging);
    setOrder(next);
    setDragging(null);
    start(async () => {
      const res = await reorderParts(next);
      if (!res.ok) toast.error(res.error);
      router.refresh();
    });
  };

  const add = () =>
    start(async () => {
      const res = await createPart(projectId, "journey", {
        name: `Journey ${journeys.length + 1}`,
        stage: "idea",
        fields: [
          { label: "Who enters", value: "" },
          { label: "Goal", value: "" },
          { label: "Leaves when", value: "" },
          { label: "Offer", value: "" },
        ],
      });
      if (!res.ok) return void toast.error(res.error);
      router.push(`${base}?journey=${res.data!.id}&edit=1`);
      router.refresh();
    });

  return (
    <div className="mb-4 space-y-2">
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map((id, i) => {
          const j = byId.get(id)!;
          const st = JOURNEY_STAGES.find((s) => s.key === j.stage) ?? JOURNEY_STAGES[0];
          return (
            <li
              key={id}
              draggable={canEdit}
              onDragStart={() => setDragging(id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(id)}
              onDragEnd={() => setDragging(null)}
              className={cn(dragging === id && "opacity-50")}
            >
              <Link
                href={`${base}?journey=${id}`}
                aria-current={id === selectedId ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col gap-1 rounded-[14px] border-2 bg-white px-3.5 py-3",
                  id === selectedId ? "border-brand-primary bg-brand-bg/40" : "border-line hover:border-ink-muted/40",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                    {canEdit && <GripVertical aria-hidden className="h-3.5 w-3.5 cursor-grab text-ink-muted/50" />}
                    Journey {i + 1}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.chip)}>{st.label}</span>
                </span>
                <span className="text-[16px] font-semibold text-ink">{j.name}</span>
                {j.who && <span className="text-[13px] leading-snug text-ink-muted">{j.who}</span>}
              </Link>
            </li>
          );
        })}
        {canEdit && (
          <li>
            <button
              type="button"
              disabled={pending}
              onClick={add}
              className="flex h-full min-h-[92px] w-full items-center justify-center gap-1.5 rounded-[14px] border-2 border-dashed border-line text-sm font-semibold text-brand-primary hover:border-brand-primary"
            >
              <Plus className="h-4 w-4" /> New journey
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
