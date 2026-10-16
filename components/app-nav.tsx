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
  TriangleAlert,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ThemeSwitcher } from "@/components/theme-switcher";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const MAIN: NavItem[] = [
  { href: "/my", label: "My Tasks", icon: CheckSquare },
  { href: "/tasks", label: "All Tasks", icon: List },
  { href: "/overdue", label: "Overdue", icon: TriangleAlert },
  { href: "/departments", label: "Departments", icon: Building2 },
  { href: "/meetings", label: "Meetings", icon: NotebookPen },
  { href: "/activity", label: "Activity", icon: Activity },
];

const ADMIN: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "People", icon: Users },
  { href: "/admin/departments", label: "Departments setup", icon: Settings },
];

// Bottom bar on phones: the four things people open most.
const MOBILE: NavItem[] = [
  { href: "/my", label: "My Tasks", icon: CheckSquare },
  { href: "/tasks", label: "Tasks", icon: List },
  { href: "/meetings", label: "Meetings", icon: NotebookPen },
  { href: "/activity", label: "Activity", icon: Activity },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  if (href === "/tasks") return pathname === "/tasks" || /^\/tasks\/(board|calendar|timeline)$/.test(pathname);
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLinks({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              isActive(pathname, item.href)
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
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
}: {
  isAdmin: boolean;
  name: string;
  email: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-6">
      <NavLinks items={MAIN} pathname={pathname} onNavigate={onNavigate} />
      {isAdmin && (
        <div>
          <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Admin</p>
          <NavLinks items={ADMIN} pathname={pathname} onNavigate={onNavigate} />
        </div>
      )}
      <div className="mt-auto space-y-2 border-t pt-4">
        <div className="px-3">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
        <div className="flex items-center justify-between px-1">
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
          <ThemeSwitcher />
        </div>
      </div>
    </div>
  );
}

export function AppNav({ isAdmin, name, email }: { isAdmin: boolean; name: string; email: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-muted/30 p-4 md:flex">
        <Link href="/my" className="mb-6 flex items-center gap-2 px-3 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">H</span>
          Highfy Tasks
        </Link>
        <NavBody isAdmin={isAdmin} name={name} email={email} pathname={pathname} />
      </aside>

      {/* Phone top bar */}
      <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
        <Link href="/my" className="flex items-center gap-2 font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-primary text-xs text-primary-foreground">H</span>
          Highfy Tasks
        </Link>
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="-mr-2 rounded-md p-2 hover:bg-accent"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-72 p-4">
          <SheetHeader className="p-0 pb-2">
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <NavBody isAdmin={isAdmin} name={name} email={email} pathname={pathname} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Phone bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-4">
          {MOBILE.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 text-[11px]",
                  isActive(pathname, item.href) ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
