"use client";

import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * "Delete … ?" with a clear account of what happens. For big things (a
 * campaign with all its work) you type its name first.
 */
export function DeleteDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmText,
  action,
  onDeleted,
  button,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  /** Typed to confirm, when set. */
  confirmText?: string;
  action: () => Promise<{ ok: boolean; error?: string }>;
  onDeleted: () => void;
  button: string;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = !confirmText || typed.trim().toLowerCase() === confirmText.trim().toLowerCase();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setTyped("");
          setError(null);
        }
        onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">{children}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {confirmText && (
          <label className="block text-sm">
            <span className="mb-1.5 block text-ink-muted">
              Type <b className="text-ink">{confirmText}</b> to confirm
            </span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="h-9 w-full rounded-[10px] border border-line bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={!ready || pending}
            onClick={() =>
              startTransition(async () => {
                const res = await action();
                if (res.ok) onDeleted();
                else setError(res.error ?? "Couldn't delete it.");
              })
            }
          >
            {pending ? "Deleting…" : button}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
