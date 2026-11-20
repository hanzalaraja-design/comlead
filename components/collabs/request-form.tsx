"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BUDGETS, GOALS, RATE_GROUPS, budgetRange, money, priceText, type CollabRate, type CollabWant } from "@/lib/collabs";
import { cn } from "@/lib/utils";
import { saveCollabRequest, type CollabRequestInput } from "@/app/(app)/collabs/actions";

type Values = Required<{ [K in Exclude<keyof CollabRequestInput, "wants">]: K extends "goals" ? string[] : string }> & { wants: CollabWant[] };

const CUSTOM = "custom";
const parseRs = (s: string) => {
  const n = Number(s.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The brief: what to promote, what you'd like from the media kit, budget; extras folded away. */
export function CollabRequestForm({
  id,
  initial,
  campaigns,
  rates,
}: {
  id?: string;
  initial?: Partial<Values>;
  campaigns: { id: string; name: string }[];
  rates: CollabRate[];
}) {
  const router = useRouter();
  const [v, setV] = useState<Values>({
    brand: "",
    promote: "",
    goals: [],
    go_live: "",
    budget: "",
    audience: "",
    key_message: "",
    link: "",
    refs: "",
    project_id: "",
    notes: "",
    wants: [],
    wants_other: "",
    ...initial,
  });
  // A budget that isn't one of the ranges was typed in.
  const typed = !!initial?.budget && !(BUDGETS as readonly string[]).includes(initial.budget);
  const [budgetPick, setBudgetPick] = useState(typed ? CUSTOM : (initial?.budget ?? ""));
  const nums = typed ? (initial!.budget!.match(/[\d,]+/g) ?? []).map((x) => x.replace(/,/g, "")) : [];
  const [from, setFrom] = useState(nums[0] ?? "");
  const [to, setTo] = useState(nums[1] ?? "");
  const budget = budgetPick === CUSTOM ? budgetRange(parseRs(from), parseRs(to)) : budgetPick;
  const qtyOf = (rateId: string) => v.wants.find((w) => w.rate_id === rateId)?.qty ?? 0;
  const setQty = (rate: CollabRate, qty: number) =>
    setV((x) => ({
      ...x,
      wants: qty <= 0 ? x.wants.filter((w) => w.rate_id !== rate.id) : x.wants.some((w) => w.rate_id === rate.id)
        ? x.wants.map((w) => (w.rate_id === rate.id ? { ...w, qty } : w))
        : [...x.wants, { rate_id: rate.id, name: rate.name, qty }],
    }));
  const rateOf = new Map(rates.map((r) => [r.id, r]));
  const kitMin = v.wants.reduce((n, w) => n + (rateOf.get(w.rate_id)?.price ?? 0) * w.qty, 0);
  const kitMax = v.wants.reduce((n, w) => n + ((rateOf.get(w.rate_id)?.price_max ?? rateOf.get(w.rate_id)?.price) ?? 0) * w.qty, 0);
  const kitTotal = kitMax > kitMin ? `Rs ${money(kitMin)}–${money(kitMax)}` : `Rs ${money(kitMin)}`;
  const hasExtras = !!(initial?.link || initial?.refs || initial?.project_id || initial?.notes);
  const [more, setMore] = useState(hasExtras);
  const [pending, start] = useTransition();
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: e.target.value }));

  return (
    <form
      className="surface space-y-4 p-4 md:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          if (!budget) return void toast.error(budgetPick === CUSTOM ? "Type the budget range." : "Pick a budget.");
          const res = await saveCollabRequest(id ?? null, { ...v, budget } as CollabRequestInput);
          if (!res.ok) return void toast.error(res.error);
          toast.success(id ? "Brief updated." : "Sent to Content. You'll be told when the plan is ready.");
          router.push(`/collabs/${res.data!.id}`);
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="brand">Brand</Label>
          <Input id="brand" required maxLength={120} value={v.brand} onChange={set("brand")} placeholder="e.g. COSRX" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="go_live">Go live by</Label>
          <Input id="go_live" type="date" required value={v.go_live} onChange={set("go_live")} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="promote">
          What to promote <span className="font-normal text-ink-muted">product, launch or offer</span>
        </Label>
        <Input id="promote" required maxLength={500} value={v.promote} onChange={set("promote")} placeholder="e.g. Snail Mucin essence relaunch, 25% off 27–30 Nov, Highfy exclusive" />
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">
          Goal <span className="font-normal text-ink-muted">tap one or more</span>
        </legend>
        <div className="flex flex-wrap gap-2 pt-1">
          {GOALS.map((g) => {
            const on = v.goals.includes(g);
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                onClick={() => setV((x) => ({ ...x, goals: on ? x.goals.filter((y) => y !== g) : [...x.goals, g] }))}
                className={cn("h-9 rounded-full border px-3.5 text-sm font-semibold", on ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-ink/40")}
              >
                {g}
              </button>
            );
          })}
        </div>
      </fieldset>
      {rates.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            What you need <span className="font-normal text-ink-muted">from the media kit, optional: Content plans the final mix</span>
          </legend>
          <div className="divide-y divide-line rounded-[12px] border border-line">
            {RATE_GROUPS.map((g) => {
              const list = rates.filter((r) => r.grp === g.key);
              if (!list.length) return null;
              return (
                <div key={g.key} className="px-3 py-2">
                  <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{g.title}</p>
                  {list.map((r) => {
                    const q = qtyOf(r.id);
                    return (
                      <div key={r.id} className={cn("flex items-center gap-3 rounded-[8px] px-1 py-1.5", q > 0 && "bg-brand-bg")}>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink">{r.name}</span>
                          <span className="block text-xs text-ink-muted">
                            {r.price === 0 && !r.price_max ? "No charge" : `Rs ${priceText(r.price, r.price_max)}`}
                            {r.note ? ` · ${r.note}` : ""}
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`One fewer ${r.name}`}
                            disabled={q === 0}
                            onClick={() => setQty(r, q - 1)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-white text-ink disabled:opacity-30"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-6 text-center text-sm font-semibold tabular-nums" aria-live="polite">
                            {q}
                          </span>
                          <button
                            type="button"
                            aria-label={`One more ${r.name}`}
                            disabled={q >= 50}
                            onClick={() => setQty(r, q + 1)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-white text-ink"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {v.wants.length > 0 && (
            <p className="text-sm text-ink">
              Media kit total: <span className="font-semibold">{kitTotal}</span>
            </p>
          )}
          <div className="space-y-1.5 pt-1">
            <Label htmlFor="wants_other">
              Something else <span className="font-normal text-ink-muted">not in the media kit</span>
            </Label>
            <Input id="wants_other" maxLength={1000} value={v.wants_other} onChange={set("wants_other")} placeholder="e.g. A giveaway post, a story series, a live session" />
          </div>
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="budget">Budget</Label>
          <select id="budget" required value={budgetPick} onChange={(e) => setBudgetPick(e.target.value)} className="field h-10 w-full px-3">
            <option value="">Pick a budget</option>
            {BUDGETS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
            <option value={CUSTOM}>Set my own range…</option>
          </select>
          {budgetPick === CUSTOM && (
            <div className="flex items-center gap-2">
              <Input aria-label="Budget from (Rs)" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="From, e.g. 150,000" />
              <span className="text-ink-muted">–</span>
              <Input aria-label="Budget up to (Rs)" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} placeholder="To, e.g. 300,000" />
            </div>
          )}
          {v.wants.length > 0 && <p className="text-xs text-ink-muted">What you picked comes to {kitTotal}.</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audience">Who it&apos;s for</Label>
          <Input id="audience" required maxLength={300} value={v.audience} onChange={set("audience")} placeholder="e.g. Women 18–30, oily skin" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="key_message">
          Key message <span className="font-normal text-ink-muted">the one thing people should remember</span>
        </Label>
        <Input id="key_message" required maxLength={300} value={v.key_message} onChange={set("key_message")} placeholder="e.g. Glass skin in 2 weeks, now 25% off only on Highfy" />
      </div>

      <div className="rounded-[12px] border border-line">
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-semibold text-brand-primary">
          Optional: Instagram or website, creative references, campaign, anything else
          <ChevronDown className={cn("h-4 w-4 transition-transform", more && "rotate-180")} />
        </button>
        {more && (
          <div className="space-y-4 border-t border-line p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="link">Instagram or website</Label>
                <Input id="link" maxLength={500} value={v.link} onChange={set("link")} placeholder="instagram.com/brand" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project_id">Campaign</Label>
                <select id="project_id" value={v.project_id} onChange={set("project_id")} className="field h-10 w-full px-3">
                  <option value="">None</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refs">
                Creative references <span className="font-normal text-ink-muted">links to posts, reels or ideas you like</span>
              </Label>
              <Textarea id="refs" rows={2} maxLength={2000} value={v.refs} onChange={set("refs")} placeholder="One link per line" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Anything else</Label>
              <Textarea id="notes" rows={3} maxLength={2000} value={v.notes} onChange={set("notes")} placeholder="Must-mention claims, hashtags, things to avoid, brand approval needed…" />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : id ? "Save brief" : "Send to Content"}
        </Button>
        <span className="text-[13px] text-ink-muted">
          By sending, you agree to the{" "}
          <Link href="/collabs?tab=terms" target="_blank" className="font-semibold text-brand-primary hover:underline">
            paid social terms
          </Link>
          .
        </span>
      </div>
    </form>
  );
}
