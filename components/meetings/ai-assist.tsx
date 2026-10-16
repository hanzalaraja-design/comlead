"use client";

import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Small outline button that starts an assistant request. */
export function AiButton({
  onClick,
  busy,
  disabled,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={busy || disabled} className="h-8 gap-1.5">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-brand-primary" />}
      {children}
    </Button>
  );
}

/**
 * Holds assistant output until the person accepts or discards it.
 * Nothing in here is saved on its own.
 */
export function DraftPanel({
  title,
  children,
  acceptLabel,
  discardLabel = "Discard",
  onAccept,
  onDiscard,
  className,
}: {
  title: string;
  children: React.ReactNode;
  acceptLabel?: string;
  discardLabel?: string;
  onAccept?: () => void;
  onDiscard: () => void;
  className?: string;
}) {
  return (
    <div role="region" aria-label={title} className={cn("space-y-3 rounded-[12px] border border-dashed border-line bg-subtle/60 p-3", className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        <Sparkles className="h-3.5 w-3.5 text-brand-primary" />
        {title}
        <span className="font-normal">· Draft. Check it before you use it.</span>
      </div>
      {children}
      <div className="flex flex-wrap gap-2">
        {onAccept && (
          <Button type="button" size="sm" onClick={onAccept}>
            {acceptLabel ?? "Use this"}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>
          {discardLabel}
        </Button>
      </div>
    </div>
  );
}
