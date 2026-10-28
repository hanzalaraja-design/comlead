import sanitizeHtml from "sanitize-html";

/** Allow only the formatting the rich text editor produces. */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "code", "pre", "blockquote",
    "h2", "h3", "ul", "ol", "li", "a", "hr",
    // Tables, typed or pasted from Excel / Google Sheets.
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: { a: ["href", "target", "rel"], th: ["colspan", "rowspan"], td: ["colspan", "rowspan"] },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
  },
};

export function sanitizeRichText(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, OPTIONS);
}

/** True when the HTML has no visible text. */
export function isBlankHtml(html: string | null | undefined): boolean {
  return !html || sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim() === "";
}
