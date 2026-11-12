"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";
import { imagesIn, uploadInlineImage } from "@/lib/inline-upload";
import { inlineImageUrl } from "@/lib/inline-image";

/** Screenshots pasted (or picked) into a plain comment box, uploaded straight away. */
export function usePastedImages(max = 6) {
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  async function add(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files.slice(0, Math.max(0, max - images.length))) {
        const url = await uploadInlineImage(f);
        setImages((x) => [...x, url]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add the image.");
    } finally {
      setUploading(false);
    }
  }
  return {
    images,
    uploading,
    add,
    clear: () => setImages([]),
    remove: (url: string) => setImages((x) => x.filter((y) => y !== url)),
    /** Put on the textarea: a pasted screenshot becomes an attachment, text pastes as usual. */
    onPaste: (e: React.ClipboardEvent) => {
      const files = imagesIn(e.clipboardData);
      if (!files.length || e.clipboardData.getData("text/html").includes("<table")) return;
      e.preventDefault();
      void add(files);
    },
  };
}

/** Thumbnails of what's about to be posted, with a remove button, plus "Add image". */
export function PendingImages({ state }: { state: ReturnType<typeof usePastedImages> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state.images.map((url) => (
        <span key={url} className="relative size-16 overflow-hidden rounded-[10px] border border-line bg-subtle">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Screenshot" className="h-full w-full object-cover" />
          <button type="button" aria-label="Remove image" onClick={() => state.remove(url)} className="absolute right-0.5 top-0.5 rounded-full bg-ink/70 p-0.5 text-white">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-ink-muted hover:text-ink">
        <ImagePlus className="h-3.5 w-3.5" /> {state.uploading ? "Uploading…" : "Add image"}
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void state.add(files);
          }}
        />
      </label>
    </div>
  );
}

/** Screenshots on a posted comment; click to open full size. */
export function CommentImages({ paths }: { paths: string[] | null | undefined }) {
  if (!paths?.length) return null;
  return (
    <span className="mt-2 flex flex-wrap gap-2">
      {paths.map((p) => {
        const url = inlineImageUrl(p);
        return (
          <a key={p} href={url} target="_blank" rel="noreferrer" className="block max-w-[16rem] overflow-hidden rounded-[10px] border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Screenshot" className="max-h-48 w-auto" />
          </a>
        );
      })}
    </span>
  );
}
