"use client";

import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Every 15 minutes from 6:00 am to 11:45 pm, as "HH:mm". */
const STEPS = Array.from({ length: 72 }, (_, i) => `${String(6 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);

/**
 * Time picker that always shows am/pm (the browser's own picker follows the
 * computer's region and may show 24-hour). Value is "HH:mm", or "" for none.
 */
export function TimeSelect({
  id,
  name,
  value,
  defaultValue,
  onChange,
  required,
  disabled,
  emptyLabel,
  className,
}: {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** Shown for "no time"; leave out when a time is required. */
  emptyLabel?: string;
  className?: string;
}) {
  const current = (value ?? defaultValue ?? "").slice(0, 5);
  // Keep an existing off-grid time (e.g. 12:38) selectable.
  const options = current && !STEPS.includes(current) ? [...STEPS, current].sort() : STEPS;
  return (
    <select
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      {...(value !== undefined ? { value: value.slice(0, 5) } : { defaultValue: current })}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn("h-10 w-full field px-3 text-sm disabled:opacity-60", className)}
    >
      {(emptyLabel !== undefined || !current) && <option value="">{emptyLabel ?? "Pick a time"}</option>}
      {options.map((t) => (
        <option key={t} value={t}>
          {formatTime(t)}
        </option>
      ))}
    </select>
  );
}
