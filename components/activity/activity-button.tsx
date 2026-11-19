"use client";

import { History } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export type ActivityLine = { id: string | number; who: string; text: string; when: string };

/**
 * A small clock button that opens the item's activity: who changed what, and
 * when. Used on tasks, and on anything else that keeps a history.
 */
export function ActivityButton({ lines, about = "this task" }: { lines: ActivityLine[]; about?: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Activity"
          title="Activity"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-line bg-white text-ink-muted hover:text-ink"
        >
          <History className="h-4 w-4" />
        </button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Activity</SheetTitle>
          <SheetDescription>Everything that changed on {about}, newest first.</SheetDescription>
        </SheetHeader>
        {lines.length ? (
          <ol className="space-y-3 px-4 pb-6">
            {lines.map((l) => (
              <li key={l.id} className="flex gap-2.5 text-sm">
                <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-line" />
                <span className="min-w-0">
                  <span className="font-medium text-ink">{l.who}</span> <span className="text-ink-muted">{l.text}</span>
                  <span className="block text-xs text-ink-muted">{l.when}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-4 text-sm text-ink-muted">Nothing yet.</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
