"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { AiError, structuredCall } from "@/lib/ai/claude";
import type { ActionResult } from "@/lib/action-result";

/** Sends Claude one tiny request so an Admin can see whether the key works. */
export async function testAssistant(): Promise<ActionResult> {
  await requireAdmin();
  try {
    await structuredCall({
      label: "test",
      system: "Reply with the JSON asked for.",
      prompt: 'Return {"ok": true}.',
      schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
      parser: z.object({ ok: z.boolean() }),
      maxTokens: 2000,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof AiError ? error.message : "Something went wrong." };
  }
}
