/**
 * A little variety in the app's voice, so it doesn't say the same flat
 * sentence every day. Picks are stable for a given day (no flicker between
 * server and browser). Plain and warm, never hype; see docs/BRAND.md.
 */

function pick(lines: readonly string[], seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return lines[h % lines.length];
}

const ALL_CLEAR = [
  "Nothing overdue. Nice and tidy.",
  "All caught up. Enjoy it.",
  "Clean slate. Nothing overdue.",
  "Nothing overdue. Go get a coffee.",
  "You're on top of things today.",
] as const;

const OVERDUE_NUDGE = [
  "Start there.",
  "Worth clearing first.",
  "Knock those out and the rest is easy.",
  "Small steps. One at a time.",
] as const;

const CLEARED_TODAY = [
  "Today's list is clear. Well done.",
  "That's everything for today. Nicely done.",
  "Today, sorted.",
  "All done for today. Take a breather.",
] as const;

const EMPTY_INBOX = [
  "Nothing assigned to you. Quiet day.",
  "Inbox zero. Enjoy the calm.",
  "No tasks here. Add one above when something comes up.",
] as const;

export function todayLine(day: string, overdue: number, dueToday: number): { tone: "good" | "bad"; text: string } {
  if (overdue > 0) {
    return { tone: "bad", text: `${overdue} overdue. ${pick(OVERDUE_NUDGE, day)}` };
  }
  const head = pick(ALL_CLEAR, day);
  return { tone: "good", text: dueToday ? `${head} ${dueToday} due today.` : head };
}

export const clearedLine = (seed: string) => pick(CLEARED_TODAY, seed);
export const emptyLine = (seed: string) => pick(EMPTY_INBOX, seed);
