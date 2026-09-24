// Estrazione AI dei dati da una foto del documento d'identità (check-in online).
// Logica condivisa usata dalla route /api/ai/checkin-extract.
//
// Usa la vision API di Anthropic (Claude). Richiede ANTHROPIC_API_KEY (Vercel);
// se assente → { ok:false, error:"ai_not_configured" } e il client nasconde/disattiva
// il pulsante. I dati estratti sono SOLO un pre-riempimento: l'ospite li verifica
// sempre prima di inviare. L'immagine NON viene salvata: serve solo alla lettura.

// Modello Claude: riusa la costante già presente nel repo per coerenza
// (vedi /api/reviews/reply e la vecchia /api/checkin/extract).
export const CHECKIN_AI_MODEL = process.env.CHECKIN_AI_MODEL || "claude-haiku-4-5-20251001";

// Campi estratti dal documento (tutte stringhe; "" se non leggibile).
export interface CheckinDocFields {
  firstName: string;
  lastName: string;
  sex: string;        // "M" | "F" | ""
  birthDate: string;  // YYYY-MM-DD | ""
  birthPlace: string;
  citizenship: string;
  docType: string;
  docNumber: string;
  docPlace: string;
}

export type ExtractResult =
  | { ok: true; fields: CheckinDocFields }
  | { ok: false; error: string; status: number; message?: string };

const PROMPT = `Sei un assistente che legge documenti d'identità (carta d'identità, passaporto, patente).
Estrai i dati e rispondi SOLO con un oggetto JSON valido, senza testo extra, con queste chiavi (stringhe; usa "" se non leggibile):
{"firstName":"","lastName":"","sex":"M|F|","birthDate":"YYYY-MM-DD","birthPlace":"","citizenship":"","docType":"Carta d'identità|Passaporto|Patente di guida|Permesso di soggiorno|","docNumber":"","docPlace":""}
Regole: birthDate in formato ISO YYYY-MM-DD. sex = "M" o "F". Non inventare NULLA: se un campo non è leggibile lascia "".`;

// Legge un'immagine (dataURL base64) e restituisce i campi estratti.
// Gating: senza ANTHROPIC_API_KEY → ai_not_configured (nessun crash).
export async function extractCheckinDoc(image: string): Promise<ExtractResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ai_not_configured", status: 503 };

  const m = String(image || "").match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!m) return { ok: false, error: "bad_image", status: 400 };
  const mediaType = m[1];
  const data = m[2];
  if (data.length > 8_000_000) return { ok: false, error: "image_too_large", status: 413 };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: CHECKIN_AI_MODEL,
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
    if (!res.ok) return { ok: false, error: "ai_error", status: 502, message: j?.error?.message || `HTTP ${res.status}` };

    const text: string = Array.isArray(j?.content) ? j.content.map((c: { text?: string }) => c?.text || "").join("") : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: false, error: "no_json", status: 502 };
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(jsonMatch[0]); } catch { return { ok: false, error: "parse_error", status: 502 }; }

    const pick = (k: string) => (typeof parsed[k] === "string" ? (parsed[k] as string).trim() : "");
    const sex = pick("sex");
    const birthDate = pick("birthDate");
    const fields: CheckinDocFields = {
      firstName: pick("firstName"),
      lastName: pick("lastName"),
      sex: sex === "M" || sex === "F" ? sex : "",
      birthDate: /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? birthDate : "",
      birthPlace: pick("birthPlace"),
      citizenship: pick("citizenship"),
      docType: pick("docType"),
      docNumber: pick("docNumber"),
      docPlace: pick("docPlace"),
    };
    return { ok: true, fields };
  } catch (e) {
    return { ok: false, error: "server_error", status: 500, message: (e as Error)?.message ?? "errore" };
  }
}
