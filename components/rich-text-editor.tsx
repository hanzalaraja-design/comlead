"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Heading2, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from "lucide-react";
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
    ],
    content: defaultValue ?? "",
    editorProps: {
      attributes: {
        class: "prose-content max-w-none px-3 py-2 outline-none",
        style: `min-height:${minHeight}`,
      },
    },
    onUpdate: ({ editor }) => {
      const next = editor.isEmpty ? "" : editor.getHTML();
      setHtml(next);
      onChange?.(next);
    },
  });

  return (
    <div className="rounded-md border bg-background focus-within:ring-1 focus-within:ring-ring">
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
    </div>
  );
}
