import "server-only";

/**
 * Voice notes to text, for WhatsApp. Uses OpenAI's speech-to-text (handles
 * English, Urdu and a mix). Needs OPENAI_API_KEY; without it voice notes get
 * a polite "send it as text" reply. TRANSCRIBE_URL can point at a stand-in.
 */

export const isTranscribeConfigured = () => !!process.env.OPENAI_API_KEY;

export async function transcribe(audio: ArrayBuffer, mimeType: string): Promise<string> {
  const ext = mimeType.includes("mpeg") ? "mp3" : mimeType.includes("mp4") || mimeType.includes("aac") ? "m4a" : mimeType.includes("amr") ? "amr" : "ogg";
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mimeType.split(";")[0] }), `voice.${ext}`);
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("prompt", "A work instruction at Highfy, a beauty e-commerce company in Pakistan. May mix English and Urdu. Names like Ayesha, Bilal, Sana, Hanzala.");
  const res = await fetch(process.env.TRANSCRIBE_URL || "https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`transcribe ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { text } = (await res.json()) as { text?: string };
  return (text ?? "").trim();
}
