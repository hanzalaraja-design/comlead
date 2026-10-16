"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Bookmark, X } from "lucide-react";
import { toast } from "sonner";
import type { SavedView } from "@/lib/types";
import { deleteView } from "@/app/(app)/tasks/actions";

export function SavedViews({ views }: { views: SavedView[] }) {
  const [, startTransition] = useTransition();
  if (!views.length) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Bookmark className="h-3 w-3" /> My views:
      </span>
      {views.map((v) => (
        <span key={v.id} className="inline-flex items-center rounded-full bg-muted text-xs">
          <Link href={v.path} className="py-1 pl-3 pr-1 hover:underline">
            {v.name}
          </Link>
          <button
            type="button"
            aria-label={`Delete view ${v.name}`}
            className="rounded-full p-1 pr-2 text-muted-foreground hover:text-foreground"
            onClick={() =>
              startTransition(async () => {
                const res = await deleteView(v.id);
                if (!res.ok) toast.error(res.error);
              })
            }
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
