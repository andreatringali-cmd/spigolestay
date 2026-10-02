// Concierge WhatsApp AI — risposta AUTOMATICA a domande di routine semplicissime (orario
// check-in/check-out, wifi, parcheggio, indicazioni stradali), usata dal webhook WhatsApp
// (src/app/api/whatsapp/webhook/route.ts) SOLO quando l'host ha attivato il toggle "Concierge AI"
// in Impostazioni (src/lib/aiConcierge.ts, default SPENTO).
//
// Sicurezza: l'AI deve rispondere SOLO se è sicura al 100% e ha tutti i dati necessari; per
// qualunque reclamo, richiesta economica/di pagamento, domanda ambigua o fuori dai 4 argomenti
// ammessi, restituisce canAnswer:false — il messaggio resta nella coda normale per l'host, esattamente
// come oggi (nessuna modifica al comportamento di default).
//
// Usa la stessa Messages API di Anthropic di src/lib/ai/checkin-extract.ts e di
// /api/ai/guest-reply. GATING: senza ANTHROPIC_API_KEY → { ok:false, error:"ai_not_configured" }
// (nessun crash, nessuna risposta automatica).
export const CONCIERGE_AI_MODEL = process.env.CONCIERGE_AI_MODEL || process.env.GUEST_REPLY_AI_MODEL || process.env.CHECKIN_AI_MODEL || "claude-haiku-4-5-20251001";

export type ConciergeTopic = "checkin_time" | "wifi" | "parking" | "directions" | "faq" | "other";
const SAFE_TOPICS: ConciergeTopic[] = ["checkin_time", "wifi", "parking", "directions", "faq"];

export interface ConciergeContext {
  guestName?: string;
  lang?: string; // it | en | fr | de | es
  structureName?: string;
  address?: string;
  checkInFrom?: string;
  checkInTo?: string;
  checkOutBy?: string;
  accessInfo?: string; // istruzioni/codici di accesso (possono contenere la rete/password wifi)
  hasParking?: boolean;
  faq?: { topic: string; answer: string }[]; // risposte scritte dal gestore (Messaggi → Concierge)
  hasBooking?: boolean; // l'interlocutore ha una prenotazione in corso o futura (false = contatto sconosciuto)
  transcript?: string; // breve contesto della conversazione (facoltativo)
  lastGuestMessage: string;
}

export interface ConciergeResult {
  canAnswer: boolean;
  reply: string;
  topic: ConciergeTopic;
}

export type ConciergeOutcome = { ok: true; result: ConciergeResult } | { ok: false; error: string };

const LANG_NAMES: Record<string, string> = { it: "italiano", en: "inglese", fr: "francese", de: "tedesco", es: "spagnolo" };

export async function getConciergeReply(ctx: ConciergeContext): Promise<ConciergeOutcome> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ai_not_configured" };
  const lastMsg = (ctx.lastGuestMessage || "").trim();
  if (!lastMsg) return { ok: false, error: "empty_message" };

  const langName = LANG_NAMES[(ctx.lang || "it").toLowerCase()] || "la stessa lingua usata dall'ospite";
  const facts = [
    ctx.structureName ? `- Struttura: ${ctx.structureName}` : null,
    ctx.address ? `- Indirizzo: ${ctx.address}` : null,
    (ctx.checkInFrom || ctx.checkInTo) ? `- Check-in: dalle ${ctx.checkInFrom || "?"}${ctx.checkInTo ? ` alle ${ctx.checkInTo}` : ""}` : null,
    ctx.checkOutBy ? `- Check-out: entro le ${ctx.checkOutBy}` : null,
    ctx.accessInfo ? `- Istruzioni/codici di accesso (possono includere rete e password wifi): ${ctx.accessInfo}` : null,
    typeof ctx.hasParking === "boolean" ? `- Parcheggio disponibile: ${ctx.hasParking ? "sì" : "no, non risulta disponibile"}` : null,
    ...(ctx.faq ?? []).map((f) => `- Informazione scritta dal gestore su "${f.topic}": ${f.answer}`),
  ].filter(Boolean).join("\n") || "(nessun dato strutturato disponibile)";

  const noBookingRule = ctx.hasBooking === false
    ? "\n- L'interlocutore NON risulta avere una prenotazione in corso: non rivelare MAI password Wi-Fi, codici o istruzioni di accesso e non dare dati riservati; rispondi solo con informazioni pubbliche (zona, orari, servizi) oppure canAnswer = false."
    : "";
  const prompt = `Sei il concierge automatico di "${ctx.structureName || "una struttura ricettiva"}": rispondi via WhatsApp SENZA revisione umana, quindi devi essere prudentissimo.
Puoi rispondere automaticamente SOLO a queste domande di routine, se hai i dati per farlo con certezza:
- checkin_time: orario di check-in e/o check-out
- wifi: rete/password wifi
- parking: disponibilità di parcheggio
- directions: indicazioni stradali per raggiungere la struttura (solo se l'indirizzo è tra i dati disponibili)
- faq: qualunque altra domanda (es. bagagli, colazione, animali, taxi) ma SOLO se una voce "Informazione scritta dal gestore" tra i dati copre ESPLICITAMENTE la domanda: rispondi usando solo quel testo, senza aggiungere nulla
Per QUALSIASI altra cosa — reclami, richieste economiche o di pagamento, cambi/cancellazioni di prenotazione, domande ambigue, o un minimo dubbio — NON rispondere automaticamente: lo farà l'host di persona.
Regole FERREE:
- canAnswer = true SOLO se sei sicuro al 100% E tutti i dati necessari sono esplicitamente presenti qui sotto in "Dati disponibili".
- NON INVENTARE MAI alcun dato (orari, indirizzo, password wifi, istruzioni) assente dai "Dati disponibili": se manca anche un solo dato richiesto dalla domanda, canAnswer = false.
- Se il messaggio dell'ospite non è chiaramente una delle domande ammesse, canAnswer = false e topic = "other".
- In caso di qualunque dubbio, canAnswer = false.${noBookingRule}
- "reply" va scritto in ${langName}, tono cordiale e professionale, breve (1-3 frasi), rivolgendoti all'ospite per nome se disponibile. Nessun preambolo, nessuna firma. Se canAnswer è false, reply può restare vuoto ("").
Dati disponibili:
${facts}
${ctx.transcript ? `Conversazione recente (dal più vecchio al più recente):\n"""\n${ctx.transcript}\n"""\n` : ""}Ultimo messaggio dell'ospite${ctx.guestName ? ` (${ctx.guestName})` : ""}: "${lastMsg.replace(/\s+/g, " ")}"
Rispondi SOLO con un oggetto JSON valido, senza testo extra, con ESATTAMENTE queste chiavi:
{"canAnswer": true|false, "reply": "", "topic": "checkin_time|wifi|parking|directions|faq|other"}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: CONCIERGE_AI_MODEL, max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const j = await res.json().catch(() => null) as { content?: { type: string; text?: string }[] } | null;
    const text = (j?.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, error: "no_json" };
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(m[0]); } catch { return { ok: false, error: "parse_error" }; }

    const topicRaw = typeof parsed.topic === "string" ? parsed.topic : "other";
    const topic: ConciergeTopic = (SAFE_TOPICS as string[]).includes(topicRaw) ? (topicRaw as ConciergeTopic) : "other";
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    const canAnswer = parsed.canAnswer === true && SAFE_TOPICS.includes(topic) && !!reply;
    return { ok: true, result: canAnswer ? { canAnswer: true, reply, topic } : { canAnswer: false, reply: "", topic } };
  } catch {
    return { ok: false, error: "fetch_failed" };
  }
}
