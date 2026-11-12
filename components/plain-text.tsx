import { Fragment, type ReactNode } from "react";

/**
 * Plain text as people typed it, except that cells pasted from Excel or
 * Google Sheets (lines with tabs between the values) show as a table.
 * `render` styles each piece of ordinary text (e.g. to highlight @mentions).
 */
export function PlainText({ text, render = (s) => s }: { text: string; render?: (s: string) => ReactNode }) {
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
