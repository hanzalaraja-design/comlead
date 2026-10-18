"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  Building2,
  CheckSquare,
  LayoutDashboard,
  List,
  LogOut,
  Menu,
  NotebookPen,
  Settings,
  Sparkles,
  CalendarSync,
  TriangleAlert,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { HighfyLogo } from "@/components/brand";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const MAIN: NavItem[] = [
  { href: "/my", label: "My tasks", icon: CheckSquare },
  { href: "/tasks", label: "All tasks", icon: List },
  { href: "/overdue", label: "Overdue", icon: TriangleAlert },
  { href: "/departments", label: "Departments", icon: Building2 },
  { href: "/meetings", label: "Meetings", icon: NotebookPen },
  { href: "/activity", label: "Activity", icon: Activity },
];

const ADMIN: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "People", icon: Users },
  { href: "/admin/assistant", label: "Meeting assistant", icon: Sparkles },
  { href: "/admin/outlook", label: "Outlook", icon: CalendarSync },
];

// Bottom bar on phones: the four things people open most.
const MOBILE: NavItem[] = [
  { href: "/my", label: "My tasks", icon: CheckSquare },
  { href: "/tasks", label: "Tasks", icon: List },
  { href: "/meetings", label: "Meetings", icon: NotebookPen },
  { href: "/activity", label: "Activity", icon: Activity },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  if (href === "/tasks") return pathname === "/tasks" || /^\/tasks\/(board|calendar|timeline)$/.test(pathname);
  return pathname === href || pathname.startsWith(href + "/");
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
            {!!badges[item.href] && (
              <span
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-center text-xs font-semibold leading-5",
                  isActive(pathname, item.href)
                    ? "bg-white/25 text-white"
                    : item.href === "/overdue"
                      ? "bg-danger-soft text-danger-ink"
                      : "bg-brand-primary text-white",
                )}
                aria-label={item.href === "/overdue" ? `${badges[item.href]} overdue` : `${badges[item.href]} new mentions`}
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
  name,
  email,
  pathname,
  onNavigate,
  badges,
}: {
  isAdmin: boolean;
  name: string;
  email: string;
  pathname: string;
  onNavigate?: () => void;
  badges?: Badges;
}) {
  return (
    <div className="flex h-full flex-col gap-6">
      <NavLinks items={MAIN} pathname={pathname} onNavigate={onNavigate} badges={badges} />
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

export function AppNav({ isAdmin, name, email, badges }: { isAdmin: boolean; name: string; email: string; badges?: Badges }) {
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
        <NavBody isAdmin={isAdmin} name={name} email={email} pathname={pathname} badges={badges} />
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
          <NavBody isAdmin={isAdmin} name={name} email={email} pathname={pathname} onNavigate={() => setOpen(false)} badges={badges} />
        </SheetContent>
      </Sheet>

      {/* Phone bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-4">
          {MOBILE.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
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
