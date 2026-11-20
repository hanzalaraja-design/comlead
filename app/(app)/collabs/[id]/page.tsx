import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { PersonAvatar } from "@/components/person-avatar";
import { CommentImages } from "@/components/pasted-images";
import { PlanBuilder } from "@/components/collabs/plan-builder";
import { CollabComments, DecidePlan, LiveLink, MarkLive, ReportForm } from "@/components/collabs/actions-ui";
import { getDepartmentMembers, getPeople } from "@/lib/auth";
import { collabAccess } from "@/lib/collabs-server";
import { STATUS_LABELS, STATUS_STYLES, money, priceText, totalText, type CollabItem, type CollabRate, type CollabRequest } from "@/lib/collabs";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPKT } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Paid social · Highfy Tasks" };

const STEPS = ["Requested", "Plan", "Approved", "Live", "Report"] as const;
const stepOf = (s: CollabRequest["status"]) => ({ requested: 1, changes: 1, planned: 1, approved: 2, live: 3, reported: 4 })[s];

function Stepper({ status }: { status: CollabRequest["status"] }) {
  const at = stepOf(status);
  return (
    <ol className="mb-5 grid grid-cols-5 gap-1.5 text-center text-[12px] font-semibold">
      {STEPS.map((s, i) => (
        <li key={s} className={cn("rounded-[8px] px-1 py-1.5", i < at || status === "reported" ? "bg-success-soft text-success-ink" : i === at ? "bg-brand-primary text-white" : "bg-subtle text-ink-muted")}>
          {s}
        </li>
      ))}
    </ol>
  );
}

export default async function CollabPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ revise?: string }> }) {
  const [{ id }, { revise }, access] = await Promise.all([params, searchParams, collabAccess()]);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !access.can) notFound();
  const supabase = await createClient();
  const [{ data: rData }, { data: itemData }, { data: rateData }, { data: commentData }, people, members] = await Promise.all([
    // "*" so the media kit picks come through once the database has them.
    supabase.from("collab_requests").select("*").eq("id", id).maybeSingle(),
    supabase.from("collab_items").select("*").eq("request_id", id).order("sort"),
    supabase.from("collab_rates").select("*").eq("archived", false).order("sort"),
    supabase.from("collab_comments").select("id, author_id, body, image_paths, created_at").eq("request_id", id).order("created_at"),
    getPeople(),
    getDepartmentMembers(),
  ]);
  const r = rData as unknown as CollabRequest | null;
  if (!r) notFound();
  const items = (itemData ?? []) as CollabItem[];
  const rates = (rateData ?? []) as CollabRate[];
  const byId = new Map(people.map((p) => [p.id, p]));
  const name = (uid: string | null) => personName(uid ? byId.get(uid) : null);
  const requester = name(r.requested_by);
  // Who can do a piece: the Content team (or everyone, if it isn't set yet).
  const team = access.contentDeptId ? people.filter((p) => members.some((m) => m.department_id === access.contentDeptId && m.user_id === p.id)) : people;
  const owners = team.length ? team : people;
  const campaign = r.project_id ? (await supabase.from("projects").select("name, slug").eq("id", r.project_id).maybeSingle()).data : null;

  const planning = access.content && (r.status === "requested" || r.status === "changes" || (r.status === "planned" && revise === "1"));
  const delivering = r.status === "approved" || r.status === "live" || r.status === "reported";
  const canMark = (it: CollabItem) => access.content || it.owner_id === access.viewer.id;

  const planTable = (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-subtle text-left text-[12.5px] text-ink-muted">
          <th className="px-3 py-2 font-semibold">Piece</th>
          <th className="px-3 py-2 font-semibold">Idea</th>
          <th className="px-3 py-2 font-semibold">Who · when</th>
          <th className="px-3 py-2 text-right font-semibold">Cost</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.id} className="border-t border-line align-top">
            <td className="px-3 py-2.5 font-semibold text-ink">
              {it.name}
              {it.qty > 1 && ` ×${it.qty}`}
            </td>
            <td className="px-3 py-2.5 text-ink">{it.idea ?? <span className="text-ink-muted">—</span>}</td>
            <td className="px-3 py-2.5 text-ink">
              {name(it.owner_id)}
              {it.due_date && <span className="text-ink-muted"> · {formatDate(it.due_date, "d MMM")}</span>}
            </td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right">{priceText(it.unit_price * it.qty, it.unit_price_max ? it.unit_price_max * it.qty : null)}</td>
          </tr>
        ))}
        <tr className="border-t border-line bg-brand-bg/60 font-bold">
          <td colSpan={3} className="px-3 py-2.5">
            Total
          </td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right">{totalText(r)}</td>
        </tr>
      </tbody>
    </table>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumb={[{ label: "Paid social", href: "/collabs" }, r.brand]}
        title={r.brand}
        description={`Asked by ${requester} · ${formatPKT(r.created_at, "d MMM")} · live by ${formatDate(r.go_live, "EEE d MMM")} · ${r.budget}`}
        actions={<span className={cn("rounded-full px-3 py-1 text-[13px] font-semibold", STATUS_STYLES[r.status])}>{STATUS_LABELS[r.status]}</span>}
      />
      <Stepper status={r.status} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          {r.status === "changes" && r.change_note && (
            <div className="rounded-[14px] bg-danger-soft px-4 py-3 text-sm text-danger-ink">
              <b>Changes asked:</b> {r.change_note}
            </div>
          )}

          {planning && <PlanBuilder requestId={r.id} rates={rates} people={owners} me={access.viewer.id} goLive={r.go_live} existing={items} requester={requester} wanted={r.wants ?? []} />}

          {(r.status === "requested" || r.status === "changes") && !access.content && (
            <div className="surface space-y-3 p-4 md:p-5">
              <h2 className="text-base font-bold text-ink">{r.status === "changes" ? "Content is updating the plan" : "Waiting for Content's plan"}</h2>
              <p className="text-sm text-ink-muted">You&apos;ll get a notification when the plan and cost are ready. You can still change the brief until then.</p>
              {access.commercial && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/collabs/new?edit=${r.id}`}>
                    <Pencil className="h-4 w-4" /> Edit the brief
                  </Link>
                </Button>
              )}
            </div>
          )}

          {r.status === "planned" && !planning && (
            <div className="surface space-y-4 p-4 md:p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-bold text-ink">Content&apos;s plan</h2>
                <span className="text-xs text-ink-muted">by {name(r.planned_by)}</span>
              </div>
              <div className="overflow-x-auto rounded-[12px] border border-line">{planTable}</div>
              {r.plan_note && (
                <p className="rounded-[12px] bg-brand-bg/60 px-4 py-2.5 text-sm text-ink">
                  <b>{name(r.planned_by)}:</b> {r.plan_note}
                </p>
              )}
              {access.commercial ? (
                <DecidePlan requestId={r.id} />
              ) : (
                <p className="text-sm text-ink-muted">Waiting for {requester} to approve.</p>
              )}
              {access.content && (
                <Link href={`/collabs/${r.id}?revise=1`} className="text-sm font-semibold text-brand-primary hover:underline">
                  Change the plan
                </Link>
              )}
            </div>
          )}

          {delivering && (
            <div className="surface space-y-3 p-4 md:p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-bold text-ink">{r.status === "reported" ? "What went live" : "Pieces"}</h2>
                <span className="text-xs text-ink-muted">
                  {items.filter((i) => i.live_url).length} of {items.filter((i) => !i.is_addon).length} live · {totalText(r)}
                </span>
              </div>
              <ul className="divide-y divide-line rounded-[12px] border border-line">
                {items.filter((i) => !i.is_addon).map((it) => (
                  <li key={it.id} className="space-y-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className={cn("h-4 w-4 rounded-full border-[1.5px]", it.live_url ? "border-success bg-success" : "border-line")} />
                        <span className="font-semibold text-ink">
                          {it.name}
                          {it.qty > 1 && ` ×${it.qty}`}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                        <PersonAvatar person={it.owner_id ? byId.get(it.owner_id) : null} className="h-5 w-5" />
                        {name(it.owner_id)}
                        {it.due_date && ` · ${formatDate(it.due_date, "d MMM")}`}
                        {it.task_id && (
                          <Link href={`/tasks/${it.task_id}`} className="ml-1 font-medium text-brand-primary hover:underline">
                            Task
                          </Link>
                        )}
                      </span>
                    </div>
                    {it.idea && <p className="pl-6 text-sm text-ink">{it.idea}</p>}
                    <div className="pl-6">
                      {it.live_url ? (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <LiveLink url={it.live_url} />
                          {(it.reach != null || it.views != null) && (
                            <span className="text-xs text-ink-muted">
                              {it.reach != null && `${money(it.reach)} reach`}
                              {it.reach != null && it.views != null && " · "}
                              {it.views != null && `${money(it.views)} views`}
                            </span>
                          )}
                        </div>
                      ) : canMark(it) ? (
                        <MarkLive itemId={it.id} requestId={r.id} />
                      ) : (
                        <span className="text-xs text-ink-muted">Not live yet</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {items.some((i) => i.is_addon) && (
                <p className="text-xs text-ink-muted">Add-ons: {items.filter((i) => i.is_addon).map((i) => i.name).join(", ")}</p>
              )}
            </div>
          )}

          {r.status === "reported" && (
            <div className="surface space-y-3 p-4 md:p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-bold text-ink">Report</h2>
                <span className="text-xs text-ink-muted">{r.reported_at && formatPKT(r.reported_at, "d MMM")}</span>
              </div>
              <p className="rounded-[12px] bg-brand-bg/60 px-4 py-3 text-sm text-ink">{r.report_summary}</p>
              <CommentImages paths={r.report_images} />
            </div>
          )}

          {access.content && (r.status === "live" || (r.status === "reported" && revise === "1")) && (
            <ReportForm
              requestId={r.id}
              items={items.filter((i) => !i.is_addon).map((i) => ({ id: i.id, name: i.name, qty: i.qty, reach: i.reach, views: i.views }))}
              initial={r.status === "reported" ? { summary: r.report_summary ?? "", images: r.report_images } : undefined}
            />
          )}
          {access.content && r.status === "reported" && revise !== "1" && (
            <Link href={`/collabs/${r.id}?revise=1`} className="text-sm font-semibold text-brand-primary hover:underline">
              Update the report
            </Link>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <div className="surface p-4 md:p-5">
            <h2 className="mb-3 text-base font-bold text-ink">The brief</h2>
            <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-ink-muted">Promote</dt>
              <dd className="text-ink">{r.promote}</dd>
              <dt className="text-ink-muted">Goal</dt>
              <dd className="text-ink">{r.goals.join(", ")}</dd>
              <dt className="text-ink-muted">Go live by</dt>
              <dd className="text-ink">{formatDate(r.go_live, "EEE d MMM yyyy")}</dd>
              {((r.wants?.length ?? 0) > 0 || r.wants_other) && (
                <>
                  <dt className="text-ink-muted">Asked for</dt>
                  <dd className="text-ink">
                    {(r.wants ?? []).map((w) => `${w.qty} × ${w.name}`).join(", ")}
                    {r.wants?.length && r.wants_other ? ". " : ""}
                    {r.wants_other ? <>Also: {r.wants_other}</> : null}
                  </dd>
                </>
              )}
              <dt className="text-ink-muted">Budget</dt>
              <dd className="text-ink">{r.budget}</dd>
              <dt className="text-ink-muted">For</dt>
              <dd className="text-ink">{r.audience}</dd>
              <dt className="text-ink-muted">Key message</dt>
              <dd className="text-ink">{r.key_message}</dd>
              {r.link && (
                <>
                  <dt className="text-ink-muted">Page</dt>
                  <dd className="break-words text-ink">{r.link}</dd>
                </>
              )}
              {campaign && (
                <>
                  <dt className="text-ink-muted">Campaign</dt>
                  <dd>
                    <Link href={`/campaigns/${campaign.slug}`} className="font-medium text-brand-primary hover:underline">
                      {campaign.name}
                    </Link>
                  </dd>
                </>
              )}
              {r.refs && (
                <>
                  <dt className="text-ink-muted">References</dt>
                  <dd className="whitespace-pre-wrap break-words text-ink">{r.refs}</dd>
                </>
              )}
              {r.notes && (
                <>
                  <dt className="text-ink-muted">Notes</dt>
                  <dd className="whitespace-pre-wrap text-ink">{r.notes}</dd>
                </>
              )}
            </dl>
          </div>
          <CollabComments requestId={r.id} comments={(commentData ?? []) as never[]} people={people} me={access.viewer.id} />
        </div>
      </div>
    </div>
  );
}
