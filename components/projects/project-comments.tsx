"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PersonAvatar } from "@/components/person-avatar";
import type { PersonRef } from "@/lib/types";
import { addProjectComment, deleteProjectComment } from "@/app/(app)/projects/parts-actions";

export type ProjectComment = { id: string; body: string; when: string; author: PersonRef | null; authorName: string; mine: boolean };

/** Comments on a project, campaign or partnership. Everyone in it is told about a new one. */
export function ProjectComments({
  projectId,
  comments,
  canComment,
  partId,
  title = "Comments",
}: {
  projectId: string;
  comments: ProjectComment[];
  canComment: boolean;
  /** Comments on one journey (or term) only. */
  partId?: string;
  title?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const post = () =>
    start(async () => {
      const res = await addProjectComment(projectId, text, partId);
      if (!res.ok) return void toast.error(res.error);
      setText("");
      router.refresh();
    });
  return (
    <section id="comments" className="mt-6 scroll-mt-6 surface space-y-4 p-4 md:p-6">
      <h2 className="text-[15px] font-semibold text-ink">
        {title} {comments.length > 0 && <span className="font-normal text-ink-muted">· {comments.length}</span>}
      </h2>
      {comments.length > 0 && (
        <ul className="space-y-4">
          {comments.map((c) => (
            <li key={c.id} className="group flex gap-3">
              <PersonAvatar person={c.author} className="h-8 w-8" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px]">
                  <span className="font-semibold text-ink">{c.authorName}</span> <span className="text-ink-muted">· {c.when}</span>
                </p>
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{c.body}</p>
              </div>
              {c.mine && (
                <button
                  type="button"
                  aria-label="Remove comment"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await deleteProjectComment(c.id);
                      if (!res.ok) toast.error(res.error);
                      router.refresh();
                    })
                  }
                  className="self-start p-1 text-ink-muted opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <div className="space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={10000} placeholder="Write a comment. Everyone in it is told." aria-label="Write a comment" />
          <div className="flex justify-end">
            <Button size="sm" disabled={pending || !text.trim()} onClick={post}>
              Post
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
