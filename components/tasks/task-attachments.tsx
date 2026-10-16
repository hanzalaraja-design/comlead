"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { deleteAttachment, getAttachmentUrl, recordAttachment } from "@/app/(app)/tasks/actions";

export type AttachmentRow = {
  id: string;
  file_name: string;
  storage_path: string;
  size_bytes: number | null;
  uploaded_label: string;
  canDelete: boolean;
};

const MAX_BYTES = 25 * 1024 * 1024;

function formatSize(n: number | null) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function TaskAttachments({
  taskId,
  attachments,
  canUpload,
}: {
  taskId: string;
  attachments: AttachmentRow[];
  canUpload: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function upload(files: FileList | null) {
    if (!files?.length) return;
    startTransition(async () => {
      const supabase = createClient();
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name} is over 25 MB`);
          continue;
        }
        const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(-120);
        const path = `${taskId}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage.from("task-attachments").upload(path, file, {
          contentType: file.type || undefined,
        });
        if (error) {
          toast.error(`Couldn't upload ${file.name}: ${error.message}`);
          continue;
        }
        const res = await recordAttachment({
          taskId,
          path,
          fileName: file.name,
          size: file.size,
          mimeType: file.type,
        });
        if (!res.ok) toast.error(res.error);
      }
      if (input.current) input.current.value = "";
    });
  }

  return (
    <div className="space-y-3">
      {attachments.length === 0 && <p className="text-sm text-muted-foreground">No files.</p>}
      <ul className="space-y-1">
        {attachments.map((a) => (
          <li key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left hover:underline"
              onClick={() =>
                startTransition(async () => {
                  const res = await getAttachmentUrl(a.storage_path);
                  if (res.ok && res.data) window.open(res.data.url, "_blank", "noopener");
                  else if (!res.ok) toast.error(res.error);
                })
              }
            >
              {a.file_name}
            </button>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              {formatSize(a.size_bytes)} · {a.uploaded_label}
            </span>
            {a.canDelete && (
              <button
                type="button"
                aria-label={`Delete ${a.file_name}`}
                className="text-muted-foreground hover:text-red-600"
                onClick={() => {
                  if (!confirm(`Delete ${a.file_name}?`)) return;
                  startTransition(async () => {
                    const res = await deleteAttachment(a.id, taskId);
                    if (!res.ok) toast.error(res.error);
                  });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canUpload && (
        <>
          <input ref={input} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>
            <Upload className="h-4 w-4" /> {pending ? "Uploading…" : "Add files"}
          </Button>
        </>
      )}
    </div>
  );
}
