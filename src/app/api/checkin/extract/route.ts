import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Estrazione AI dei dati da una foto del documento d'identità (check-in online).
// Usa la vision API di Anthropic. Richiede ANTHROPIC_API_KEY impostata su Vercel;
// se assente, ritorna ai_not_configured e il client nasconde/disattiva il pulsante.
// I dati estratti sono SOLO un pre-riempimento: l'ospite li verifica prima di inviare.

const MODEL = process.env.CHECKIN_AI_MODEL || "claude-haiku-4-5-20251001";

const PROMPT = `Sei un assistente che legge documenti d'identità (carta d'identità, passaporto, patente).
Estrai i dati e rispondi SOLO con un oggetto JSON valido, senza testo extra, con queste chiavi (stringhe; usa "" se non leggibile):
{"firstName":"","lastName":"","sex":"M|F|","birthDate":"YYYY-MM-DD","birthPlace":"","citizenship":"","docType":"Carta d'identità|Passaporto|Patente|Permesso di soggiorno|","docNumber":"","docPlace":""}
Regole: birthDate in formato ISO YYYY-MM-DD. sex = "M" o "F". Non inventare: se un campo non è leggibile lascia "".`;

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "ai_not_configured" }, { status: 503 });
  try {
    const body = await req.json().catch(() => ({}));
    const image = String(body?.image || "");
    const m = image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
    if (!m) return NextResponse.json({ ok: false, error: "bad_image" }, { status: 400 });
    const mediaType = m[1];
    const data = m[2];
    if (data.length > 8_000_000) return NextResponse.json({ ok: false, error: "image_too_large" }, { status: 413 });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ ok: false, error: "ai_error", message: j?.error?.message || `HTTP ${res.status}` }, { status: 502 });
    const text: string = Array.isArray(j?.content) ? j.content.map((c: { text?: string }) => c?.text || "").join("") : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ ok: false, error: "no_json" }, { status: 502 });
    let fields: Record<string, string> = {};
    try { fields = JSON.parse(jsonMatch[0]); } catch { return NextResponse.json({ ok: false, error: "parse_error" }, { status: 502 }); }
    const pick = (k: string) => (typeof fields[k] === "string" ? fields[k].trim() : "");
    return NextResponse.json({
      ok: true,
      fields: {
        firstName: pick("firstName"), lastName: pick("lastName"), sex: pick("sex") === "M" || pick("sex") === "F" ? pick("sex") : "",
        birthDate: /^\d{4}-\d{2}-\d{2}$/.test(pick("birthDate")) ? pick("birthDate") : "",
        birthPlace: pick("birthPlace"), citizenship: pick("citizenship"), docType: pick("docType"), docNumber: pick("docNumber"), docPlace: pick("docPlace"),
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
