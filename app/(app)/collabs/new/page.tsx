import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { CollabRequestForm } from "@/components/collabs/request-form";
import { RateCard } from "@/components/collabs/rate-card";
import { collabAccess } from "@/lib/collabs-server";
import { REQUEST_COLUMNS, type CollabRate, type CollabRequest } from "@/lib/collabs";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "New request · Paid social · Highfy Tasks" };

/** Commercial's brief: new, or ?edit=<id> before the plan arrives. */
export default async function NewCollabPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const [{ edit }, access] = await Promise.all([searchParams, collabAccess()]);
  if (!access.commercial) redirect("/collabs");
  const supabase = await createClient();
  const [{ data: campaigns }, { data: rates }, existing] = await Promise.all([
    supabase.from("projects").select("id, name").eq("kind", "campaign").eq("archived", false).order("start_date", { ascending: false, nullsFirst: false }).limit(100),
    supabase.from("collab_rates").select("*").eq("archived", false).order("sort"),
    edit && /^[0-9a-f-]{36}$/i.test(edit) ? supabase.from("collab_requests").select(REQUEST_COLUMNS).eq("id", edit).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const r = existing.data as unknown as CollabRequest | null;
  if (edit && (!r || !["requested", "changes"].includes(r.status))) redirect(edit ? `/collabs/${edit}` : "/collabs");
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Paid social", href: "/collabs" }, r ? r.brand : "New request"]}
        title={r ? "Edit the brief" : "Request content"}
        description="Tell Content what to promote and why. Links and extras are optional."
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <CollabRequestForm
          id={r?.id}
          campaigns={(campaigns ?? []) as { id: string; name: string }[]}
          initial={
            r
              ? {
                  brand: r.brand,
                  promote: r.promote,
                  goals: r.goals,
                  go_live: r.go_live,
                  budget: r.budget,
                  audience: r.audience,
                  key_message: r.key_message,
                  link: r.link ?? "",
                  refs: r.refs ?? "",
                  project_id: r.project_id ?? "",
                  notes: r.notes ?? "",
                }
              : undefined
          }
        />
        <div>
          <RateCard rates={(rates ?? []) as CollabRate[]} compact />
        </div>
      </div>
    </>
  );
}
