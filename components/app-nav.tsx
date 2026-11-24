"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  Building2,
  CheckSquare,
  FolderKanban,
  LayoutList,
  LayoutDashboard,
  LogOut,
  Menu,
  Bell,
  NotebookPen,
  Settings,
  Sparkles,
  CalendarSync,
  Images,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { HighfyLogo } from "@/components/brand";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; dot?: string };

// Tasks opens on My tasks, with My team as a tab inside it.
const MAIN: NavItem[] = [
  { href: "/my", label: "Tasks", icon: CheckSquare },
  { href: "/tasks", label: "All teams", icon: LayoutList },
  { href: "/meetings", label: "Meetings", icon: NotebookPen },
  // Tasks given to you, comments, mentions, finished work, reminders.
  { href: "/notifications", label: "Notifications", icon: Bell },
];

// Domains: each with its tag colour.
const DOMAIN_ITEMS: NavItem[] = [
  { href: "/projects", label: "Projects", icon: FolderKanban, dot: "#9B3DB0" },
  { href: "/campaigns", label: "Campaigns", icon: FolderKanban, dot: "#F2A15F" },
  { href: "/partnerships", label: "Brand partnerships", icon: FolderKanban, dot: "#2E9C74" },
  // What's on the homepage banners each day, month by month.
  { href: "/daily-deals", label: "Daily deals", icon: FolderKanban, dot: "#2F6FD6" },
];

const FOOT: NavItem[] = [{ href: "/activity", label: "Activity", icon: Activity }];

const ADMIN: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/departments", label: "Teams", icon: Building2 },
  { href: "/admin/users", label: "People", icon: Users },
  { href: "/admin/assistant", label: "Meeting assistant", icon: Sparkles },
  { href: "/admin/outlook", label: "Outlook", icon: CalendarSync },
  { href: "/admin/placements", label: "Placements", icon: Images },
];

// Only for the teams that book, design and put up homepage banners.
const PLACEMENTS: NavItem = { href: "/placements", label: "Placements", icon: Images, dot: "#C2417A" };
// Commercial asks Content for brand content; Content plans, delivers and reports.
const COLLABS: NavItem = { href: "/collabs", label: "Paid social", icon: Images, dot: "#0F6E6E" };

// Bottom bar on phones: the four things people open most.
const MOBILE: NavItem[] = [
  { href: "/my", label: "Tasks", icon: CheckSquare },
  { href: "/tasks", label: "All teams", icon: LayoutList },
  { href: "/campaigns", label: "Campaigns", icon: FolderKanban },
  { href: "/meetings", label: "Meetings", icon: NotebookPen },
];

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === href;
  // All teams is the list itself; task pages and My team sit under Tasks.
  if (href === "/tasks") return pathname === "/tasks" || /^\/tasks\/(board|calendar)$/.test(pathname);
  if (href === "/my") return under(pathname, "/my") || under(pathname, "/overdue") || (under(pathname, "/tasks") && !isActive(pathname, "/tasks"));
  return under(pathname, href);
}

type Badges = Record<string, number>;

function NavLinks({
  items,
  pathname,
  onNavigate,
  badges = {},
  collapsed = false,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
  badges?: Badges;
  /** Icons only (the folded sidebar); the name shows on hover. */
  collapsed?: boolean;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            prefetch
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            aria-label={collapsed ? item.label : undefined}
            className={cn(
              "relative flex items-center gap-3 rounded-[12px] py-2 text-[15px] font-medium transition-colors",
              collapsed ? "justify-center px-0" : "px-3",
              isActive(pathname, item.href)
                ? "bg-brand-primary font-semibold text-white"
                : "text-ink-muted hover:bg-subtle hover:text-ink",
            )}
          >
            {item.dot ? (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: item.dot }} />
              </span>
            ) : (
              <item.icon className="h-4 w-4 shrink-0" />
            )}
            {collapsed ? (
              (!!badges[item.href] || (item.href === "/my" && !!badges["/overdue"])) && (
                <span aria-hidden className={cn("absolute right-2 top-1.5 h-2 w-2 rounded-full", item.href === "/my" ? "bg-danger" : "bg-brand-primary", isActive(pathname, item.href) && "bg-white")} />
              )
            ) : (
              <span className="flex-1">{item.label}</span>
            )}
            {!collapsed && item.href === "/my" && !!badges["/overdue"] && (
              <span
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-center text-xs font-semibold leading-5",
                  isActive(pathname, item.href) ? "bg-white/25 text-white" : "bg-danger-soft text-danger-ink",
                )}
                aria-label={`${badges["/overdue"]} overdue`}
              >
                {badges["/overdue"]}
              </span>
            )}
            {!collapsed && !!badges[item.href] && (
              <span
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-center text-xs font-semibold leading-5",
                  isActive(pathname, item.href) ? "bg-white/25 text-white" : "bg-brand-primary text-white",
                )}
                aria-label={item.href === "/placements" ? `${badges[item.href]} to do` : `${badges[item.href]} unread`}
              >
                {badges[item.href]}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NavBody({
  isAdmin,
  placements,
  collabs = false,
  name,
  email,
  pathname,
  onNavigate,
  badges,
  collapsed = false,
}: {
  isAdmin: boolean;
  placements: boolean;
  collabs?: boolean;
  name: string;
  email: string;
  pathname: string;
  onNavigate?: () => void;
  badges?: Badges;
  collapsed?: boolean;
}) {
  const heading = (text: string) =>
    collapsed ? <div className="mx-2 mb-1 border-t border-line" aria-hidden /> : <p className="mb-1 px-3 text-xs font-medium text-ink-muted">{text}</p>;
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto">
      <div className="space-y-4">
        <NavLinks items={MAIN} pathname={pathname} onNavigate={onNavigate} badges={badges} collapsed={collapsed} />
        <div>
          {heading("Domains")}
          <NavLinks items={[...DOMAIN_ITEMS, ...(placements ? [PLACEMENTS] : []), ...(collabs ? [COLLABS] : [])]} pathname={pathname} onNavigate={onNavigate} badges={badges} collapsed={collapsed} />
        </div>
        <div className="border-t border-line pt-4">
          <NavLinks items={FOOT} pathname={pathname} onNavigate={onNavigate} badges={badges} collapsed={collapsed} />
        </div>
      </div>
      {isAdmin && (
        <div>
          {heading("Admin")}
          <NavLinks items={ADMIN} pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} />
        </div>
      )}
      <div className="mt-auto space-y-2 border-t border-line pt-4">
        {!collapsed && (
          <div className="px-3">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          </div>
        )}
        <Link
          href="/settings"
          onClick={onNavigate}
          title={collapsed ? "My settings" : undefined}
          aria-label={collapsed ? "My settings" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-[12px] py-1.5 text-sm font-medium text-ink-muted hover:bg-subtle hover:text-ink",
            collapsed ? "justify-center px-0" : "px-3",
          )}
        >
          <Settings className="h-4 w-4" /> {!collapsed && "My settings"}
        </Link>
        <form action="/auth/signout" method="post" className={collapsed ? "" : "px-1"}>
          <button
            type="submit"
            title={collapsed ? "Sign out" : undefined}
            aria-label={collapsed ? "Sign out" : undefined}
            className={cn("flex items-center gap-2 rounded-[12px] py-1.5 text-sm font-medium text-ink hover:bg-subtle", collapsed ? "w-full justify-center px-0" : "px-2")}
          >
            <LogOut className="h-4 w-4" /> {!collapsed && "Sign out"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function AppNav({
  isAdmin,
  placements = false,
  collabs = false,
  name,
  email,
  badges,
  startCollapsed = false,
}: {
  isAdmin: boolean;
  placements?: boolean;
  collabs?: boolean;
  name: string;
  email: string;
  badges?: Badges;
  /** The folded sidebar, as the person last left it (a cookie, so there's no flicker). */
  startCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const fold = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `nav_collapsed=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className={cn("sticky top-0 hidden h-svh shrink-0 flex-col border-r border-line bg-white md:flex", collapsed ? "w-16 px-2 py-4" : "w-60 p-4")}>
        <div className={cn("mb-6 flex items-center", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <Link href="/my" className="flex items-end gap-2 px-3" aria-label="Highfy Tasks home">
              <HighfyLogo className="w-24" />
              <span className="pb-1 text-sm font-semibold text-ink-muted">Tasks</span>
            </Link>
          )}
          <button
            type="button"
            onClick={fold}
            aria-label={collapsed ? "Open the sidebar" : "Collapse the sidebar"}
            title={collapsed ? "Open the sidebar" : "Collapse the sidebar"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-ink-muted hover:bg-subtle hover:text-ink"
          >
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          </button>
        </div>
        <NavBody isAdmin={isAdmin} placements={placements} collabs={collabs} name={name} email={email} pathname={pathname} badges={badges} collapsed={collapsed} />
      </aside>

      {/* Phone top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-white/95 px-4 backdrop-blur md:hidden">
        <Link href="/my" className="flex items-end gap-2" aria-label="Highfy Tasks home">
          <HighfyLogo className="w-[72px]" />
          <span className="pb-0.5 text-sm font-semibold text-ink-muted">Tasks</span>
        </Link>
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="-mr-2 rounded-[12px] p-2 text-ink hover:bg-subtle"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-72 bg-white p-4">
          <SheetHeader className="p-0 pb-2">
            <SheetTitle className="text-ink">Menu</SheetTitle>
          </SheetHeader>
          <NavBody isAdmin={isAdmin} placements={placements} collabs={collabs} name={name} email={email} pathname={pathname} onNavigate={() => setOpen(false)} badges={badges} />
        </SheetContent>
      </Sheet>

      {/* Phone bottom tabs */}
      <nav className="phone-tabbar fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-4">
          {MOBILE.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                  isActive(pathname, item.href) ? "font-semibold text-brand-primary" : "text-ink-muted",
                )}
              >
                <span className="relative">
                  <item.icon className="h-5 w-5" />
                  {!!badges?.[item.href] && <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-brand-primary" />}
                </span>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
