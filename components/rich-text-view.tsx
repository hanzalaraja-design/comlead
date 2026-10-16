import { sanitizeRichText } from "@/lib/sanitize";
import { cn } from "@/lib/utils";

/** Renders stored rich text. Always sanitized at render time. */
export function RichTextView({ html, className }: { html: string | null | undefined; className?: string }) {
  const clean = sanitizeRichText(html);
  if (!clean) return null;
  return <div className={cn("prose-content", className)} dangerouslySetInnerHTML={{ __html: clean }} />;
}
