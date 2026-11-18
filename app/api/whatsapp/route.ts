import { NextResponse, after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userById } from "@/lib/mcp/keys";
import { flushPush } from "@/lib/push";
import { isAiConfigured } from "@/lib/ai/claude";
import { isTranscribeConfigured, transcribe } from "@/lib/transcribe";
import { downloadMedia, isWhatsAppConfigured, markRead, normalisePhone, sendText, validSignature } from "@/lib/whatsapp";
import { handleWhatsAppMessage, type ChatTurn } from "@/lib/whatsapp-agent";
import { siteUrl } from "@/lib/calendar/sync";

// The WhatsApp webhook (set in Meta: WhatsApp → Configuration). Messages are
// answered after Meta gets its 200, so it never retries because we were slow.
export const maxDuration = 120;

/** Meta checks the address once, with the verify token you chose. */
export function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && process.env.WHATSAPP_VERIFY_TOKEN && p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

type WaMessage = { id: string; from: string; type: string; text?: { body: string }; audio?: { id: string; mime_type?: string } };

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!isWhatsAppConfigured() || !validSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new NextResponse("forbidden", { status: 403 });
  }
  let body: { entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const messages = (body.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.messages ?? []));
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
    .insert({ wa_id: m.id, phone, user_id: userId, direction: "in", kind, body: m.text?.body?.slice(0, 4000) ?? null });
  if (dup) return; // already handled
  await markRead(m.id);

  // "link 123456": connect this number to the person who made the code in My settings.
  const linkCode = /^\s*link\s+(\d{6})\s*$/i.exec(m.text?.body ?? "")?.[1];
  if (linkCode) {
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

  let text = m.text?.body?.trim() ?? "";
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
  if (!text) return reply(phone, userId, "I can read text messages and voice notes. Send the task as one of those.");

  // The last day's conversation, so "make it Monday" knows what "it" is.
  const { data: past } = await db
    .from("whatsapp_messages")
    .select("direction, body")
    .eq("phone", phone)
    .neq("wa_id", m.id)
    .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(12);
  const recent: ChatTurn[] = ((past ?? []) as { direction: string; body: string | null }[])
    .reverse()
    .filter((r) => r.body)
    .map((r) => ({ role: r.direction === "in" ? "user" : "assistant", text: r.body! }));

  let answer: string;
  try {
    answer = await handleWhatsAppMessage(u, kind === "audio" ? `(voice note) ${text}` : text, recent);
  } catch (e) {
    console.error("[whatsapp:agent]", e);
    answer = "Something went wrong on my side. Try again in a minute.";
  }
  await reply(phone, userId, kind === "audio" ? `🎤 “${text.slice(0, 300)}”\n\n${answer}` : answer);
  await flushPush();
}
