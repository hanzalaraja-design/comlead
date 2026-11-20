"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Before linking a meeting: move its existing action items too? And for a
 * recurring meeting, link every future one in the series?
 */
export function LinkConfirm({
  open,
  title,
  projectName,
  unlinkedItems,
  recurring,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  projectName: string;
  unlinkedItems: number;
  recurring: boolean;
  pending?: boolean;
  onConfirm: (o: { move: boolean; series: boolean }) => void;
  onCancel: () => void;
}) {
  const [series, setSeries] = useState(true);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {unlinkedItems > 0
              ? `It already has ${unlinkedItems} action item${unlinkedItems === 1 ? "" : "s"}. Move ${unlinkedItems === 1 ? "it" : "them"} into ${projectName}'s tasks too? New action items will go there on their own.`
              : `New action items will go into ${projectName}'s tasks on their own.`}
          </DialogDescription>
        </DialogHeader>
        {recurring && (
          <label className="flex items-center gap-2.5 text-sm text-ink">
            <input type="checkbox" checked={series} onChange={(e) => setSeries(e.target.checked)} className="size-4 accent-[hsl(var(--brand-primary))]" />
            Also link every future meeting in this series
          </label>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {unlinkedItems > 0 && (
            <Button variant="outline" disabled={pending} onClick={() => onConfirm({ move: false, series: recurring && series })}>
              Link, leave them where they are
            </Button>
          )}
          <Button disabled={pending} onClick={() => onConfirm({ move: unlinkedItems > 0, series: recurring && series })}>
            {unlinkedItems > 0 ? "Link and move them" : "Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
