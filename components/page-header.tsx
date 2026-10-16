import Link from "next/link";
import { CrownMark } from "@/components/brand";
import { cn } from "@/lib/utils";

export type Crumb = string | { label: string; href: string };

/**
 * Every page: breadcrumb eyebrow, headline, crown top-right (brand guide §3).
 * On phones the breadcrumb keeps its last two levels.
 */
export function PageHeader({
  breadcrumb = [],
  title,
  description,
  actions,
}: {
  breadcrumb?: Crumb[];
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const crumbs = breadcrumb.slice(0, 4);
  return (
    <header className="mb-6">
      <div className="flex items-start justify-between gap-3">
        <nav aria-label="Breadcrumb" className="min-w-0 text-xs font-semibold text-brand-primary md:text-[13px]">
          {crumbs.map((c, i) => {
            const label = typeof c === "string" ? c : c.label;
            const hiddenOnPhone = i < crumbs.length - 2;
            return (
              <span key={i} className={cn(hiddenOnPhone && "hidden md:inline")}>
                {i > 0 && <span className={cn("px-1 opacity-60", i === crumbs.length - 2 && "hidden md:inline")}>/</span>}
                {typeof c === "string" ? label : (
                  <Link href={c.href} className="hover:underline">
                    {label}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>
        <CrownMark />
      </div>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight text-brand-primary md:text-[32px]">{title}</h1>
          {description && <p className="mt-1 text-[13px] font-medium text-brand-primary-deep/70">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** One plain sentence and, optionally, one button. */
export function EmptyState({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="surface flex flex-col items-center gap-3 p-8 text-center text-[15px] text-brand-primary-deep">
      <p>{children}</p>
      {action}
    </div>
  );
}
