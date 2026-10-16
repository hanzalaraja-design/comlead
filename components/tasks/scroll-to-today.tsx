"use client";

import { useEffect, useRef } from "react";

/** Horizontal scroller that opens with "today" in view (matters on phones). */
export function ScrollToToday({ offset, className, children }: { offset: number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && offset > 0 && el.scrollWidth > el.clientWidth) el.scrollLeft = offset;
  }, [offset]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
