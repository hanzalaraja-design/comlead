import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

/**
 * Thin wrapper around the Claude API for the meeting assistant.
 * The key lives only in the ANTHROPIC_API_KEY server env var.
 * ANTHROPIC_BASE_URL (read by the SDK) can point at a stand-in for testing.
 */

const MODEL = "claude-opus-5-5";

/** The key as set in Vercel, minus any stray spaces or line breaks from pasting. */
function apiKey(): string {
  return process.env.ANTHROPIC_API_KEY?.trim() ?? "";
}

export function isAiConfigured(): boolean {
  return Boolean(apiKey());
}

/** What the running deployment can see, for the Admin status page. Never returns the key. */
export function aiEnvReport() {
  const raw = process.env.ANTHROPIC_API_KEY;
  return {
    keySet: Boolean(apiKey()),
    looksRight: apiKey().startsWith("sk-ant-"),
    hadWhitespace: raw !== undefined && raw !== raw.trim(),
    // Names only: catches a typo such as ANTHROPIC_KEY or a trailing space in the name.
    similarNames: Object.keys(process.env).filter(
      (k) => k !== "ANTHROPIC_API_KEY" && (k.trim() === "ANTHROPIC_API_KEY" || (/anthropic|claude/i.test(k) && /key/i.test(k))),
    ),
    environment: process.env.VERCEL_ENV ?? "local",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    host: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? null,
  };
}

let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic({ apiKey: apiKey(), maxRetries: 2, timeout: 90_000 });
  return client;
}

/** House style, shared by every prompt. Mirrors docs/BRAND.md section 9. */
export const VOICE = `Write like a calm, honest colleague at Highfy: plain, specific, a little dry.
- Say the plain true thing. No hype, no filler, no exaggerated cheer.
- No exclamation marks. No emoji. No em dashes; use a comma, a full stop or "and" instead.
- Sentence case for every heading and line.
- British English spelling.
- Keep people's names, numbers, dates and product names exactly as written. Never invent facts that are not in the input.`;

export class AiError extends Error {}

/**
 * One structured call: returns data matching `schema` (a JSON schema sent to
 * the API) after validating it with `parser` (zod). Throws AiError with a
 * message that can be shown to the person.
 */
export async function structuredCall<T>({
  system,
  prompt,
  schema,
  parser,
  effort = "low",
  maxTokens = 8000,
  label,
}: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  parser: z.ZodType<T>;
  effort?: "low" | "medium";
  maxTokens?: number;
  label: string;
}): Promise<T> {
  if (!isAiConfigured()) throw new AiError("The assistant isn't set up yet. An Admin needs to add ANTHROPIC_API_KEY.");

  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      // If a safety check declines the request, the API retries it on its
      // recommended fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort, format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (error) {
    console.error(`[ai:${label}]`, error);
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError)
      throw new AiError("The assistant's API key was refused. An Admin needs to check ANTHROPIC_API_KEY.");
    if (error instanceof Anthropic.RateLimitError) throw new AiError("The assistant is busy. Try again in a minute.");
    if (error instanceof Anthropic.APIConnectionError) throw new AiError("Couldn't reach the assistant. Try again.");
    throw new AiError("The assistant couldn't do that just now. Try again.");
  }

  console.info(
    `[ai:${label}] ${response.model} in=${response.usage.input_tokens} out=${response.usage.output_tokens} stop=${response.stop_reason}`,
  );
  if (response.stop_reason === "refusal") throw new AiError("The assistant declined this one. Edit it by hand.");
  if (response.stop_reason === "max_tokens") throw new AiError("That was too long for the assistant. Try a shorter section.");

  const text = response.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiError("The assistant's reply didn't make sense. Try again.");
  }
  const parsed = parser.safeParse(json);
  if (!parsed.success) {
    console.error(`[ai:${label}] invalid shape`, parsed.error.issues.slice(0, 3));
    throw new AiError("The assistant's reply didn't make sense. Try again.");
  }
  return parsed.data;
}
