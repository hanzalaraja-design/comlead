"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";

/** Status, tag and search for the partnerships list; kept in the address so links and Back work. */
export function PartnershipFilters({ tags, path }: { tags: { id: string; name: string; category: string }[]; path: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const go = (key: string, value: string) => {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    const s = p.toString();
    router.replace(s ? `${path}?${s}` : path, { scroll: false });
  };
  // Search as you type, after a short pause.
  useEffect(() => {
    if ((sp.get("q") ?? "") === q) return;
    const t = setTimeout(() => go("q", q.trim()), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const select = "h-9 rounded-full border border-line bg-white px-3 text-sm text-ink";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Status" value={sp.get("status") ?? ""} onChange={(e) => go("status", e.target.value)} className={select}>
        <option value="">Status: any</option>
        <option value="live">Live</option>
        <option value="ending">Ending in 30 days</option>
        <option value="agreed">Agreed</option>
        <option value="in_talks">In talks</option>
        <option value="draft">Draft</option>
        <option value="none">No terms yet</option>
        <option value="ended">Ended</option>
      </select>
      <select aria-label="Tag" value={sp.get("tag") ?? ""} onChange={(e) => go("tag", e.target.value)} className={select}>
        <option value="">Tags: any</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <label className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-sm">
        <Search className="h-4 w-4 text-ink-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search partnerships" aria-label="Search partnerships" className="w-40 bg-transparent outline-none" />
      </label>
    </div>
  );
}
