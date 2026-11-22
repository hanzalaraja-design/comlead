import { NextResponse, after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userById } from "@/lib/mcp/keys";
import { flushPush } from "@/lib/push";
import { isAiConfigured } from "@/lib/ai/claude";
import { isTranscribeConfigured, transcribe } from "@/lib/transcribe";
import { downloadMedia, isWhatsAppConfigured, markRead, normalisePhone, sendText, validSignature, verifyTokenMatches } from "@/lib/whatsapp";
import { handleWhatsAppMessage, type ChatTurn } from "@/lib/whatsapp-agent";
import { siteUrl } from "@/lib/calendar/sync";

// The WhatsApp webhook (set in Meta: WhatsApp → Configuration). Messages are
// answered after Meta gets its 200, so it never retries because we were slow.
export const maxDuration = 120;

/** How long to wait for the rest of a quick burst of messages before answering. */
const BATCH_WAIT_MS = 4000;

/** Meta checks the address once, with the verify token you chose. */
export function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && verifyTokenMatches(p.get("hub.verify_token"))) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

type WaMessage = {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string };
  // A photo, video or file can come with a caption: the caption becomes the task.
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
};

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!isWhatsAppConfigured()) {
    console.error("[whatsapp] a message arrived but the WHATSAPP_* settings aren't all set on this deployment");
    return new NextResponse("forbidden", { status: 403 });
  }
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) {
    console.error("[whatsapp] signature didn't match: WHATSAPP_APP_SECRET isn't this Meta app's App secret");
    return new NextResponse("forbidden", { status: 403 });
  }
  let body: { entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const messages = (body.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.messages ?? []));
  if (messages.length) console.info(`[whatsapp] ${messages.length} message(s) received`);
  if (messages.length) after(() => Promise.all(messages.map(handle)).catch((e) => console.error("[whatsapp]", e)));
  // Status updates (sent, delivered, read) need nothing.
  return NextResponse.json({ ok: true });
}

async function reply(phone: string, userId: string | null, text: string) {
  await sendText(phone, text);
  await createAdminClient().from("whatsapp_messages").insert({ phone, user_id: userId, direction: "out", body: text.slice(0, 4000) });
}

async function handle(m: WaMessage) {
  const db = createAdminClient();
  const phone = normalisePhone(m.from);
  const kind = m.type === "text" ? "text" : m.type === "audio" ? "audio" : "other";

  // WhatsApp can send the same message twice; the unique id stops a second run.
  const { data: link } = await db.from("whatsapp_links").select("user_id").eq("phone", phone).maybeSingle();
  const userId = (link?.user_id as string | undefined) ?? null;
  const { error: dup } = await db
    .from("whatsapp_messages")
    .insert({ wa_id: m.id, phone, user_id: userId, direction: "in", kind, body: (m.text?.body ?? m.image?.caption ?? m.video?.caption ?? m.document?.caption)?.slice(0, 4000) ?? null });
  if (dup?.code === "23505") return; // already handled
  if (dup) console.error("[whatsapp] couldn't record the message (has the WhatsApp SQL been run?):", dup.message);
  await markRead(m.id);

  // "link 123456": connect this number to the person who made the code in My settings.
  const linkCode = /^\s*link\s+(\d{6})\s*$/i.exec(m.text?.body ?? "")?.[1];
  if (linkCode) {
    await db.from("whatsapp_messages").update({ handled_at: new Date().toISOString() }).eq("wa_id", m.id);
    const { data: code } = await db.from("whatsapp_link_codes").select("user_id, expires_at").eq("code", linkCode).maybeSingle();
    if (!code || new Date(code.expires_at as string) < new Date()) return reply(phone, null, "That code isn't valid any more. Make a new one in My settings → WhatsApp.");
    await db.from("whatsapp_links").delete().or(`phone.eq.${phone},user_id.eq.${code.user_id}`);
    const { error } = await db.from("whatsapp_links").insert({ user_id: code.user_id, phone });
    await db.from("whatsapp_link_codes").delete().eq("user_id", code.user_id);
    if (error) return reply(phone, null, "Couldn't link this number. Try again from My settings.");
    const u = await userById(code.user_id as string);
    return reply(phone, code.user_id as string, `Linked to ${u?.name ?? "your account"}. Send me tasks as a message or a voice note, e.g. "Ask Bilal to send the banner sizes by Friday".`);
  }

  if (!userId) return reply(phone, null, `This number isn't linked to Highfy Tasks. Open ${siteUrl()}/settings#whatsapp, make a code, and send "link" and the code here.`);
  const u = await userById(userId);
  if (!u) return reply(phone, userId, "Your Highfy Tasks account isn't active. Ask an Admin.");
  if (!isAiConfigured()) return reply(phone, userId, "The assistant isn't set up yet. Ask an Admin to add the Anthropic key.");

  let text = (m.text?.body ?? m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? "").trim();
  if (kind === "audio" && m.audio) {
    if (!isTranscribeConfigured()) return reply(phone, userId, "Voice notes aren't switched on yet. Send it as a text for now.");
    try {
      const audio = await downloadMedia(m.audio.id);
      text = await transcribe(audio.data, m.audio.mime_type ?? audio.mimeType);
      await db.from("whatsapp_messages").update({ body: `🎤 ${text}`.slice(0, 4000) }).eq("wa_id", m.id);
    } catch (e) {
      console.error("[whatsapp:voice]", e);
      return reply(phone, userId, "Couldn't listen to that voice note. Try again, or send it as text.");
    }
    if (!text) return reply(phone, userId, "I couldn't make out any words in that voice note.");
  }
  if (!text) return reply(phone, userId, "I can read text, voice notes and captions. Add a few words about the task and send it again.");

  // Messages sent in quick succession are handled together, once: wait a moment
  // for the rest to arrive, then take every waiting message from this number.
  // Whichever handler takes them answers; the others find nothing and stop.
  await new Promise((resolve) => setTimeout(resolve, BATCH_WAIT_MS));
  const { data: taken, error: takeErr } = await db
    .from("whatsapp_messages")
    .update({ handled_at: new Date().toISOString() })
    .eq("phone", phone)
    .eq("direction", "in")
    .is("handled_at", null)
    .not("body", "is", null)
    .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .select("wa_id, kind, body, created_at");
  let batch: { kind: string; body: string }[];
  if (takeErr) {
    // The batching SQL hasn't been run yet: handle just this message.
    console.error("[whatsapp] couldn't take waiting messages (has the WhatsApp batches SQL been run?):", takeErr.message);
    batch = [{ kind, body: text }];
  } else {
    batch = ((taken ?? []) as { kind: string; body: string; created_at: string }[])
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((r) => ({ kind: r.kind, body: r.body.replace(/^🎤 /, "") }));
    if (!batch.length) return; // another handler took them
  }

  // Earlier conversation: only what was already handled, and the replies, so
  // "make it Monday" knows what "it" is and nothing is done twice.
  const takenIds = new Set(((taken ?? []) as { wa_id: string }[]).map((t) => t.wa_id));
  let pastQuery = db
    .from("whatsapp_messages")
    .select("wa_id, direction, body")
    .eq("phone", phone)
    .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(16);
  if (!takeErr) pastQuery = pastQuery.or("direction.eq.out,handled_at.not.is.null");
  const { data: past } = await pastQuery;
  const recent: ChatTurn[] = ((past ?? []) as { wa_id: string | null; direction: string; body: string | null }[])
    .filter((r) => r.body && !(r.wa_id && (takenIds.has(r.wa_id) || r.wa_id === m.id)))
    .reverse()
    // Labelled, so a reply that's still on its way can't make it look undone.
    .map((r) => ({ role: r.direction === "in" ? "user" : "assistant", text: r.direction === "in" ? `[already handled] ${r.body}` : r.body! }));

  const asText = (b: { kind: string; body: string }) => (b.kind === "audio" ? `(voice note) ${b.body}` : b.body);
  const prompt =
    batch.length === 1
      ? asText(batch[0])
      : `${batch.length} messages sent one after another. Each is a separate task unless it's clearly part of the one before:\n${batch.map((b, i) => `${i + 1}. ${asText(b)}`).join("\n")}`;

  let answer: string;
  try {
    answer = await handleWhatsAppMessage(u, prompt, recent);
  } catch (e) {
    console.error("[whatsapp:agent]", e);
    answer = "Something went wrong on my side. Try again in a minute.";
  }
  const heard = batch.length === 1 && batch[0].kind === "audio" ? `🎤 “${batch[0].body.slice(0, 300)}”\n\n` : "";
  await reply(phone, userId, heard + answer);
  await flushPush();
}
