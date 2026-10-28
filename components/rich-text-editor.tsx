"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { Bold, Columns3, Heading2, Italic, Link2, List, ListOrdered, Quote, Rows3, Strikethrough, Table2, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Rich text editor. Writes its HTML into a hidden input called `name`, so it
 * works inside ordinary forms / server actions.
 */
export function RichTextEditor({
  name,
  defaultValue,
  placeholder,
  minHeight = "8rem",
  onChange,
}: {
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  minHeight?: string;
  onChange?: (html: string) => void;
}) {
  const [html, setHtml] = useState(defaultValue ?? "");
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "Write something…" }),
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: defaultValue ?? "",
    editorProps: {
      attributes: {
        class: "prose-content max-w-none px-3 py-2 outline-none",
        style: `min-height:${minHeight}`,
      },
      // Cells copied from Excel or Sheets as plain tab-separated text become a table.
      handlePaste: (view, event) => {
        const data = event.clipboardData;
        if (!data || data.getData("text/html").includes("<table")) return false;
        const text = data.getData("text/plain").replace(/\r/g, "").replace(/\n+$/, "");
        const rows = text.split("\n");
        if (rows.length < 2 || !rows.every((r) => r.includes("\t"))) return false;
        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const [head, ...body] = rows.map((r) => r.split("\t"));
        const html =
          `<table><tbody><tr>${head.map((c) => `<th><p>${esc(c)}</p></th>`).join("")}</tr>` +
          body.map((r) => `<tr>${head.map((_, i) => `<td><p>${esc(r[i] ?? "")}</p></td>`).join("")}</tr>`).join("") +
          `</tbody></table>`;
        // A fresh paste event (no clipboard data), so this handler steps aside the second time.
        return view.pasteHTML(html);
      },
    },
    onUpdate: ({ editor }) => {
      const next = editor.isEmpty ? "" : editor.getHTML();
      setHtml(next);
      onChange?.(next);
    },
  });

  return (
    <div className="rounded-[12px] border border-line bg-white focus-within:ring-2 focus-within:ring-brand-primary/40">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <input type="hidden" name={name} value={html} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="h-9 border-b" />;
  const btn = (active: boolean) =>
    cn("rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground", active && "bg-accent text-foreground");

  return (
    <div className="flex flex-wrap gap-0.5 border-b px-1 py-1">
      <button type="button" aria-label="Bold" className={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Italic" className={btn(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Strikethrough" className={btn(editor.isActive("strike"))} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Heading" className={btn(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Bullet list" className={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Numbered list" className={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Quote" className={btn(editor.isActive("blockquote"))} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Link"
        className={btn(editor.isActive("link"))}
        onClick={() => {
          const prev = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("Link URL", prev ?? "https://");
          if (url === null) return;
          if (url === "") editor.chain().focus().unsetLink().run();
          else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        }}
      >
        <Link2 className="h-4 w-4" />
      </button>
      <span className="mx-1 w-px self-stretch bg-line" />
      <button
        type="button"
        aria-label="Insert a table"
        title="Insert a table (or paste cells from Excel)"
        className={btn(editor.isActive("table"))}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <Table2 className="h-4 w-4" />
      </button>
      {editor.isActive("table") && (
        <>
          <button type="button" aria-label="Add a row" title="Add a row" className={btn(false)} onClick={() => editor.chain().focus().addRowAfter().run()}>
            <Rows3 className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Add a column" title="Add a column" className={btn(false)} onClick={() => editor.chain().focus().addColumnAfter().run()}>
            <Columns3 className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Delete the row" title="Delete this row" className={btn(false)} onClick={() => editor.chain().focus().deleteRow().run()}>
            <Rows3 className="h-4 w-4 text-danger" />
          </button>
          <button type="button" aria-label="Delete the table" title="Delete the table" className={btn(false)} onClick={() => editor.chain().focus().deleteTable().run()}>
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
