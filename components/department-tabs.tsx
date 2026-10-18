import Link from "next/link";
import { cn } from "@/lib/utils";

export function DepartmentTabs({ slug, active }: { slug: string; active: "board" | "list" | "meetings" | "team" }) {
  const tabs = [
    { key: "board", label: "Board", href: `/departments/${slug}` },
    { key: "list", label: "List", href: `/tasks?dept=${slug}` },
    { key: "meetings", label: "Meetings", href: `/meetings?dept=${slug}` },
    { key: "team", label: "People", href: `/departments/${slug}/team` },
  ] as const;
  return (
    <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b px-4 md:mx-0 md:px-0">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn(
            "whitespace-nowrap border-b-2 px-3 py-2 text-sm",
            active === t.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
