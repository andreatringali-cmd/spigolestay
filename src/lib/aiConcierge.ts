// Preferenze "Concierge AI" (Impostazioni → Concierge AI): se attivo, il webhook WhatsApp
// (src/app/api/whatsapp/webhook/route.ts) risponde IN AUTOMATICO alle domande di routine
// semplici dell'ospite (orario check-in, wifi, parcheggio, indicazioni stradali) quando l'AI è
// sicura della risposta — vedi src/lib/ai/guest-concierge.ts. Per qualunque dubbio, reclamo o
// richiesta economica il messaggio resta nella coda normale per l'host, come oggi.
// Default SPENTO: rispondere a nome di qualcun altro è delicato, va scelto esplicitamente.
// Stesso pattern di notifPrefs.ts: un'unica chiave ("spigolestay:aiconcierge") letta sia dal
// client (Impostazioni) sia dal webhook server-side (stesso blob app_state sincronizzato per
// prefisso in authsync.tsx — nessuna route dedicata di salvataggio necessaria).
// Tono delle risposte automatiche (Impostazioni → Concierge AI). "friendly" è il comportamento storico
// ("cordiale e professionale"), quindi chi non ha mai scelto nulla non vede cambiare niente.
export type ConciergeTone = "formal" | "friendly" | "concise";
export const CONCIERGE_TONES: ConciergeTone[] = ["formal", "friendly", "concise"];
export const CONCIERGE_TONE_LABEL: Record<ConciergeTone, string> = { formal: "Formale", friendly: "Amichevole", concise: "Essenziale" };
export const normalizeTone = (v: unknown): ConciergeTone => ((CONCIERGE_TONES as unknown[]).includes(v) ? (v as ConciergeTone) : "friendly");

export const AI_CONCIERGE_DEF = {
  enabled: false,
  tone: "friendly" as ConciergeTone,
  // Struttura a cui riferirsi per chi scrive senza alcuna prenotazione (numero nuovo): senza, con più
  // strutture il Concierge non sa quali dati usare e non risponde. Vuoto = nessuna.
  defaultStructureId: "",
};
export type AiConciergePrefs = typeof AI_CONCIERGE_DEF;

export const AI_CONCIERGE_KEY = "spigolestay:aiconcierge";

export function parseAiConciergePrefs(raw: string | null | undefined): AiConciergePrefs {
  try {
    const p: AiConciergePrefs = raw ? { ...AI_CONCIERGE_DEF, ...JSON.parse(raw) } : { ...AI_CONCIERGE_DEF };
    p.tone = normalizeTone(p.tone); // mancante o sconosciuto (vecchie preferenze già salvate) → amichevole
    return p;
  } catch { return { ...AI_CONCIERGE_DEF }; }
}

export function loadAiConciergePrefs(): AiConciergePrefs {
  try { return parseAiConciergePrefs(localStorage.getItem(AI_CONCIERGE_KEY)); } catch { return { ...AI_CONCIERGE_DEF }; }
}
