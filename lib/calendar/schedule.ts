import "server-only";
import { after } from "next/server";
import { isCalendarConfigured } from "./graph";

/** Run an Outlook sync after the response is sent, so saving never waits on Microsoft. */
export function syncLater(fn: () => Promise<unknown>) {
  if (!isCalendarConfigured()) return;
  after(fn);
}
