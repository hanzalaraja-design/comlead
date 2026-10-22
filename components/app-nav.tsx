"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  Building2,
  CheckSquare,
  LayoutDashboard,
  LogOut,
  Menu,
  NotebookPen,
  Settings,
  Sparkles,
  CalendarSync,
  Images,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { HighfyLogo } from "@/components/brand";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

// Tasks opens on My tasks; My team and All teams are tabs inside it.
const MAIN: NavItem[] = [
  { href: "/my", label: "Tasks", icon: CheckSquare },
  { href: "/meetings", label: "Meetings", icon: NotebookPen },
  { href: "/activity", label: "Activity", icon: Activity },
];

const ADMIN: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/departments", label: "Teams", icon: Building2 },
  { href: "/admin/users", label: "People", icon: Users },
  { href: "/admin/assistant", label: "Meeting assistant", icon: Sparkles },
  { href: "/admin/outlook", label: "Outlook", icon: CalendarSync },
  { href: "/admin/placements", label: "Placements", icon: Images },
];

// Only for the teams that book, design and put up homepage banners.
const PLACEMENTS: NavItem = { href: "/placements", label: "Placements", icon: Images };

// Bottom bar on phones: the four things people open most.
const MOBILE: NavItem[] = [
  { href: "/my", label: "Tasks", icon: CheckSquare },
  { href: "/tasks/team", label: "My team", icon: Users },
  { href: "/meetings", label: "Meetings", icon: NotebookPen },
  { href: "/activity", label: "Activity", icon: Activity },
];

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

function isActive(pathname: string, href: string, phone = false) {
  if (href === "/admin") return pathname === href;
  // Every task page sits under Tasks; on phones My team has its own tab.
  if (href === "/my") return under(pathname, "/my") || under(pathname, "/overdue") || under(pathname, "/projects") || (under(pathname, "/tasks") && !(phone && under(pathname, "/tasks/team")));
  return under(pathname, href);
}

type Badges = Record<string, number>;

function NavLinks({
  items,
  pathname,
  onNavigate,
  badges = {},
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
  badges?: Badges;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            prefetch
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-[12px] px-3 py-2 text-[15px] font-medium transition-colors",
              isActive(pathname, item.href)
                ? "bg-brand-primary font-semibold text-white"
                : "text-ink-muted hover:bg-subtle hover:text-ink",
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.href === "/my" && !!badges["/overdue"] && (
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
            {!!badges[item.href] && (
              <span
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-center text-xs font-semibold leading-5",
                  isActive(pathname, item.href) ? "bg-white/25 text-white" : "bg-brand-primary text-white",
                )}
                aria-label={item.href === "/placements" ? `${badges[item.href]} to do` : `${badges[item.href]} new mentions`}
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
  name,
  email,
  pathname,
  onNavigate,
  badges,
}: {
  isAdmin: boolean;
  placements: boolean;
  name: string;
  email: string;
  pathname: string;
  onNavigate?: () => void;
  badges?: Badges;
}) {
  return (
    <div className="flex h-full flex-col gap-6">
      <NavLinks items={placements ? [...MAIN, PLACEMENTS] : MAIN} pathname={pathname} onNavigate={onNavigate} badges={badges} />
      {isAdmin && (
        <div>
          <p className="mb-1 px-3 text-xs font-medium text-ink-muted">Admin</p>
          <NavLinks items={ADMIN} pathname={pathname} onNavigate={onNavigate} />
        </div>
      )}
      <div className="mt-auto space-y-2 border-t border-line pt-4">
        <div className="px-3">
          <p className="truncate text-sm font-semibold text-ink">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
        <Link
          href="/settings"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-[12px] px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-subtle hover:text-ink"
        >
          <Settings className="h-4 w-4" /> My settings
        </Link>
        <form action="/auth/signout" method="post" className="px-1">
          <button
            type="submit"
            className="flex items-center gap-2 rounded-[12px] px-2 py-1.5 text-sm font-medium text-ink hover:bg-subtle"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

export function AppNav({
  isAdmin,
  placements = false,
  name,
  email,
  badges,
}: {
  isAdmin: boolean;
  placements?: boolean;
  name: string;
  email: string;
  badges?: Badges;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r border-line bg-white p-4 md:flex">
        <Link href="/my" className="mb-6 flex items-end gap-2 px-3" aria-label="Highfy Tasks home">
          <HighfyLogo className="w-24" />
          <span className="pb-1 text-sm font-semibold text-ink-muted">Tasks</span>
        </Link>
        <NavBody isAdmin={isAdmin} placements={placements} name={name} email={email} pathname={pathname} badges={badges} />
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
          <NavBody isAdmin={isAdmin} placements={placements} name={name} email={email} pathname={pathname} onNavigate={() => setOpen(false)} badges={badges} />
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
                  isActive(pathname, item.href, true) ? "font-semibold text-brand-primary" : "text-ink-muted",
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
