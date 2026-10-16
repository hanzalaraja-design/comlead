"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PersonAvatar } from "@/components/person-avatar";
import { personName } from "@/lib/labels";
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

export function TaskComments({
  taskId,
  comments,
  canComment,
}: {
  taskId: string;
  comments: CommentRow[];
  canComment: boolean;
}) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
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
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
      {canComment && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await addComment(taskId, body);
              if (res.ok) setBody("");
              else toast.error(res.error);
            });
          }}
        >
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment…" rows={3} />
          <Button type="submit" size="sm" disabled={pending || !body.trim()}>
            Comment
          </Button>
        </form>
      )}
    </div>
  );
}
