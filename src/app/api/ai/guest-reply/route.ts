// Bozza di risposta all'ospite generata da Claude, nella lingua dell'ospite.
// Dato il thread (ultimi messaggi) + info prenotazione/struttura, propone una risposta
// cortese e utile che l'operatore rivede prima di inviare (tassello "AI ovunque").
// GATING: se ANTHROPIC_API_KEY manca → { ok:false, error:"ai_not_configured" } (nessun crash).
// Coerente con /api/reviews/reply e /api/checkin/extract (stessa versione API + modello Claude).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stesso default degli altri endpoint AI del repo; override via env dedicata se serve.
const MODEL = process.env.GUEST_REPLY_AI_MODEL || process.env.REVIEWS_AI_MODEL || process.env.CHECKIN_AI_MODEL || "claude-haiku-4-5-20251001";

const LANG_NAMES: Record<string, string> = {
  it: "italiano", en: "inglese", fr: "francese", de: "tedesco", es: "spagnolo",
};

// Se Supabase è configurato, richiedi un utente autenticato (come /api/reviews/reply).
async function ensureAuth(req: NextRequest): Promise<NextResponse | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return null;
  } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
}

interface InMsg { dir?: "in" | "out"; text?: string }

export async function POST(req: NextRequest) {
  const gate = await ensureAuth(req); if (gate) return gate;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "ai_not_configured" });

  const b = await req.json().catch(() => ({})) as {
    messages?: InMsg[]; lang?: string; guestName?: string; structureName?: string;
    room?: string; checkIn?: string; checkOut?: string;
  };

  const lang = (b.lang || "it").toLowerCase();
  const langName = LANG_NAMES[lang] || "la stessa lingua usata dall'ospite";
  const guestName = (b.guestName || "").trim();
  const structureName = (b.structureName || "la struttura").trim();
  const room = (b.room || "").trim();
  const checkIn = (b.checkIn || "").trim();
  const checkOut = (b.checkOut || "").trim();

  // Ultimi messaggi del thread (max 12), come trascrizione Ospite/Struttura.
  const transcript = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m) => m && typeof m.text === "string" && m.text.trim())
    .slice(-12)
    .map((m) => `${m.dir === "out" ? "Struttura" : "Ospite"}: ${(m.text || "").replace(/\s+/g, " ").trim()}`)
    .join("\n");

  const facts = [
    guestName ? `- Ospite: ${guestName}` : "- Ospite: (nome non disponibile)",
    `- Struttura: ${structureName}`,
    room ? `- Camera/sistemazione: ${room}` : null,
    checkIn ? `- Check-in: ${checkIn}` : null,
    checkOut ? `- Check-out: ${checkOut}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `Sei chi gestisce "${structureName}", una struttura ricettiva. Scrivi UNA bozza di risposta al messaggio dell'ospite, che l'operatore rivedrà prima di inviarla.
Regole:
- Scrivi in ${langName} (la lingua dell'ospite), tono caldo, cortese e professionale.
- Rispondi all'ULTIMO messaggio dell'ospite tenendo conto di tutta la conversazione.
- Rivolgiti all'ospite per nome se disponibile.
- Sii concreto e utile, breve (2-5 frasi). Nessun preambolo, nessuna firma.
- NON inventare fatti (prezzi, disponibilità, orari, servizi, codici) che non siano indicati qui sotto: se un'informazione manca, rispondi in modo generico o di' che verificherai/confermerai a breve.
- NON usare segnaposto tra parentesi quadre.
Dati della prenotazione:
${facts}
Conversazione (dal più vecchio al più recente):
"""
${transcript || "(nessun messaggio precedente: l'ospite non ha ancora scritto)"}
"""
Rispondi SOLO con il testo della bozza, senza virgolette né commenti.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: `http_${res.status}` }, { status: 502 });
    const j = await res.json().catch(() => null) as { content?: { type: string; text?: string }[] } | null;
    const draft = (j?.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("").trim();
    if (!draft) return NextResponse.json({ ok: false, error: "empty" }, { status: 502 });
    return NextResponse.json({ ok: true, draft });
  } catch {
    return NextResponse.json({ ok: false, error: "fetch_failed" }, { status: 502 });
  }
}
