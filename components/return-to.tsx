"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Where a task was opened from, so "back" (and deleting it) returns to that
 * exact list, board or page, filters and all, instead of a fixed place.
 */

const KEY = "highfy:back";
const TASK_LINK = /^\/tasks\/[0-9a-f-]{36}(?:[?#]|$)/i;

type Place = { url: string; label: string; task?: string };

function raw(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Only for the task it was noted for, so an old visit never sends you somewhere odd. */
function read(taskId: string, value = raw()): Place | null {
  try {
    const v = JSON.parse(value ?? "null");
    return v && v.task === taskId && typeof v.url === "string" && v.url.startsWith("/") ? v : null;
  } catch {
    return null;
  }
}

/** Notes the page you're on whenever you open a task from it. Mounted once, in the app layout. */
export function RememberPlace() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      const href = a?.getAttribute("href");
      if (!href || !TASK_LINK.test(href)) return;
      const here = location.pathname + location.search;
      if (href.split(/[?#]/)[0] === location.pathname) return;
      const label = document.querySelector("main h1")?.textContent?.trim() || "previous page";
      try {
        sessionStorage.setItem(KEY, JSON.stringify({ url: here, label, task: href.split(/[?#]/)[0].split("/")[2] }));
      } catch {}
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}

const noop = () => () => {};

/** The page to go back to, or the fallback when the task was opened directly. */
export function backTo(taskId: string, fallback: string): string {
  return read(taskId)?.url ?? fallback;
}

/** "← Back to 11.11" above a task. */
export function BackLink({ taskId, fallback }: { taskId: string; fallback: { label: string; href: string } }) {
  const stored = useSyncExternalStore(noop, raw, () => null);
  const place = read(taskId, stored) ?? { url: fallback.href, label: fallback.label };
  return (
    <Link href={place.url} className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-primary hover:underline">
      <ArrowLeft className="h-3.5 w-3.5" /> Back to {place.label}
    </Link>
  );
}
