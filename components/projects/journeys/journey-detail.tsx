"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { deletePart, updatePart } from "@/app/(app)/projects/parts-actions";
import type { PartField } from "@/components/projects/terms-panel";
import { BUILD_STAGES, JOURNEY_STAGES, type JourneyRole } from "@/components/projects/journeys/stages";

export type Journey = { id: string; name: string; stage: string; description: string | null; fields: PartField[]; liveSince: string | null };
export type JourneyPeople = Record<JourneyRole, string | null>;

/** Where a journey stands, what it is, and its description. */
export function JourneyDetail({ journey, people, canEdit, startEditing }: { journey: Journey; people: JourneyPeople; canEdit: boolean; startEditing: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(startEditing);
  const [name, setName] = useState(journey.name);
  const [fields, setFields] = useState<PartField[]>(journey.fields.map((f) => ({ ...f })));
  const [desc, setDesc] = useState(journey.description ?? "");
  const descChanged = desc !== (journey.description ?? "");

  const save = (patch: Parameters<typeof updatePart>[1], done?: string, after?: () => void) =>
    start(async () => {
      const res = await updatePart(journey.id, patch);
      if (!res.ok) return void toast.error(res.error);
      if (done) toast.success(done);
      after?.();
      router.refresh();
    });

  const at = JOURNEY_STAGES.findIndex((s) => s.key === journey.stage);
  const who = (r: JourneyRole) => people[r] ?? "Not set";
  const nextStep: { label: string; stage: string } | null =
    journey.stage === "idea"
      ? { label: "Start drafting", stage: "drafting" }
      : journey.stage === "drafting"
        ? { label: "Send to design", stage: "design" }
        : journey.stage === "design"
          ? { label: `Send to ${who("review")} for review`, stage: "review" }
          : journey.stage === "review"
            ? { label: "Approve", stage: "approved" }
            : null;
  const handover =
    journey.stage === "review"
      ? `With ${who("review")} for review. Approving tells ${who("live")} to put it live on Mergn; sending it back tells ${who("build")}.`
      : at >= 4
        ? `Approved. ${who("live")} puts it live on Mergn.`
        : `With ${who("build")}. Moving it on tells the next person.`;

  return (
    <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">
        <section className="surface space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-ink">{journey.name}: where it stands</h2>
            {canEdit && (
              <div className="flex gap-2">
                {journey.stage === "review" && (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => save({ stage: "design" }, `Sent back to ${who("build")}.`)}>
                    Send back to {who("build")}
                  </Button>
                )}
                {nextStep && (
                  <Button size="sm" disabled={pending} onClick={() => save({ stage: nextStep.stage }, "Moved on.")}>
                    {nextStep.label}
                  </Button>
                )}
              </div>
            )}
          </div>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BUILD_STAGES.map((s, i) => {
              const done = i < at;
              const now = i === at;
              return (
                <li key={s.key} className={cn("space-y-1.5 rounded-[12px] border px-3 py-2.5", now ? "border-2 border-brand-primary bg-brand-bg/40" : "border-line bg-white")}>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <span
                      className={cn(
                        "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                        done ? "bg-success text-white" : now ? "bg-brand-primary text-white" : "bg-subtle text-ink-muted",
                      )}
                    >
                      {done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
                    </span>
                    {s.label}
                  </span>
                  <span className="block text-xs text-ink-muted">{who(s.role)}</span>
                  <span className="block text-[11px] text-ink-muted">{done ? "Done" : now ? "Now" : "Next"}</span>
                </li>
              );
            })}
          </ol>
          <p className="rounded-[10px] bg-canvas px-3 py-2 text-sm text-ink">{handover}</p>
        </section>

        <section className="surface space-y-2 p-4">
          <label htmlFor="journey-desc" className="text-[15px] font-semibold text-ink">
            Description
          </label>
          <Textarea
            id="journey-desc"
            rows={9}
            value={desc}
            disabled={!canEdit}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Write out the journey: what it's for, the messages, timings, offers, links to Figma or Mergn"
            className="text-[15px] leading-relaxed"
          />
          {canEdit && (
            <div className="flex justify-end">
              <Button size="sm" disabled={pending || !descChanged} onClick={() => save({ description: desc }, "Description saved.")}>
                Save description
              </Button>
            </div>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <section aria-label="Live on Mergn" className="surface flex items-center justify-between gap-3 px-4 py-3">
          <span>
            <span className="block text-xs text-ink-muted">On Mergn · {who("live")}</span>
            <span className={cn("block text-[15px] font-semibold", journey.stage === "live" ? "text-success-ink" : journey.stage === "approved" ? "text-brand-primary" : "text-ink-muted")}>
              {journey.stage === "live" ? `Live${journey.liveSince ? ` since ${journey.liveSince}` : ""}` : journey.stage === "approved" ? "Ready to put live" : "Not yet: after review"}
            </span>
          </span>
          {canEdit && journey.stage === "approved" && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => save({ stage: "live" }, "Marked live on Mergn.")}>
              Mark live
            </Button>
          )}
        </section>

        <section className="surface overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-[15px] font-semibold text-ink">About this journey</h2>
            {canEdit &&
              (editing ? (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setName(journey.name), setFields(journey.fields.map((f) => ({ ...f }))))}>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={pending || !name.trim()} onClick={() => save({ name, fields }, "Saved.", () => setEditing(false))}>
                    Save
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              ))}
          </div>
          {editing ? (
            <div className="space-y-2 border-t border-line px-4 py-3">
              <label className="block space-y-1 text-xs font-semibold text-ink-muted">
                Journey name
                <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="h-9 w-full field px-2.5 text-sm text-ink" />
              </label>
              {fields.map((f, i) => (
                <div key={i} className="grid grid-cols-[7rem_1fr_auto] items-start gap-1.5">
                  <input
                    aria-label="Field name"
                    value={f.label}
                    maxLength={80}
                    onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    className="h-9 min-w-0 field px-2 text-xs text-ink-muted"
                  />
                  <Textarea
                    aria-label={f.label || "Value"}
                    rows={1}
                    value={f.value}
                    onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                    className="min-h-9 text-sm"
                  />
                  <button type="button" aria-label={`Remove ${f.label || "field"}`} onClick={() => setFields(fields.filter((_, j) => j !== i))} className="mt-2 text-ink-muted hover:text-ink">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setFields([...fields, { label: "New field", value: "" }])} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-primary hover:underline">
                <Plus className="h-4 w-4" /> Add a field
              </button>
              <div className="border-t border-line pt-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(`Remove the journey "${journey.name}"? Its tasks stay, under Other tasks.`)) return;
                    start(async () => {
                      const res = await deletePart(journey.id);
                      if (!res.ok) return void toast.error(res.error);
                      router.replace("?");
                      router.refresh();
                    });
                  }}
                  className="inline-flex items-center gap-1.5 text-sm text-danger hover:underline"
                >
                  <Trash2 className="h-4 w-4" /> Remove this journey
                </button>
              </div>
            </div>
          ) : (
            <dl className="divide-y divide-line border-t border-line">
              {journey.fields.length ? (
                journey.fields.map((f, i) => (
                  <div key={i} className="grid grid-cols-[7rem_1fr] gap-2 px-4 py-2.5 text-sm">
                    <dt className="text-ink-muted">{f.label || "Untitled"}</dt>
                    <dd className="whitespace-pre-line text-ink">{f.value || "—"}</dd>
                  </div>
                ))
              ) : (
                <p className="px-4 py-2.5 text-sm text-ink-muted">No fields yet.</p>
              )}
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}
