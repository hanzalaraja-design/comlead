"use client";

import { Fragment, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AtSign, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PersonAvatar } from "@/components/person-avatar";
import { personName } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { PersonRef } from "@/lib/types";
import { addComment, deleteComment } from "@/app/(app)/tasks/actions";

export type CommentRow = {
  id: string;
  body: string;
  created_at: string;
  created_label: string;
  author: PersonRef | null;
  mine: boolean;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Shows "@Name" for anyone in `people` as a highlighted mention. */
function CommentBody({ body, people }: { body: string; people: PersonRef[] }) {
  const names = useMemo(
    () => people.map((p) => personName(p)).filter(Boolean).sort((a, b) => b.length - a.length),
    [people],
  );
  if (!names.length || !body.includes("@")) return <>{body}</>;
  const re = new RegExp(`(@(?:${names.map(escapeRe).join("|")}))`, "g");
  return (
    <>
      {body.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="rounded bg-brand-bg px-1 font-medium text-brand-primary">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function TaskComments({
  taskId,
  comments,
  canComment,
  people,
  viewerId,
}: {
  taskId: string;
  comments: CommentRow[];
  canComment: boolean;
  /** Everyone who can be tagged with @. */
  people: PersonRef[];
  viewerId: string;
}) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [tagged, setTagged] = useState<Record<string, string>>({});
  const box = useRef<HTMLTextAreaElement>(null);
  // Where the caret goes after a name is inserted; applied as soon as React updates the box.
  const caretAfter = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caretAfter.current === null || !box.current) return;
    box.current.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  }, [body]);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return people.filter((p) => p.id !== viewerId && (personName(p).toLowerCase().includes(q) || p.email.toLowerCase().startsWith(q))).slice(0, 6);
  }, [people, query, viewerId]);

  function onChange(value: string, caret: number) {
    setBody(value);
    // An "@word" right before the caret opens the people list.
    const m = /(^|\s)@([\w.'-]*)$/.exec(value.slice(0, caret));
    setQuery(m ? m[2] : null);
    setActive(0);
  }

  function pick(p: PersonRef) {
    const el = box.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([\w.'-]*)$/, `@${personName(p)} `);
    const next = before + body.slice(caret);
    caretAfter.current = before.length;
    setBody(next);
    setTagged((t) => ({ ...t, [personName(p)]: p.id }));
    setQuery(null);
    el?.focus();
  }

  function submit() {
    const ids = Object.entries(tagged)
      .filter(([name]) => body.includes(`@${name}`))
      .map(([, id]) => id);
    startTransition(async () => {
      const res = await addComment(taskId, body, ids);
      if (res.ok) {
        setBody("");
        setTagged({});
        if (ids.length) toast.success(ids.length === 1 ? "Comment posted. They've been tagged." : `Comment posted. ${ids.length} people tagged.`);
      } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      {comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet. Start the conversation.</p>}
      <ul className="space-y-4">
        {comments.map((c) => (
          <li key={c.id} className="flex gap-3">
            <PersonAvatar person={c.author} className="mt-0.5 h-7 w-7" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">{personName(c.author)}</span>
                <span className="text-muted-foreground">{c.created_label}</span>
                {c.mine && (
                  <button
                    type="button"
                    aria-label="Delete comment"
                    className="ml-auto text-muted-foreground hover:text-danger"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await deleteComment(c.id, taskId);
                        if (!res.ok) toast.error(res.error);
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                <CommentBody body={c.body} people={people} />
              </p>
            </div>
          </li>
        ))}
      </ul>
      {canComment && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="relative">
            <Textarea
              ref={box}
              value={body}
              onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
              onKeyDown={(e) => {
                if (matches.length) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    pick(matches[active]);
                    return;
                  }
                  if (e.key === "Escape") {
                    setQuery(null);
                    return;
                  }
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Write a comment. Type @ to tag someone."
              rows={3}
              aria-label="Comment"
            />
            {matches.length > 0 && (
              <ul role="listbox" aria-label="People to tag" className="absolute left-2 top-full z-20 mt-1 w-64 overflow-hidden rounded-[12px] border border-line bg-white py-1 shadow-lg">
                {matches.map((p, i) => (
                  <li key={p.id} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(p);
                      }}
                      className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", i === active ? "bg-subtle" : "hover:bg-subtle")}
                    >
                      <PersonAvatar person={p} className="h-6 w-6" />
                      <span className="min-w-0 flex-1 truncate">{personName(p)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={pending || !body.trim()}>
              Comment
            </Button>
            <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
              <AtSign className="h-3 w-3" /> Tagged people get it under Comments and by email, and can open the task.
            </span>
          </div>
        </form>
      )}
    </div>
  );
}
