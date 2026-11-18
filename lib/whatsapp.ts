import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp Cloud API (Meta): check that a webhook really came from Meta,
 * send a text reply, and download a voice note. Needs WHATSAPP_TOKEN,
 * WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN.
 * WHATSAPP_GRAPH_URL can point at a stand-in for testing.
 */

const GRAPH = () => process.env.WHATSAPP_GRAPH_URL || "https://graph.facebook.com/v25.0";

export const isWhatsAppConfigured = () =>
  !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN);

/** Meta signs every webhook with the app secret (X-Hub-Signature-256: sha256=<hex>). */
export function validSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const auth = () => ({ Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` });

/** A plain text reply. Free inside the 24 hours after the person's last message. */
export async function sendText(to: string, body: string): Promise<void> {
  const res = await fetch(`${GRAPH()}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body: body.slice(0, 4000) } }),
  });
  if (!res.ok) console.error("[whatsapp:send]", res.status, (await res.text()).slice(0, 300));
}

/** Show the person their message was read (the blue ticks). */
export async function markRead(messageId: string): Promise<void> {
  await fetch(`${GRAPH()}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  }).catch(() => undefined);
}

/** A voice note's audio: first its address, then the file. */
export async function downloadMedia(mediaId: string): Promise<{ data: ArrayBuffer; mimeType: string }> {
  const meta = await fetch(`${GRAPH()}/${mediaId}`, { headers: auth() });
  if (!meta.ok) throw new Error(`media lookup ${meta.status}`);
  const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string };
  const file = await fetch(url, { headers: auth() });
  if (!file.ok) throw new Error(`media download ${file.status}`);
  return { data: await file.arrayBuffer(), mimeType: mime_type || "audio/ogg" };
}

/** WhatsApp numbers arrive as digits with the country code ("923001234567"). */
export const normalisePhone = (raw: string) => {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 11) d = `92${d.slice(1)}`; // 0300… (Pakistan)
  return d;
};
