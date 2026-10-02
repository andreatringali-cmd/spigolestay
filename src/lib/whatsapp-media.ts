// File multimediali dei messaggi WhatsApp in arrivo (per ora i vocali) e loro trascrizione.
// Il file resta presso Meta (si scarica con l'id, valido ~30 giorni): in Xenora salviamo solo id e trascrizione.
// Trascrizione: GROQ_API_KEY (Whisper, veloce) oppure OPENAI_API_KEY; senza chiavi il vocale arriva comunque, senza testo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWhatsappToken } from "@/lib/whatsapp";

const GRAPH = "https://graph.facebook.com/v21.0";

export async function fetchWaMedia(admin: SupabaseClient, tenantId: string, mediaId: string): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  const token = await getWhatsappToken(admin, tenantId);
  if (!token || !/^\d+$/.test(mediaId)) return null;
  try {
    const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!meta.ok) return null;
    const j = await meta.json() as { url?: string; mime_type?: string };
    if (!j.url) return null;
    const file = await fetch(j.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!file.ok) return null;
    return { bytes: await file.arrayBuffer(), mime: j.mime_type || file.headers.get("content-type") || "audio/ogg" };
  } catch { return null; }
}

export const transcriptionConfigured = () => !!(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);

export async function transcribeAudio(bytes: ArrayBuffer, mime: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const groq = process.env.GROQ_API_KEY, openai = process.env.OPENAI_API_KEY;
  if (!groq && !openai) return { ok: false, error: "stt_not_configured" };
  try {
    const form = new FormData();
    const ext = /mpeg|mp3/.test(mime) ? "mp3" : /mp4|aac|m4a/.test(mime) ? "m4a" : /amr/.test(mime) ? "amr" : "ogg";
    form.append("file", new Blob([bytes], { type: mime.split(";")[0] || "audio/ogg" }), `vocale.${ext}`);
    form.append("model", groq ? "whisper-large-v3-turbo" : "whisper-1");
    form.append("response_format", "json");
    const res = await fetch(groq ? "https://api.groq.com/openai/v1/audio/transcriptions" : "https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${groq || openai}` }, body: form,
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const j = await res.json().catch(() => null) as { text?: string } | null;
    const text = (j?.text || "").trim();
    return text ? { ok: true, text } : { ok: false, error: "empty" };
  } catch (e) { return { ok: false, error: (e as Error)?.message ?? "stt_failed" }; }
}
