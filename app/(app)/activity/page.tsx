import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { PersonAvatar } from "@/components/person-avatar";
import { ActivityControls } from "@/components/activity/activity-controls";
import { activityHref, describeActivity, summarizeActivity } from "@/lib/activity";
import { canLead, getDepartments, getPeople, requireViewer } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, formatDate, formatPKT, isISODate, startOfDayPKT, todayPKT } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ActivityEntry, PersonRef } from "@/lib/types";

export const metadata = { title: "Activity · Highfy Tasks" };

const UUID_RE = /^[0-9a-f-]{36}$/i;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; person?: string; dept?: string }>;
}) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const supabase = await createClient();

  // Members see only their own activity; Leads their departments; Admin all.
  const canSeeOthers = viewer.isAdmin || viewer.isAnyLead;
  const view = canSeeOthers && sp.view === "team" ? "team" : "person";
  const date = isISODate(sp.date) ? sp.date : todayPKT();
  const person = canSeeOthers && sp.person && UUID_RE.test(sp.person) ? sp.person : viewer.id;

  const [people, departments] = await Promise.all([getPeople(), getDepartments()]);
  const peopleById = new Map<string, PersonRef>(people.map((p) => [p.id, p]));
  const lookup = { person: (id: unknown) => (typeof id === "string" ? peopleById.get(id) ?? null : null) };
  const visibleDepts = departments.filter((d) => canLead(viewer, d.id));
  const dept = visibleDepts.find((d) => d.slug === sp.dept);

  let query = supabase
    .from("activity_log")
    .select("*")
    .gte("created_at", startOfDayPKT(date))
    .lt("created_at", startOfDayPKT(addDaysISO(date, 1)))
    .order("created_at", { ascending: true })
    .limit(2000);
  if (view === "person") query = query.eq("actor_id", person);
  if (view === "team" && dept) query = query.eq("department_id", dept.id);
  const { data, error } = await query;
  const entries = (data ?? []) as ActivityEntry[];

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { view, date, person: view === "person" ? person : undefined, dept: sp.dept, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/activity?${p.toString()}`;
  };

  // Team view: group by person.
  const byActor = new Map<string, ActivityEntry[]>();
  if (view === "team") {
    for (const e of entries) {
      const key = e.actor_id ?? "system";
      if (!byActor.has(key)) byActor.set(key, []);
      byActor.get(key)!.push(e);
    }
  }

  return (
    <>
      <PageHeader
        title="Activity"
        description={formatDate(date, "EEEE d MMMM yyyy")}
        actions={
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="icon" aria-label="Previous day">
              <Link href={link({ date: addDaysISO(date, -1) })}>
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={link({ date: todayPKT() })}>Today</Link>
            </Button>
            <Button asChild variant="outline" size="icon" aria-label="Next day">
              <Link href={link({ date: addDaysISO(date, 1) })}>
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        }
      />

      {canSeeOthers && (
        <nav className="mb-4 inline-flex rounded-lg border p-0.5 text-sm">
          {(["person", "team"] as const).map((v) => (
            <Link
              key={v}
              href={link({ view: v, person: v === "person" ? person : undefined })}
              className={cn("rounded-md px-3 py-1.5", view === v ? "bg-accent font-medium" : "text-muted-foreground")}
            >
              {v === "person" ? "By person" : "Team"}
            </Link>
          ))}
        </nav>
      )}

      <Suspense>
        <ActivityControls
          view={view}
          date={date}
          person={person}
          dept={sp.dept ?? ""}
          people={canSeeOthers ? people.map((p) => ({ value: p.id, label: personName(p) })) : null}
          departments={visibleDepts.map((d) => ({ value: d.slug, label: d.name }))}
        />
      </Suspense>

      {error && <p className="mb-3 text-sm text-red-600">{error.message}</p>}

      {view === "person" ? (
        <>
          <div className="mb-4 flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
            <PersonAvatar person={peopleById.get(person)} className="h-10 w-10 text-sm" />
            <div>
              <p className="font-medium">{personName(peopleById.get(person))}</p>
              <p className="text-sm text-muted-foreground">{summarizeActivity(entries)}</p>
            </div>
          </div>
          {entries.length === 0 ? (
            <EmptyState>Nothing recorded {date === todayPKT() ? "yet today" : "on this day"}.</EmptyState>
          ) : (
            <Timeline entries={entries} lookup={lookup} />
          )}
        </>
      ) : byActor.size === 0 ? (
        <EmptyState>No activity on this day.</EmptyState>
      ) : (
        <div className="space-y-6">
          {[...byActor.entries()]
            .sort((a, b) => b[1].length - a[1].length)
            .map(([actor, list]) => {
              const p = peopleById.get(actor);
              return (
                <section key={actor} className="rounded-lg border">
                  <Link
                    href={link({ view: "person", person: actor === "system" ? undefined : actor })}
                    className="flex items-center gap-3 border-b p-3 hover:bg-muted/40"
                  >
                    <PersonAvatar person={p} className="h-8 w-8" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{actor === "system" ? "System" : personName(p)}</p>
                      <p className="text-xs text-muted-foreground">{summarizeActivity(list)}</p>
                    </div>
                  </Link>
                  <div className="p-3">
                    <Timeline entries={list} lookup={lookup} />
                  </div>
                </section>
              );
            })}
        </div>
      )}
    </>
  );
}

function Timeline({ entries, lookup }: { entries: ActivityEntry[]; lookup: Parameters<typeof describeActivity>[1] }) {
  return (
    <ol className="space-y-2">
      {entries.map((e) => {
        const href = activityHref(e);
        const text = describeActivity(e, lookup);
        return (
          <li key={e.id} className="flex gap-3 text-sm">
            <time className="w-16 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{formatPKT(e.created_at, "h:mm a")}</time>
            {href ? (
              <Link href={href} className="min-w-0 hover:underline">
                {text}
              </Link>
            ) : (
              <span className="min-w-0">{text}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
