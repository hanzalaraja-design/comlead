"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RATE_GROUPS, money, priceText, type CollabItem, type CollabRate, type CollabWant } from "@/lib/collabs";
import { personName } from "@/lib/labels";
import { sendCollabPlan } from "@/app/(app)/collabs/actions";

type Person = { id: string; email: string; full_name: string | null };
type Row = { key: string; rate_id: string; qty: number; idea: string; owner_id: string; due_date: string };

/**
 * Content's plan: pieces from the media kit, with an optional idea, who does
 * it and by when. The cost adds itself up from the rates.
 */
export function PlanBuilder({
  requestId,
  rates,
  people,
  me,
  goLive,
  existing,
  requester,
  wanted = [],
}: {
  requestId: string;
  rates: CollabRate[];
  people: Person[];
  me: string;
  goLive: string;
  existing: CollabItem[];
  requester: string;
  /** What the asker picked from the media kit: the first plan starts from these. */
  wanted?: CollabWant[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => {
    const planned = existing
      .filter((i) => i.rate_id)
      .map((i) => ({ key: i.id, rate_id: i.rate_id!, qty: i.qty, idea: i.idea ?? "", owner_id: i.owner_id ?? me, due_date: i.due_date ?? goLive }));
    if (planned.length) return planned;
    // No plan yet: start from what was asked for (pieces still in the media kit).
    return wanted
      .filter((w) => rates.some((r) => r.id === w.rate_id))
      .map((w) => ({ key: crypto.randomUUID(), rate_id: w.rate_id, qty: w.qty, idea: "", owner_id: me, due_date: goLive }));
  });
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(rows.length === 0);
  const [pending, start] = useTransition();
  const rateOf = useMemo(() => new Map(rates.map((r) => [r.id, r])), [rates]);
  const total = rows.reduce((n, r) => n + (rateOf.get(r.rate_id)?.price ?? 0) * r.qty, 0);
  const totalMax = rows.reduce((n, r) => n + ((rateOf.get(r.rate_id)?.price_max ?? rateOf.get(r.rate_id)?.price) ?? 0) * r.qty, 0);
  const edit = (key: string, patch: Partial<Row>) => setRows((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const add = (rate: CollabRate) => {
    setRows((xs) => [...xs, { key: crypto.randomUUID(), rate_id: rate.id, qty: 1, idea: "", owner_id: me, due_date: goLive }]);
    setAdding(false);
  };

  return (
    <div className="surface space-y-4 p-4 md:p-5">
      <div>
        <h2 className="text-base font-bold text-ink">Your plan</h2>
        <p className="text-[13px] text-ink-muted">Pick pieces from the media kit. The idea is optional; who and when start as you and the go-live date.</p>
      </div>

      {rows.length > 0 && (
        <div className="space-y-2.5">
          {rows.map((r) => {
            const rate = rateOf.get(r.rate_id);
            if (!rate) return null;
            return (
              <div key={r.key} className="rounded-[12px] border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{rate.name}</p>
                    <p className="text-xs text-ink-muted">{priceText(rate.price, rate.price_max)} each</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                      Qty
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        value={r.qty}
                        onChange={(e) => edit(r.key, { qty: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
                        className="h-8 w-16 text-center"
                      />
                    </label>
                    <span className="w-24 text-right text-sm font-semibold text-ink">{priceText(rate.price * r.qty, rate.price_max ? rate.price_max * r.qty : null)}</span>
                    <button type="button" aria-label={`Remove ${rate.name}`} onClick={() => setRows((xs) => xs.filter((x) => x.key !== r.key))} className="rounded p-1 text-ink-muted hover:bg-subtle hover:text-danger">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_9.5rem]">
                  <Input value={r.idea} onChange={(e) => edit(r.key, { idea: e.target.value })} maxLength={500} placeholder="Idea (optional), e.g. 7-day glass skin diary" aria-label="Idea" />
                  <select value={r.owner_id} onChange={(e) => edit(r.key, { owner_id: e.target.value })} aria-label="Who does it" className="field h-10 px-2 text-sm">
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {personName(p)}
                      </option>
                    ))}
                  </select>
                  <Input type="date" value={r.due_date} onChange={(e) => edit(r.key, { due_date: e.target.value })} aria-label="By when" />
                </div>
              </div>
            );
          })}
          <div className="flex justify-between rounded-[12px] bg-brand-bg/60 px-4 py-2.5 font-bold text-ink">
            <span>Total</span>
            <span>Rs {totalMax > total ? `${money(total)}–${money(totalMax)}` : money(total)}</span>
          </div>
        </div>
      )}

      {adding ? (
        <div className="rounded-[12px] border border-line">
          {RATE_GROUPS.map((g) => {
            const list = rates.filter((r) => r.grp === g.key);
            if (!list.length) return null;
            return (
              <div key={g.key} className="border-t border-line first:border-t-0">
                <p className="bg-subtle px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-primary">{g.title}</p>
                {list.map((r) => (
                  <button key={r.id} type="button" onClick={() => add(r)} className="flex w-full items-center justify-between border-t border-line px-3 py-2 text-left text-sm first:border-t-0 hover:bg-brand-bg/50">
                    <span>
                      {r.name}
                      {r.note && <span className="ml-1.5 text-xs text-ink-muted">· {r.note}</span>}
                    </span>
                    <span className="font-semibold">{priceText(r.price, r.price_max)}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center gap-1.5 rounded-[12px] border border-dashed border-brand-primary px-3 py-2.5 text-sm font-semibold text-brand-primary">
          <Plus className="h-4 w-4" /> Add a piece from the media kit
        </button>
      )}

      <div className="space-y-1.5">
        <label htmlFor="plan-note" className="text-sm font-medium">
          Note for {requester} <span className="font-normal text-ink-muted">optional</span>
        </label>
        <Textarea id="plan-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Fits the budget. Add a meme carousel if you want more reach." />
      </div>
      <Button
        disabled={pending || !rows.length}
        onClick={() =>
          start(async () => {
            const res = await sendCollabPlan(
              requestId,
              rows.map((r) => ({ rate_id: r.rate_id, qty: r.qty, idea: r.idea, owner_id: r.owner_id, due_date: r.due_date })),
              note,
            );
            if (!res.ok) return void toast.error(res.error);
            toast.success(`Plan sent to ${requester}.`);
            router.refresh();
          })
        }
      >
        {pending ? "Sending…" : `Send plan to ${requester}`}
      </Button>
    </div>
  );
}
