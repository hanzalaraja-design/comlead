"use client";

import { useEffect } from "react";

/**
 * Pasting into a comment or notes box (plain text): a link copied from a web
 * page, a doc or an email (words with a link behind them) pastes as the link,
 * not just its words. One link on its own pastes as its address; links inside
 * other text paste as "words (address)". The rich description editor keeps
 * links by itself, so it's left alone.
 */
export function PasteLinks() {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target;
      const box =
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement && ["text", "search", "url", ""].includes(el.type));
      if (!box || (el as HTMLElement).isContentEditable || !e.clipboardData) return;
      // Pictures are someone else's job (pasted screenshots).
      if ([...e.clipboardData.items].some((i) => i.kind === "file")) return;
      const html = e.clipboardData.getData("text/html");
      if (!html || !/<a\s[^>]*href=/i.test(html)) return;
      const text = linkText(html);
      if (!text) return;
      e.preventDefault();
      // Typed in like a person would, so the box's own change handling and undo work.
      if (!document.execCommand("insertText", false, text)) {
        const t = el as HTMLTextAreaElement | HTMLInputElement;
        const [a, b] = [t.selectionStart ?? t.value.length, t.selectionEnd ?? t.value.length];
        t.setRangeText(text, a, b, "end");
        t.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };
    document.addEventListener("paste", onPaste, true);
    return () => document.removeEventListener("paste", onPaste, true);
  }, []);
  return null;
}

const BLOCKS = new Set(["P", "DIV", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "SECTION", "ARTICLE"]);

/** The pasted HTML as plain text, keeping where its links go. */
function linkText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const links = [...doc.body.querySelectorAll("a[href]")].filter((a) => /^(https?:|mailto:)/i.test(a.getAttribute("href") ?? ""));
  if (!links.length) return "";
  const whole = (doc.body.textContent ?? "").trim();
  // Just one link copied: its address.
  if (links.length === 1 && (links[0].textContent ?? "").trim() === whole) return links[0].getAttribute("href")!;
  let out = "";
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) return void (out += (n.textContent ?? "").replace(/\s+/g, " "));
    if (!(n instanceof Element)) return;
    if (n.tagName === "BR") return void (out += "\n");
    if (n.tagName === "A" && /^(https?:|mailto:)/i.test(n.getAttribute("href") ?? "")) {
      const href = n.getAttribute("href")!;
      const words = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      out += !words || words === href || href.endsWith(words) ? href : `${words} (${href})`;
      return;
    }
    if (n.tagName === "STYLE" || n.tagName === "SCRIPT") return;
    const block = BLOCKS.has(n.tagName);
    if (block && out && !out.endsWith("\n")) out += "\n";
    n.childNodes.forEach(walk);
    if (block && !out.endsWith("\n")) out += "\n";
  };
  doc.body.childNodes.forEach(walk);
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
