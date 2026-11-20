import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PersonAvatar } from "@/components/person-avatar";
import { DecideAccess } from "@/components/access/decide-access";
import { getPeople, requireViewer } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { formatPKT } from "@/lib/time";

export const metadata = { title: "Access request" };

type Req = {
  id: string;
  item_type: "task" | "project";
  item_id: string;
  requested_by: string;
  reason: string | null;
  status: "pending" | "given" | "declined";
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

/**
 * Someone asked for access to something you own: give it or decline.
 * Giving adds them as a collaborator (task) or a person on it (project).
 */
export default async function AccessRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer] = await Promise.all([params, requireViewer()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("access_requests").select("*").eq("id", id).maybeSingle();
  const r = data as Req | null;
  if (!r) notFound();

  const [people, item, { data: canDecide }] = await Promise.all([
    getPeople(),
    r.item_type === "task"
      ? supabase.from("tasks").select("title").eq("id", r.item_id).maybeSingle().then(({ data }) => (data ? { name: data.title as string, href: `/tasks/${r.item_id}`, noun: "task" } : null))
      : supabase
          .from("projects")
          .select("name, kind, slug")
          .eq("id", r.item_id)
          .maybeSingle()
          .then(({ data }) => (data ? { name: data.name as string, href: `/${data.kind}s/${data.slug}`, noun: data.kind as string } : null)),
    supabase.rpc("can_decide_access", { p_type: r.item_type, p_id: r.item_id }),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const asker = byId.get(r.requested_by);
  const askerName = asker ? personName(asker) : "Someone";
  const mine = r.requested_by === viewer.id;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader breadcrumb={[{ label: "Notifications", href: "/notifications" }, "Access request"]} title={mine ? "Your access request" : `${askerName} asked for access`} />
      <div className="surface space-y-5 p-5 md:p-6">
        <div className="flex items-start gap-3">
          <PersonAvatar person={asker ?? null} className="h-10 w-10" />
          <div className="min-w-0 space-y-1">
            <p className="text-[15px] text-ink">
              <span className="font-semibold">{askerName}</span> asked for access to the {item?.noun ?? r.item_type}{" "}
              {item ? (
                <Link href={item.href} className="font-semibold text-brand-primary hover:underline">
                  {item.name}
                </Link>
              ) : (
                "that was deleted"
              )}
              .
            </p>
            <p className="text-xs text-ink-muted">{formatPKT(r.created_at, "EEE d MMM, h:mm a")}</p>
            {r.reason && <p className="rounded-[12px] bg-canvas px-3 py-2 text-sm text-ink">&ldquo;{r.reason}&rdquo;</p>}
          </div>
        </div>
        {r.status === "pending" ? (
          canDecide && item ? (
            <div className="space-y-2">
              <DecideAccess requestId={r.id} name={askerName} />
              <p className="text-xs text-ink-muted">
                Giving access adds them as {r.item_type === "task" ? "a collaborator on the task" : `a person on the ${item.noun}`}. You can remove them later.
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Waiting for the owner to decide.</p>
          )
        ) : (
          <p className={r.status === "given" ? "text-sm font-semibold text-success-ink" : "text-sm font-semibold text-ink-muted"}>
            {r.status === "given" ? "Access given" : "Declined"}
            {r.decided_by && byId.get(r.decided_by) ? ` by ${personName(byId.get(r.decided_by)!)}` : ""}
            {r.decided_at ? `, ${formatPKT(r.decided_at, "d MMM")}` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
