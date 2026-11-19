"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BUDGETS, GOALS } from "@/lib/collabs";
import { cn } from "@/lib/utils";
import { saveCollabRequest, type CollabRequestInput } from "@/app/(app)/collabs/actions";

type Values = Required<{ [K in keyof CollabRequestInput]: K extends "goals" ? string[] : string }>;

/** Commercial's brief: 7 required fields, the rest folded away. */
export function CollabRequestForm({ id, initial, campaigns }: { id?: string; initial?: Partial<Values>; campaigns: { id: string; name: string }[] }) {
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
    ...initial,
  });
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
          const res = await saveCollabRequest(id ?? null, v as CollabRequestInput);
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="budget">Budget</Label>
          <select id="budget" required value={v.budget} onChange={set("budget")} className="field h-10 w-full px-3">
            <option value="">Pick a budget</option>
            {BUDGETS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
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
            brand collab terms
          </Link>
          .
        </span>
      </div>
    </form>
  );
}
