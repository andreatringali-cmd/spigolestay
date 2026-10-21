// Bozza di risposta per l'host nelle chat dei portali (Booking.com, Airbnb, Expedia): usa lo STESSO motore del Concierge (concierge-engine.ts: base di conoscenza,
// dati della struttura e della prenotazione, tono scelto in Impostazioni → Concierge AI) ma con una differenza: la bozza NON parte da sola, la rilegge e la invia l'host,
// quindi può rispondere anche a domande che il Concierge automatico lascerebbe all'host. Resta vietato inventare fatti.
// Stessa Messages API, stesso modello (CONCIERGE_AI_MODEL) e stesso gating: senza ANTHROPIC_API_KEY → { ok:false, error:"ai_not_configured" }.
import { CONCIERGE_AI_MODEL, toneInstruction, type ConciergeContext } from "@/lib/ai/guest-concierge";

export interface DraftContext extends ConciergeContext {
  /** Riga sul soggiorno (date e camera), già formattata. */
  stay?: string;
}
export type DraftOutcome = { ok: true; draft: string } | { ok: false; error: string };

const LANG_NAMES: Record<string, string> = { it: "italiano", en: "inglese", fr: "francese", de: "tedesco", es: "spagnolo" };

export function buildDraftPrompt(ctx: DraftContext): string {
  const langName = LANG_NAMES[(ctx.lang || "it").toLowerCase()] || "la stessa lingua usata dall'ospite";
  const lastMsg = (ctx.lastGuestMessage || "").trim().replace(/\s+/g, " ");
  const facts = [
    ctx.structureName ? "- Struttura: " + ctx.structureName : null,
    ctx.address ? "- Indirizzo: " + ctx.address : null,
    ctx.stay ? "- Soggiorno: " + ctx.stay : null,
    (ctx.checkInFrom || ctx.checkInTo) ? "- Check-in: dalle " + (ctx.checkInFrom || "?") + (ctx.checkInTo ? " alle " + ctx.checkInTo : "") : null,
    ctx.checkOutBy ? "- Check-out: entro le " + ctx.checkOutBy : null,
    ctx.accessInfo ? "- Istruzioni/codici di accesso: " + ctx.accessInfo : null,
    typeof ctx.hasParking === "boolean" ? "- Parcheggio disponibile: " + (ctx.hasParking ? "sì" : "no, non risulta disponibile") : null,
    ...(ctx.faq ?? []).map((f) => '- Informazione scritta dal gestore su "' + f.topic + '": ' + f.answer),
  ].filter(Boolean).join("\n") || "(nessun dato strutturato disponibile)";
  const noBooking = ctx.hasBooking === false
    ? "\n- Per questa conversazione non risulta ancora un soggiorno confermato e vicino: NON scrivere password Wi-Fi, codici o istruzioni di accesso."
    : "";
  return 'Sei chi gestisce "' + (ctx.structureName || "una struttura ricettiva") + '". Scrivi UNA bozza di risposta al messaggio di un ospite arrivato dalla chat di un portale (Booking.com, Airbnb o Expedia). L\'host la rileggerà e la modificherà prima di inviarla.\n' +
    "Regole FERREE:\n" +
    "- Scrivi in " + langName + " (la lingua dell'ospite). Stile: " + toneInstruction(ctx.tone) + ", rivolgendoti all'ospite per nome se disponibile. Nessun preambolo, nessuna firma, nessun segnaposto tra parentesi.\n" +
    "- Rispondi all'ULTIMO messaggio dell'ospite tenendo conto della conversazione. Usa SOLO i fatti presenti in \"Dati disponibili\": non inventare prezzi, orari, servizi, codici o disponibilità. Se manca un'informazione, dì che verificherai e ti farai sentire a breve.\n" +
    "- Le informazioni scritte dal gestore valgono più di qualunque tua supposizione; non modificare mai link, numeri di telefono, indirizzi, password, codici e orari che riporti.\n" +
    "- Il canale è la chat del portale: NON inserire link esterni, indirizzi email, numeri di telefono, inviti a passare su WhatsApp o altre app, né richieste di pagamento fuori dal portale (i portali li bloccano). Se servono, ometti e di' che si può proseguire qui in chat.\n" +
    "- Reclami, rimborsi, cambi o cancellazioni: non prometterli, ringrazia e di' che li gestirai di persona." + noBooking + "\n" +
    "Dati disponibili:\n" + facts + "\n" +
    (ctx.transcript ? 'Conversazione (dal più vecchio al più recente):\n"""\n' + ctx.transcript + '\n"""\n' : "") +
    "Ultimo messaggio dell'ospite" + (ctx.guestName ? " (" + ctx.guestName + ")" : "") + ': "' + lastMsg + '"\n' +
    "Rispondi SOLO con il testo della bozza, senza virgolette né commenti.";
}

export async function getConciergeDraft(ctx: DraftContext): Promise<DraftOutcome> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ai_not_configured" };
  if (!(ctx.lastGuestMessage || "").trim()) return { ok: false, error: "empty_message" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: CONCIERGE_AI_MODEL, max_tokens: 700, messages: [{ role: "user", content: buildDraftPrompt(ctx) }] }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: "http_" + res.status };
    const j = await res.json().catch(() => null) as { content?: { type: string; text?: string }[] } | null;
    const draft = (j?.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("").trim().replace(/^["“«]+|["”»]+$/g, "").trim();
    return draft ? { ok: true, draft } : { ok: false, error: "empty" };
  } catch (e) {
    return { ok: false, error: (e as Error)?.name === "AbortError" ? "timeout" : "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}
