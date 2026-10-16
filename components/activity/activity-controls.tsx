"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

type Opt = { value: string; label: string };

export function ActivityControls({
  view,
  date,
  people,
  departments,
  person,
  dept,
}: {
  view: "person" | "team";
  date: string;
  people: Opt[] | null;
  departments: Opt[];
  person: string;
  dept: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  const sel = "h-9 field px-2 text-sm";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input type="date" aria-label="Date" value={date} onChange={(e) => e.target.value && set("date", e.target.value)} className="h-9 w-auto" />
      {view === "person" && people && (
        <select aria-label="Person" value={person} onChange={(e) => set("person", e.target.value)} className={`${sel} max-w-[14rem]`}>
          {people.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      )}
      {view === "team" && departments.length > 1 && (
        <select aria-label="Department" value={dept} onChange={(e) => set("dept", e.target.value)} className={sel}>
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
