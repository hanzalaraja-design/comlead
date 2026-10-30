import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { PlacementsBoard } from "@/components/placements/placements-board";
import { ChannelRequests, DesignRequests, type LinkOption, type WebItem } from "@/components/placements/requests";
import { getPeople, requireViewer } from "@/lib/auth";
import { CHANNELS, CREATIVE_COLUMNS, designerGroups, isChannel, isOpen, upForGrabs, type Channel, type CreativeRequest } from "@/lib/creative";
import { getProjects } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import { PLACEMENT_COLUMNS, slotName, surfacesText, toDesign, type Placement, type PlacementRole, type Section } from "@/lib/placements";
import { formatDate, todayPKT } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Placements · Highfy Tasks" };

type Tab = "web" | Channel | "design";

export default async function PlacementsPage({ searchParams }: { searchParams: Promise<{ open?: string; tab?: string }> }) {
  const [viewer, supabase, sp] = await Promise.all([requireViewer(), createClient(), searchParams]);
  const today = todayPKT();
  const [{ data: roleData }, { data: sectionData }, { data: placementData }, { data: settings }, requestsRes] = await Promise.all([
    supabase.rpc("placement_roles"),
    supabase.from("placement_sections").select("*").eq("surface", "web").eq("archived", false).order("sort"),
    supabase.from("placements").select(PLACEMENT_COLUMNS).neq("stage", "ended").order("starts_on"),
    supabase.from("placement_settings").select("commercial_department_id, design_department_id, tech_department_id").eq("id", 1).maybeSingle(),
    // Creative requests (empty if the database hasn't got them yet).
    supabase
      .from("creative_requests")
      .select(CREATIVE_COLUMNS)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(500)
      .then((r) => (r.error ? { data: [] } : r)),
  ]);
  const roles = ((roleData ?? []) as PlacementRole[]).sort(
    (a, b) => ["commercial", "design", "tech"].indexOf(a) - ["commercial", "design", "tech"].indexOf(b),
  );
  const requests = (requestsRes.data ?? []) as unknown as CreativeRequest[];
  const placements = (placementData ?? []) as unknown as Placement[];

  const isDesign = roles.includes("design");
  const designDept = settings?.design_department_id ?? null;
  const canAssign = viewer.isAdmin || (!!designDept && viewer.leadDeptIds.includes(designDept));
  // Designers open on their list; everyone else on App / Website.
  const tab: Tab = isChannel(sp.tab) ? sp.tab : sp.tab === "web" ? "web" : isDesign && (sp.tab === "design" || !viewer.isAdmin) ? "design" : "web";
  const openId = sp.open && /^[0-9a-f-]{36}$/.test(sp.open) ? sp.open : null;

  // Counts on the tabs: what's open, and for Design what needs them.
  const openIn = (c: Channel) => requests.filter((r) => r.channel === c && isOpen(r)).length;
  const g = designerGroups(requests, viewer.id, today);
  const designCount = g.due.length + g.changes.length + upForGrabs(requests).length;
  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: "web", label: "App / Website", n: 0 },
    ...CHANNELS.map((c) => ({ key: c.key as Tab, label: c.label, n: openIn(c.key) })),
    ...(isDesign ? [{ key: "design" as const, label: "Design", n: designCount }] : []),
  ];

  const nav = (
    <nav aria-label="Placements" className="no-scrollbar -mx-4 mb-5 flex gap-5 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`/placements?tab=${t.key}`}
          aria-current={tab === t.key ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-1 text-[15px] font-semibold",
            tab === t.key ? "border-brand-primary text-ink" : "border-transparent text-ink-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.n > 0 && <span className="rounded-full bg-brand-bg px-1.5 text-xs text-brand-primary">{t.n}</span>}
        </Link>
      ))}
    </nav>
  );

  const header = (
    <PageHeader
      breadcrumb={["Placements", tabs.find((t) => t.key === tab)!.label]}
      title="Placements"
      description="The website and app, and everything Design makes for Social, Ads, CRM and Partnerships."
    />
  );
  const sections = (sectionData ?? []) as Section[];

  if (tab !== "web") {
    const [people, projects, designMembers] = await Promise.all([
      getPeople(),
      getProjects(),
      designDept ? supabase.from("department_members").select("user_id").eq("department_id", designDept) : Promise.resolve({ data: [] }),
    ]);
    const shown = tab === "design" ? requests : requests.filter((r) => r.channel === tab);
    const paths = shown.flatMap((r) => [...r.ref_paths, ...r.art_paths]);
    const { data: signed } = paths.length
      ? await supabase.storage.from("placement-files").createSignedUrls(paths, 3600)
      : { data: [] as { path: string | null; signedUrl: string }[] };
    const urls = Object.fromEntries((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path!, s.signedUrl as string]));
    const designerIds = new Set(((designMembers.data ?? []) as { user_id: string }[]).map((m) => m.user_id));
    const shared = {
      people,
      links: projects.filter((p) => !p.archived).map((p): LinkOption => ({ id: p.id, name: p.name, kind: p.kind })),
      urls,
      viewerId: viewer.id,
      isDesign,
      canAssign,
      designers: people.filter((p) => designerIds.has(p.id)),
      today,
    };
    // Homepage banners Design still has to make sit in the same list.
    const web: WebItem[] = toDesign(placements).map((p) => {
      const s = sections.find((x) => x.key === p.section_key);
      return {
        id: p.id,
        title: `${p.brand} · ${s ? slotName(s, p.position) : "Homepage"}`,
        sub: `${surfacesText(p.shows_on?.length ? p.shows_on : ["web"])} · ${p.changed_from ? "text changed, needs an update" : `live ${formatDate(p.starts_on, "EEE d MMM")}`}`,
        due: p.starts_on,
        late: p.starts_on <= today,
      };
    });
    return (
      <>
        {header}
        {nav}
        {tab === "design" ? (
          <DesignRequests requests={shown} web={web} openId={openId} {...shared} />
        ) : (
          <ChannelRequests key={tab} channel={tab} requests={shown} openId={openId} {...shared} />
        )}
      </>
    );
  }

  const paths = placements.flatMap((p) => [...p.inspo_paths, ...(p.artwork_path ? [p.artwork_path] : [])]);
  const { data: signed } = paths.length
    ? await supabase.storage.from("placement-files").createSignedUrls(paths, 3600)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urls = Object.fromEntries((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path!, s.signedUrl as string]));

  // Open on the job of the team you're actually in.
  const teamOf: Record<PlacementRole, string | null | undefined> = {
    commercial: settings?.commercial_department_id,
    design: settings?.design_department_id,
    tech: settings?.tech_department_id,
  };
  const defaultRole = roles.find((r) => r !== "commercial" && teamOf[r] && viewer.memberDeptIds.includes(teamOf[r]!)) ?? "commercial";
  const unset = (["commercial", "design", "tech"] as const).filter((r) => !teamOf[r]);

  return (
    <>
      {header}
      {nav}
      {viewer.isAdmin && unset.length > 0 && (
        <p className="mb-4 rounded-[14px] bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          Pick which team is {unset.join(", ")} in{" "}
          <Link href="/admin/placements" className="font-semibold underline">
            Admin · Placements
          </Link>{" "}
          so the right people get the emails.
        </p>
      )}
      <PlacementsBoard
        sections={sections}
        placements={placements}
        urls={urls}
        roles={roles.length ? roles : ["commercial"]}
        defaultRole={defaultRole}
        today={today}
        openId={openId}
      />
    </>
  );
}
