import { Fragment, type ReactNode } from "react";

/**
 * Plain text as people typed it, except that cells pasted from Excel or
 * Google Sheets (lines with tabs between the values) show as a table.
 * Web addresses (https://…, www.…) are clickable links. `render` styles each
 * piece of ordinary text (e.g. to highlight @mentions).
 */
export function PlainText({ text, render: style = (s) => s }: { text: string; render?: (s: string) => ReactNode }) {
  // Web addresses become links; the rest is styled as given.
  const render = (s: string) => withLinks(s, style);
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: { table: boolean; lines: string[] }[] = [];
  for (const line of lines) {
    const isRow = line.includes("\t");
    const last = blocks[blocks.length - 1];
    if (last && last.table === isRow) last.lines.push(line);
    else blocks.push({ table: isRow, lines: [line] });
  }
  return (
    <>
      {blocks.map((b, i) => {
        // One stray tab isn't a table.
        if (!b.table || b.lines.length < 2) return <Fragment key={i}>{render(b.lines.join("\n") + (i < blocks.length - 1 ? "\n" : ""))}</Fragment>;
        const rows = b.lines.map((l) => l.split("\t"));
        const cols = Math.max(...rows.map((r) => r.length));
        return (
          <span key={i} className="my-1.5 block max-w-full overflow-x-auto">
            <table className="border-collapse text-[13px]">
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    {Array.from({ length: cols }, (_, ci) => {
                      const Cell = ri === 0 ? "th" : "td";
                      return (
                        <Cell key={ci} className={ri === 0 ? "border border-line bg-subtle px-2 py-1 text-left font-semibold" : "border border-line px-2 py-1 align-top"}>
                          {render(r[ci] ?? "")}
                        </Cell>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </span>
        );
      })}
    </>
  );
}

// http(s) or www. addresses, without the punctuation that usually ends a sentence.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]*[^\s<>".,;:!?)\]'’”]/gi;

/** Text with its web addresses as links that open in a new tab. */
export function withLinks(text: string, render: (s: string) => ReactNode = (s) => s): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(<Fragment key={`t${at}`}>{render(text.slice(last, at))}</Fragment>);
    const href = /^https?:\/\//i.test(m[0]) ? m[0] : `https://${m[0]}`;
    out.push(
      <a key={`a${at}`} href={href} target="_blank" rel="noopener noreferrer" className="break-all text-brand-primary underline underline-offset-2 hover:no-underline">
        {m[0]}
      </a>,
    );
    last = at + m[0].length;
  }
  if (!out.length) return render(text);
  if (last < text.length) out.push(<Fragment key="end">{render(text.slice(last))}</Fragment>);
  return out;
}
