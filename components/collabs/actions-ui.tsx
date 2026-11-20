"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PersonAvatar } from "@/components/person-avatar";
import { CommentImages, PendingImages, usePastedImages } from "@/components/pasted-images";
import { PlainText } from "@/components/plain-text";
import { personName } from "@/lib/labels";
import { formatPKT } from "@/lib/time";
import type { PersonRef } from "@/lib/types";
import { addCollabComment, approveCollab, askCollabChanges, deleteCollabComment, markCollabLive, shareCollabReport } from "@/app/(app)/collabs/actions";

/** Whoever asks (Commercial, or a team picked to ask): approve the plan, or send it back with a note. */
export function DecidePlan({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {asking ? (
        <>
          <Textarea autoFocus rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change? e.g. Swap the meme for a second influencer reel." />
          <div className="flex gap-2">
            <Button
              disabled={pending || !note.trim()}
              onClick={() =>
                start(async () => {
                  const res = await askCollabChanges(requestId, note);
                  if (!res.ok) return void toast.error(res.error);
                  toast.success("Sent back to Content.");
                  router.refresh();
                })
              }
            >
              Send to Content
            </Button>
            <Button variant="outline" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            className="bg-success hover:bg-success/90"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await approveCollab(requestId);
                if (!res.ok) return void toast.error(res.error);
                toast.success("Approved. Each piece is now a task for whoever does it.");
                router.refresh();
              })
            }
          >
            <Check className="h-4 w-4" /> Approve plan
          </Button>
          <Button variant="outline" onClick={() => setAsking(true)}>
            Ask for changes
          </Button>
        </div>
      )}
      <p className="text-xs text-ink-muted">Approving puts each piece in that person&apos;s Tasks.</p>
    </div>
  );
}

/** Paste the live link and mark one piece live. */
export function MarkLive({ itemId, requestId }: { itemId: string; requestId: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await markCollabLive(itemId, url, requestId);
          if (!res.ok) return void toast.error(res.error);
          toast.success("Marked live. The team that asked has been told.");
          setUrl("");
          router.refresh();
        });
      }}
    >
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste the link to the live post" aria-label="Link to the live post" className="h-9" />
      <Button type="submit" size="sm" disabled={pending || !url.trim()}>
        Mark live
      </Button>
    </form>
  );
}

export function LiveLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-sm font-medium text-brand-primary hover:underline">
      <span className="truncate">{url.replace(/^https?:\/\/(www\.)?/, "")}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

/** Content's report: a short summary is enough; screenshots and numbers are optional. */
export function ReportForm({
  requestId,
  items,
  initial,
}: {
  requestId: string;
  items: { id: string; name: string; qty: number; reach: number | null; views: number | null }[];
  initial?: { summary: string; images: string[] };
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [nums, setNums] = useState(items.map((i) => ({ id: i.id, reach: i.reach?.toString() ?? "", views: i.views?.toString() ?? "" })));
  const pics = usePastedImages(10);
  const [pending, start] = useTransition();
  return (
    <div className="surface space-y-4 p-4 md:p-5">
      <div>
        <h2 className="text-base font-bold text-ink">Share the report</h2>
        <p className="text-[13px] text-ink-muted">A short summary is enough. Screenshots of insights and numbers are optional.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="summary" className="text-sm font-medium">
          Summary <span className="text-danger">*</span> <span className="font-normal text-ink-muted">1–2 lines</span>
        </label>
        <Textarea id="summary" rows={3} maxLength={3000} value={summary} onChange={(e) => setSummary(e.target.value)} onPaste={pics.onPaste} placeholder="What went well, what to do next time." />
        <PendingImages state={pics} />
        {initial?.images.length ? <p className="text-xs text-ink-muted">{initial.images.length} screenshot(s) already shared; adding new ones replaces them.</p> : null}
      </div>
      <details className="rounded-[12px] border border-line">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-brand-primary">Numbers per piece (optional)</summary>
        <div className="space-y-2 border-t border-line p-4">
          {items.map((it, i) => (
            <div key={it.id} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
              <span className="text-sm text-ink">
                {it.name}
                {it.qty > 1 ? ` ×${it.qty}` : ""}
              </span>
              <Input inputMode="numeric" placeholder="Reach" aria-label={`Reach, ${it.name}`} value={nums[i].reach} onChange={(e) => setNums((xs) => xs.map((x, j) => (j === i ? { ...x, reach: e.target.value } : x)))} className="h-9" />
              <Input inputMode="numeric" placeholder="Views" aria-label={`Views, ${it.name}`} value={nums[i].views} onChange={(e) => setNums((xs) => xs.map((x, j) => (j === i ? { ...x, views: e.target.value } : x)))} className="h-9" />
            </div>
          ))}
        </div>
      </details>
      <Button
        disabled={pending || pics.uploading || !summary.trim()}
        onClick={() =>
          start(async () => {
            const res = await shareCollabReport(requestId, summary, pics.images.length ? pics.images : initial?.images ?? [], nums);
            if (!res.ok) return void toast.error(res.error);
            toast.success("Report shared with the team that asked.");
            router.refresh();
          })
        }
      >
        {pending ? "Sharing…" : initial ? "Update report" : "Share report"}
      </Button>
    </div>
  );
}

type Comment = { id: string; author_id: string; body: string; image_paths: string[]; created_at: string };

/** Questions, extra links and screenshots, both teams. */
export function CollabComments({ requestId, comments, people, me }: { requestId: string; comments: Comment[]; people: PersonRef[]; me: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const pics = usePastedImages();
  const [pending, start] = useTransition();
  const byId = new Map(people.map((p) => [p.id, p]));
  return (
    <div className="surface space-y-3 p-4 md:p-5">
      <h2 className="text-base font-bold text-ink">Comments</h2>
      {comments.length === 0 && <p className="text-sm text-ink-muted">Questions, extra links or screenshots go here.</p>}
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <PersonAvatar person={byId.get(c.author_id)} className="mt-0.5 h-7 w-7" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-muted">
                <span className="font-semibold text-ink">{personName(byId.get(c.author_id))}</span> · {formatPKT(c.created_at, "d MMM, h:mm a")}
                {c.author_id === me && (
                  <button
                    type="button"
                    aria-label="Delete comment"
                    className="ml-2 align-middle text-ink-muted hover:text-danger"
                    onClick={() =>
                      start(async () => {
                        const res = await deleteCollabComment(c.id, requestId);
                        if (!res.ok) toast.error(res.error);
                        else router.refresh();
                      })
                    }
                  >
                    <Trash2 className="inline h-3.5 w-3.5" />
                  </button>
                )}
              </p>
              {c.body && (
                <div className="text-sm text-ink">
                  <PlainText text={c.body} />
                </div>
              )}
              <CommentImages paths={c.image_paths} />
            </div>
          </li>
        ))}
      </ul>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await addCollabComment(requestId, text, pics.images);
            if (!res.ok) return void toast.error(res.error);
            setText("");
            pics.clear();
            router.refresh();
          });
        }}
      >
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} onPaste={pics.onPaste} placeholder="Write a comment… (paste screenshots too)" />
        <div className="flex items-center justify-between gap-2">
          <PendingImages state={pics} />
          <Button type="submit" size="sm" disabled={pending || pics.uploading || (!text.trim() && !pics.images.length)}>
            Comment
          </Button>
        </div>
      </form>
    </div>
  );
}
