"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Opt = { value: string; label: string };

/** Search + department / date range / attendee filters, all in the URL. */
export function MeetingFilters({ departments, people }: { departments: Opt[]; people: Opt[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const s = next.toString();
    startTransition(() => router.push(pathname + (s ? `?${s}` : ""), { scroll: false }));
  }

  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => set("q", q.trim()), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const sel = "h-9 field px-2 text-sm";

  return (
    <div className="mb-4 space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all minutes and agendas…" className="h-10 pl-8" />
      </div>
      <div className="flex flex-wrap gap-2">
        {departments.length > 1 && (
          <select aria-label="Team" value={params.get("dept") ?? ""} onChange={(e) => set("dept", e.target.value)} className={sel}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Attendee" value={params.get("attendee") ?? ""} onChange={(e) => set("attendee", e.target.value)} className={`${sel} max-w-[12rem]`}>
          <option value="">Any attendee</option>
          {people.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          From
          <Input type="date" value={params.get("from") ?? ""} onChange={(e) => set("from", e.target.value)} className="h-9 w-auto" />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          To
          <Input type="date" value={params.get("to") ?? ""} onChange={(e) => set("to", e.target.value)} className="h-9 w-auto" />
        </label>
      </div>
    </div>
  );
}
