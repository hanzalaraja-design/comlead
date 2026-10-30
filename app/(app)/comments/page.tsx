import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { PersonAvatar } from "@/components/person-avatar";
import { MarkMentionsRead } from "@/components/my/mention-buttons";
import { getPeople, viewerId } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { formatPKT } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Comments · Highfy Tasks" };

type Mention = {
  id: string;
  created_at: string;
  seen_at: string | null;
  mentioned_by: string | null;
  task: { id: string; title: string } | null;
  comment: { body: string } | null;
};

/** Every comment you were tagged in, newest first; the new ones stand out until read. */
export default async function CommentsPage() {
  const [id, supabase, people] = await Promise.all([viewerId(), createClient(), getPeople()]);
  const { data } = await supabase
    .from("task_mentions")
    .select("id, created_at, seen_at, mentioned_by, task:tasks(id, title), comment:task_comments(body)")
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  const mentions = ((data ?? []) as unknown as Mention[]).filter((m) => m.task);
  const unseen = mentions.filter((m) => !m.seen_at).length;
  const peopleById = new Map(people.map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Comments"
        description="Comments where someone tagged you with @."
        actions={unseen > 1 ? <MarkMentionsRead /> : undefined}
      />
      {mentions.length ? (
        <ul className="divide-y divide-line surface">
          {mentions.map((m) => {
            const by = m.mentioned_by ? peopleById.get(m.mentioned_by) : undefined;
            const isNew = !m.seen_at;
            return (
              <li key={m.id} className={cn("relative flex gap-3 px-4 py-3 hover:bg-subtle/60", isNew && "bg-brand-bg/40")}>
                <PersonAvatar person={by} className="mt-0.5 h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-muted">
                    <span className="font-semibold text-ink">{personName(by)}</span> mentioned you on{" "}
                    <Link href={`/tasks/${m.task!.id}#comments`} className="font-semibold text-ink after:absolute after:inset-0">
                      {m.task!.title}
                    </Link>
                  </p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-ink">{m.comment?.body}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs text-ink-muted">{formatPKT(m.created_at, "d MMM, h:mm a")}</span>
                  {isNew ? (
                    <MarkMentionsRead id={m.id} className="-mr-1.5" />
                  ) : (
                    <span className="text-[11px] text-ink-muted">Read</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState>No one has tagged you yet. When someone types @ and your name in a comment, it shows up here.</EmptyState>
      )}
    </div>
  );
}
