"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, History, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { addBookingComment, deleteBookingComment, getBookingThread, type BookingThread } from "@/app/(app)/placements/actions";

/** The booking's link, with Copy and Open. */
export function BookingLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <a href={link} target="_blank" rel="noreferrer" className="min-w-0 truncate text-brand-primary hover:underline">
        {link.replace(/^https?:\/\//, "")}
      </a>
      <button
        type="button"
        aria-label="Copy the link"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error("Couldn't copy. Select the link and copy it instead.");
          }
        }}
        className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] border px-2 text-xs font-semibold", copied ? "border-success-soft bg-success-soft text-success-ink" : "border-line text-ink hover:bg-subtle")}
      >
        <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
      </button>
      <a href={link} target="_blank" rel="noreferrer" aria-label="Open the link in a new tab" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-line text-ink hover:bg-subtle">
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </span>
  );
}

/** Comments on a booking, and its history behind a small clock button. */
export function BookingThreadPanel({ placementId }: { placementId: string }) {
  const [thread, setThread] = useState<BookingThread | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const load = useCallback(async () => {
    const res = await getBookingThread(placementId);
    if (res.ok) setThread(res.data!);
  }, [placementId]);
  useEffect(() => {
    let live = true;
    getBookingThread(placementId).then((res) => {
      if (live && res.ok) setThread(res.data!);
    });
    return () => {
      live = false;
    };
  }, [placementId]);

  return (
    <section aria-label="Comments" className="space-y-3 border-t border-line pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-ink">
          Comments {thread && thread.comments.length > 0 && <span className="font-normal text-ink-muted">· {thread.comments.length}</span>}
        </h3>
        <button
          type="button"
          aria-pressed={showLog}
          aria-label="Activity"
          title="Activity"
          onClick={() => setShowLog((x) => !x)}
          className={cn("inline-flex h-8 w-8 items-center justify-center rounded-[10px] border", showLog ? "border-ink bg-ink text-white" : "border-line text-ink-muted hover:text-ink")}
        >
          <History className="h-4 w-4" />
        </button>
      </div>
      {showLog && (
        <ol className="space-y-2 rounded-[12px] bg-canvas px-3 py-2.5 text-sm">
          {thread?.activity.length ? (
            thread.activity.map((a) => (
              <li key={a.id}>
                <span className="font-medium text-ink">{a.who}</span> <span className="text-ink-muted">{a.text}</span>
                <span className="block text-xs text-ink-muted">{a.when}</span>
              </li>
            ))
          ) : (
            <li className="text-ink-muted">No history yet.</li>
          )}
        </ol>
      )}
      {thread?.comments.map((c) => (
        <div key={c.id} className="group flex gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs">
              <span className="font-semibold text-ink">{c.author}</span> <span className="text-ink-muted">· {c.when}</span>
            </p>
            <p className="whitespace-pre-line text-sm text-ink">{c.body}</p>
          </div>
          {c.mine && (
            <button
              type="button"
              aria-label="Remove comment"
              onClick={() =>
                start(async () => {
                  const res = await deleteBookingComment(c.id);
                  if (!res.ok) toast.error(res.error);
                  await load();
                })
              }
              className="self-start p-1 text-ink-muted opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      <div className="space-y-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={5000} placeholder="Write a comment. Whoever booked it is told." aria-label="Write a comment" />
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={pending || !text.trim()}
            onClick={() =>
              start(async () => {
                const res = await addBookingComment(placementId, text);
                if (!res.ok) return void toast.error(res.error);
                setText("");
                await load();
              })
            }
          >
            Post
          </Button>
        </div>
      </div>
    </section>
  );
}
