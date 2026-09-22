// Risposta AI (reale) a una recensione, generata da Claude. Personalizzata sul testo/voto.
// Se ANTHROPIC_API_KEY non è configurata → { ok:false, configured:false } (il client usa il template).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.REVIEWS_AI_MODEL || process.env.CHECKIN_AI_MODEL || "claude-haiku-4-5-20251001";

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

export async function POST(req: NextRequest) {
  const gate = await ensureAuth(req); if (gate) return gate;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ ok: false, configured: false });

  const b = await req.json().catch(() => ({})) as { guest?: string; rating?: number; text?: string; structureName?: string; source?: string; lang?: string };
  const guest = (b.guest || "").trim();
  const rating = typeof b.rating === "number" ? b.rating : undefined; // 0..10
  const text = (b.text || "").trim();
  const structureName = (b.structureName || "la struttura").trim();
  const tone = rating == null ? "neutro" : rating >= 8 ? "positivo" : rating >= 6 ? "neutro" : "negativo";

  const prompt = `Sei chi gestisce "${structureName}", una struttura ricettiva. Scrivi UNA risposta pubblica alla recensione di un ospite.
Regole:
- In italiano, tono caldo, professionale e sincero (evita frasi fatte e sdolcinature).
- 2-4 frasi, adatte a comparire pubblicamente sotto la recensione.
- Rivolgiti all'ospite per nome se disponibile.
- Fai riferimento a DETTAGLI SPECIFICI citati nella recensione (non generico).
- Se la recensione è negativa: scusati con garbo, riconosci il punto, mostra come rimedierai, invita a ricontattarti; niente difese polemiche.
- Se positiva: ringrazia con entusiasmo autentico e invita a tornare.
- NON usare segnaposto tra parentesi quadre, NON inventare fatti non presenti.
- Non firmare con nome e cognome di una persona; al massimo "${structureName}".
Dati:
- Ospite: ${guest || "(anonimo)"}
- Voto: ${rating != null ? `${rating}/10 (${tone})` : "non disponibile"}
- Testo recensione: """${text || "(nessun testo, solo voto)"}"""
Rispondi SOLO con il testo della risposta, senza virgolette né preamboli.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return NextResponse.json({ ok: false, configured: true, error: `http_${res.status}` }, { status: 502 });
    const j = await res.json().catch(() => null) as { content?: { type: string; text?: string }[] } | null;
    const reply = (j?.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("").trim();
    if (!reply) return NextResponse.json({ ok: false, configured: true, error: "empty" }, { status: 502 });
    return NextResponse.json({ ok: true, reply });
  } catch {
    return NextResponse.json({ ok: false, configured: true, error: "fetch_failed" }, { status: 502 });
  }
}
