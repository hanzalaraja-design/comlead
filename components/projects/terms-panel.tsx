"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/time";
import { createPart, deletePart, updatePart } from "@/app/(app)/projects/parts-actions";

export type PartField = { label: string; value: string };
export type Term = {
  id: string;
  name: string;
  stage: string;
  starts_on: string | null;
  ends_on: string | null;
  description: string | null;
  fields: PartField[];
  renewed_from: string | null;
};

export const TERM_STAGES = [
  { key: "draft", label: "Draft", chip: "bg-subtle text-ink" },
  { key: "in_talks", label: "In talks", chip: "bg-info-soft text-info-ink" },
  { key: "agreed", label: "Signed / agreed", chip: "bg-brand-bg text-brand-primary" },
  { key: "live", label: "Live", chip: "bg-success-soft text-success-ink" },
  { key: "ended", label: "Ended", chip: "bg-subtle text-ink-muted" },
] as const;
const stageOf = (k: string) => TERM_STAGES.find((s) => s.key === k) ?? TERM_STAGES[0];

const DEFAULT_FIELDS: PartField[] = [
  { label: "Discount", value: "" },
  { label: "Our commission", value: "" },
  { label: "What we give", value: "" },
  { label: "What they give", value: "" },
  { label: "Promo code", value: "" },
];

function datesOf(t: Pick<Term, "starts_on" | "ends_on">) {
  if (t.starts_on && t.ends_on) return `${formatDate(t.starts_on, "d MMM yyyy")} – ${formatDate(t.ends_on, "d MMM yyyy")}`;
  if (t.starts_on) return `From ${formatDate(t.starts_on, "d MMM yyyy")}`;
  if (t.ends_on) return `Until ${formatDate(t.ends_on, "d MMM yyyy")}`;
  return "No dates yet";
}

/**
 * The terms of a brand partnership: each period of the deal on its own
 * (Nov to Dec 2026, then the 2027 renewal), with its stage, editable fields
 * and a description. Old terms stay for reference.
 */
export function TermsPanel({ projectId, terms, canEdit, today }: { projectId: string; terms: Term[]; canEdit: boolean; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const current = terms.find((t) => t.stage === "live") ?? terms[terms.length - 1];
  const [sel, setSel] = useState<string | null>(terms.find((t) => t.stage !== "live" && t.stage !== "ended")?.id ?? current?.id ?? null);
  const [editing, setEditing] = useState(false);
  const term = terms.find((t) => t.id === sel) ?? terms[0];
  const [draft, setDraft] = useState<Term | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Couldn't save that.");
      done?.();
      router.refresh();
    });

  const newTerm = (renewal: boolean) => {
    const from = renewal ? current : null;
    const year = from?.ends_on ? Number(from.ends_on.slice(0, 4)) + 1 : Number(today.slice(0, 4));
    run(
      async () => {
        const res = await createPart(projectId, "term", {
          name: renewal ? `${year}` : terms.length ? "New term" : "First term",
          stage: "draft",
          starts_on: renewal && from?.ends_on ? `${year}-01-01` : null,
          ends_on: null,
          description: null,
          fields: from ? from.fields.map((f) => ({ ...f })) : DEFAULT_FIELDS,
          renewed_from: from?.id ?? null,
        });
        if (res.ok) {
          setSel(res.data!.id);
          setEditing(true);
          setDraft(null);
        }
        return res;
      },
      () => toast.success(renewal ? "Renewal started from a copy of the current terms. Change what's different." : "Term added."),
    );
  };

  const startEdit = () => {
    setDraft(term ? { ...term, fields: term.fields.map((f) => ({ ...f })) } : null);
    setEditing(true);
  };
  const d = editing ? (draft ?? (term ? { ...term, fields: term.fields.map((f) => ({ ...f })) } : null)) : null;
  const setD = (patch: Partial<Term>) => setDraft({ ...(d as Term), ...patch });

  const daysLeft = current?.stage === "live" && current.ends_on ? Math.round((Date.parse(current.ends_on) - Date.parse(today)) / 86_400_000) : null;
  const hasRenewal = terms.some((t) => t.renewed_from === current?.id);

  return (
    <section aria-label="Terms" className="mb-4 space-y-3">
      <div className="surface space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Terms</h2>
            <p className="text-xs text-ink-muted">Each period of the deal on its own. Old terms stay for reference.</p>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              {current && !hasRenewal && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => newTerm(true)}>
                  <RefreshCw className="h-4 w-4" /> Start renewal
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={pending} onClick={() => newTerm(false)}>
                <Plus className="h-4 w-4" /> New term
              </Button>
            </div>
          )}
        </div>
        {daysLeft !== null && daysLeft <= 30 && !hasRenewal && (
          <p className="rounded-[12px] bg-warning-soft px-3 py-2 text-sm text-warning-ink">
            {current!.name} {daysLeft < 0 ? "has ended" : `ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}. Start the renewal when you&apos;re ready.
          </p>
        )}
        {terms.length ? (
          <div role="tablist" aria-label="Pick a term" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {terms.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === term?.id}
                onClick={() => {
                  setSel(t.id);
                  setEditing(false);
                  setDraft(null);
                }}
                className={cn(
                  "flex flex-col gap-1 rounded-[14px] border-2 px-3.5 py-3 text-left",
                  t.id === term?.id ? "border-brand-primary bg-brand-bg/40" : "border-line bg-white hover:border-ink-muted/40",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[15px] font-semibold text-ink">{t.name}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", stageOf(t.stage).chip)}>{stageOf(t.stage).label}</span>
                </span>
                <span className="text-xs text-ink-muted">{datesOf(t)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No terms yet. {canEdit ? "Add the first one with New term." : ""}</p>
        )}
      </div>

      {term && (
        <div className="surface space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold text-ink">{term.name}: where it stands</h3>
            {canEdit && !editing && TERM_STAGES.findIndex((s) => s.key === term.stage) < TERM_STAGES.length - 1 && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  const next = TERM_STAGES[TERM_STAGES.findIndex((s) => s.key === term.stage) + 1];
                  run(() => updatePart(term.id, { stage: next.key }));
                }}
              >
                Move to {TERM_STAGES[TERM_STAGES.findIndex((s) => s.key === term.stage) + 1].label}
              </Button>
            )}
          </div>
          <ol className="grid grid-cols-5 gap-1.5">
            {TERM_STAGES.map((s, i) => {
              const at = TERM_STAGES.findIndex((x) => x.key === term.stage);
              return (
                <li key={s.key} className="space-y-1.5">
                  <span className={cn("block h-1.5 rounded-full", i < at ? "bg-brand-primary/40" : i === at ? "bg-brand-primary" : "bg-subtle")} />
                  {canEdit && !editing ? (
                    <button type="button" onClick={() => run(() => updatePart(term.id, { stage: s.key }))} className={cn("text-left text-xs", i === at ? "font-semibold text-ink" : "text-ink-muted hover:text-ink")}>
                      {s.label}
                    </button>
                  ) : (
                    <span className={cn("text-xs", i === at ? "font-semibold text-ink" : "text-ink-muted")}>{s.label}</span>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
            <h3 className="text-[15px] font-semibold text-ink">What&apos;s agreed for {term.name}</h3>
            {canEdit &&
              (editing ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setDraft(null))}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      d &&
                      run(
                        () => updatePart(term.id, { name: d.name, starts_on: d.starts_on, ends_on: d.ends_on, description: d.description, fields: d.fields }),
                        () => (setEditing(false), setDraft(null), toast.success("Saved.")),
                      )
                    }
                  >
                    <Check className="h-4 w-4" /> Save
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={startEdit}>
                  Edit
                </Button>
              ))}
          </div>

          {!editing || !d ? (
            <div className="space-y-3">
              {term.description && <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{term.description}</p>}
              <dl className="divide-y divide-line rounded-[12px] border border-line">
                <div className="grid grid-cols-[minmax(0,12rem)_1fr] gap-3 px-3 py-2.5 text-sm">
                  <dt className="text-ink-muted">Dates</dt>
                  <dd className="text-ink">{datesOf(term)}</dd>
                </div>
                {term.fields.map((f, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,12rem)_1fr] gap-3 px-3 py-2.5 text-sm">
                    <dt className="text-ink-muted">{f.label || "Untitled"}</dt>
                    <dd className="whitespace-pre-line text-ink">{f.value || "—"}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-sm font-medium text-ink">
                  Term name
                  <input value={d.name} onChange={(e) => setD({ name: e.target.value })} maxLength={120} className="h-10 w-full field px-3 text-sm" />
                </label>
                <label className="space-y-1 text-sm font-medium text-ink">
                  Starts
                  <input type="date" value={d.starts_on ?? ""} onChange={(e) => setD({ starts_on: e.target.value || null })} className="h-10 w-full field px-3 text-sm" />
                </label>
                <label className="space-y-1 text-sm font-medium text-ink">
                  Ends
                  <input type="date" value={d.ends_on ?? ""} onChange={(e) => setD({ ends_on: e.target.value || null })} className="h-10 w-full field px-3 text-sm" />
                </label>
              </div>
              <label className="block space-y-1 text-sm font-medium text-ink">
                Description
                <Textarea value={d.description ?? ""} onChange={(e) => setD({ description: e.target.value })} rows={3} placeholder="Anything worth knowing about this term: context, what was discussed, special conditions" />
              </label>
              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">Fields</p>
                {d.fields.map((f, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-start gap-2">
                    <input
                      aria-label="Field name"
                      value={f.label}
                      maxLength={80}
                      onChange={(e) => setD({ fields: d.fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                      className="h-10 field px-3 text-sm text-ink-muted"
                    />
                    <Textarea
                      aria-label={f.label || "Value"}
                      rows={1}
                      value={f.value}
                      onChange={(e) => setD({ fields: d.fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                      className="min-h-10"
                    />
                    <button type="button" aria-label={`Remove ${f.label || "field"}`} onClick={() => setD({ fields: d.fields.filter((_, j) => j !== i) })} className="mt-2.5 text-ink-muted hover:text-ink">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setD({ fields: [...d.fields, { label: "New field", value: "" }] })} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-primary hover:underline">
                  <Plus className="h-4 w-4" /> Add a field
                </button>
              </div>
              <div className="border-t border-line pt-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(`Remove the term "${term.name}"? Its fields and description go too.`)) return;
                    run(() => deletePart(term.id), () => (setEditing(false), setDraft(null), setSel(null)));
                  }}
                  className="inline-flex items-center gap-1.5 text-sm text-danger hover:underline"
                >
                  <Trash2 className="h-4 w-4" /> Remove this term
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
