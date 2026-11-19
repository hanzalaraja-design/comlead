"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { RATE_GROUPS, priceText, type CollabRate } from "@/lib/collabs";
import { saveCollabRate } from "@/app/(app)/collabs/actions";
import { cn } from "@/lib/utils";

function RateRow({ rate, editable }: { rate: CollabRate; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(String(rate.price));
  const [max, setMax] = useState(rate.price_max ? String(rate.price_max) : "");
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const p = Number(price.replace(/[^\d]/g, ""));
      const m = max.trim() ? Number(max.replace(/[^\d]/g, "")) : null;
      const res = await saveCollabRate(rate.id, p, m);
      if (!res.ok) return void toast.error(res.error);
      setEditing(false);
    });
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line py-2 text-sm first:border-t-0">
      <span className="min-w-0">
        <span className="text-ink">{rate.name}</span>
        {rate.note && <span className="ml-1.5 text-xs text-ink-muted">· {rate.note}</span>}
      </span>
      {editing ? (
        <span className="flex items-center gap-1.5">
          <input value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price" className="h-8 w-24 rounded-[8px] border border-line px-2 text-right" />
          <span className="text-xs text-ink-muted">to</span>
          <input value={max} onChange={(e) => setMax(e.target.value)} placeholder="—" aria-label="Up to (for a range)" className="h-8 w-24 rounded-[8px] border border-line px-2 text-right" />
          <button type="button" disabled={pending} onClick={save} className="h-8 rounded-[8px] bg-brand-primary px-3 text-xs font-semibold text-white">
            Save
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <span className={cn("font-semibold", rate.price === 0 && !rate.price_max ? "text-success-ink" : "text-ink")}>{priceText(rate.price, rate.price_max)}</span>
          {editable && (
            <button type="button" aria-label={`Change the price of ${rate.name}`} onClick={() => setEditing(true)} className="rounded p-1 text-ink-muted hover:bg-subtle hover:text-ink">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** The media kit: tentative rates in PKR, grouped. Admin can change prices. */
export function RateCard({ rates, editable = false, compact = false }: { rates: CollabRate[]; editable?: boolean; compact?: boolean }) {
  return (
    <div className={cn("surface", compact ? "p-4" : "p-4 md:p-6")}>
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-base font-bold text-ink">Media kit</h2>
        <span className="text-xs text-ink-muted">Tentative rates, PKR{editable ? " · you can change them" : ""}</span>
      </div>
      {RATE_GROUPS.map((g) => {
        const list = rates.filter((r) => r.grp === g.key);
        if (!list.length) return null;
        return (
          <div key={g.key} className="mt-3">
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-brand-primary">{g.title}</h3>
            {list.map((r) => (
              <RateRow key={r.id} rate={r} editable={editable} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
