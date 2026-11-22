import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, callTool } from "@/lib/mcp/tools";
import type { KeyUser } from "@/lib/mcp/keys";
import { siteUrl } from "@/lib/calendar/sync";
import { formatDate, nowTimePKT, todayPKT } from "@/lib/time";

/**
 * Reads a WhatsApp message (or a voice note's words) and does what it asks in
 * Highfy Tasks, as the person who sent it, with the same tools the Claude
 * connector uses: create and update tasks, look people and tasks up, comment.
 * Nothing can be deleted. Returns the WhatsApp reply.
 */

const MODEL = "claude-opus-5-5";
const MAX_STEPS = 8;

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim(), maxRetries: 2, timeout: 90_000 }));

export type ChatTurn = { role: "user" | "assistant"; text: string };

function system(u: KeyUser) {
  const today = todayPKT();
  return `You are Highfy Tasks on WhatsApp, the task app of Highfy (a beauty e-commerce company in Pakistan). You are talking to ${u.name} <${u.email}>, who is signed in. Everything you do in the app is done as them, with their permissions.

Today is ${formatDate(today, "EEEE d MMMM yyyy")} (${today}), ${nowTimePKT().slice(0, 5)} Pakistan time.

What to do:
- Anything dropped in this chat becomes a task straight away: an instruction, a note, a link, a forwarded message, a caption. Don't ask what they mean; make the task. Several separate things in one message means several tasks. Voice notes are transcribed and may mix English and Urdu, with transcription slips.
- Title: a short task title in the sender's words. Put the full message in the notes ("description") so links and details are kept.
- Owner: the sender, unless someone else is mentioned as the one to do it ("@Bilal", "Bilal to…", "ask Sana to…", "for Ayesha"). Then that person owns it. Look people up with list_people. If a name matches more than one person, give it to the sender and say in the reply which names matched, so they can say who.
- Due date: none, unless the message gives one ("Friday", "tomorrow", "end of week", "by the 20th" become a date).
- Team, project or campaign: only when the message names one (list_projects if unsure). If it names none, make it a private task (private: true): no team, nothing to ask. Say "private" in the reply.
- Earlier messages marked [already handled] were dealt with already. Never make tasks for them again; use them only to understand corrections and follow-ups. Act only on the latest message (or numbered list of messages).
- Corrections right after ("make it Monday", "give it to Sana", "that's 2 tasks") change what you just did; find the task in the conversation or with search_tasks and update it.
- Only a clear question about tasks ("what's due today?", "what does Bilal have?") is answered with the read tools instead of making a task.
- You cannot delete or cancel anything. Say so if asked, and point them to the app.

Replies go to WhatsApp: short, plain, friendly, no markdown headings or tables. One line per task, like
✅ Send BF banner sizes · Bilal · due Fri 20 Nov
and the link to the task from the tool's answer. App: ${siteUrl()}`;
}

/** The recent conversation plus this message, as alternating turns starting with the person. */
function history(turns: ChatTurn[], text: string): Anthropic.MessageParam[] {
  const all = [...turns, { role: "user" as const, text }];
  const out: Anthropic.MessageParam[] = [];
  for (const t of all) {
    const last = out.at(-1);
    if (last && last.role === t.role) last.content = `${last.content as string}\n${t.text}`;
    else out.push({ role: t.role, content: t.text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

const tools: Anthropic.Tool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
}));

export async function handleWhatsAppMessage(u: KeyUser, text: string, recent: ChatTurn[]): Promise<string> {
  const messages = history(recent, text);
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: system(u),
      tools,
      messages,
    });
    if (res.stop_reason === "refusal") return "Sorry, I can't help with that one. Try the app instead.";
    if (res.stop_reason !== "tool_use") {
      const reply = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return reply || "Done.";
    }
    // Run the tools it asked for (as this person), then let it carry on.
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const out = await callTool(u, block.name, (block.input ?? {}) as Record<string, unknown>);
      results.push({ type: "tool_result", tool_use_id: block.id, content: out.text.slice(0, 20000), is_error: out.isError || undefined });
    }
    messages.push({ role: "user", content: results });
  }
  return "That took more steps than I can do in one go. Check the app to see what got done.";
}
