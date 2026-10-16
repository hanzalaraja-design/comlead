/** Rich text (Tiptap HTML) to plain text with line structure, for prompts. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/blockquote|\/ul|\/ol)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n\s*\n- /g, "\n- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Structured minutes to editor HTML. Built here, so the model never writes markup. */
export function minutesToHtml(sections: { heading: string; points: string[] }[]): string {
  return sections
    .map((s) => {
      const points = s.points.filter(Boolean).map((p) => `<li><p>${escapeHtml(p)}</p></li>`);
      return `${s.heading ? `<h3>${escapeHtml(s.heading)}</h3>` : ""}${points.length ? `<ul>${points.join("")}</ul>` : ""}`;
    })
    .join("");
}
