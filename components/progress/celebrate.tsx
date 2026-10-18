"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

export const TASK_DONE_EVENT = "highfy:task-done";
export type TaskDoneDetail = { dueByToday: boolean };

const COLOURS = ["#1E9E5A", "#2F6FED", "#F2A100", "#7C118C", "#FF8F4B"];

/** A short burst of confetti from the top of the screen. Skipped for reduced motion. */
export function burst() {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.className = "pointer-events-none fixed inset-0 z-[100] overflow-hidden";
  for (let i = 0; i < 60; i++) {
    const p = document.createElement("span");
    const size = 6 + Math.random() * 6;
    p.style.cssText = `position:absolute;top:-12px;left:${Math.random() * 100}%;width:${size}px;height:${size * 0.45}px;background:${COLOURS[i % COLOURS.length]};border-radius:2px;opacity:.95;transform:rotate(${Math.random() * 360}deg);animation:confetti-fall ${1.2 + Math.random() * 1.1}s cubic-bezier(.2,.7,.4,1) ${Math.random() * 0.25}s forwards;--drift:${(Math.random() - 0.5) * 240}px`;
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2800);
}

/**
 * Watches one-click completions on My tasks. When the last task due today
 * (or overdue) is ticked off: confetti and a line of praise.
 */
export function CelebrateWhenCleared({ remaining, line }: { remaining: number; line: string }) {
  const left = useRef(remaining);
  useEffect(() => {
    left.current = remaining;
  }, [remaining]);
  useEffect(() => {
    const onDone = (e: Event) => {
      const { dueByToday } = (e as CustomEvent<TaskDoneDetail>).detail;
      if (!dueByToday || left.current <= 0) return;
      left.current -= 1;
      if (left.current === 0) {
        burst();
        toast.success(line);
      }
    };
    window.addEventListener(TASK_DONE_EVENT, onDone);
    return () => window.removeEventListener(TASK_DONE_EVENT, onDone);
  }, [line]);
  return null;
}
