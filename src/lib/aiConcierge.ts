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

export type OtaAutoMode = "off" | "offhours" | "always";
export const OTA_MODES: OtaAutoMode[] = ["off", "offhours", "always"];

export const AI_CONCIERGE_DEF = {
  enabled: false,
  tone: "friendly" as ConciergeTone,
  // Struttura a cui riferirsi per chi scrive senza alcuna prenotazione (numero nuovo): senza, con più
  // strutture il Concierge non sa quali dati usare e non risponde. Vuoto = nessuna.
  defaultStructureId: "",
  // Messaggi di Booking.com/Airbnb/Expedia (via Channex): mai (default), solo fuori orario o sempre. Fuori orario = dalle `otaFrom` alle `otaTo` ore italiane.
  otaMode: "off" as OtaAutoMode,
  otaFrom: 21,
  otaTo: 9,
};
export type AiConciergePrefs = typeof AI_CONCIERGE_DEF;

export const AI_CONCIERGE_KEY = "spigolestay:aiconcierge";

export function parseAiConciergePrefs(raw: string | null | undefined): AiConciergePrefs {
  try {
    const p: AiConciergePrefs = raw ? { ...AI_CONCIERGE_DEF, ...JSON.parse(raw) } : { ...AI_CONCIERGE_DEF };
    if (!(OTA_MODES as unknown[]).includes(p.otaMode)) p.otaMode = "off";
    p.otaFrom = normHour(p.otaFrom, 21); p.otaTo = normHour(p.otaTo, 9);
    p.tone = normalizeTone(p.tone); // mancante o sconosciuto (vecchie preferenze già salvate) → amichevole
    return p;
  } catch { return { ...AI_CONCIERGE_DEF }; }
}

export function loadAiConciergePrefs(): AiConciergePrefs {
  try { return parseAiConciergePrefs(localStorage.getItem(AI_CONCIERGE_KEY)); } catch { return { ...AI_CONCIERGE_DEF }; }
}

const normHour = (v: unknown, def: number): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23 ? v : def);

/** Ora italiana (0-23) di un istante. */
export function romeHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hour12: false }).format(now)) % 24;
}

/** Vero se `now` cade nella fascia fuori orario [from, to): anche a cavallo della mezzanotte (21 → 9). from === to = mai. */
export function isOffHours(now: Date, from: number, to: number): boolean {
  if (from === to) return false;
  const h = romeHour(now);
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** Una risposta automatica ai messaggi delle OTA parte con queste preferenze, a quest'ora? */
export function otaAutoActive(prefs: Pick<AiConciergePrefs, "enabled" | "otaMode" | "otaFrom" | "otaTo">, now: Date): boolean {
  if (!prefs.enabled) return false;
  if (prefs.otaMode === "always") return true;
  return prefs.otaMode === "offhours" && isOffHours(now, prefs.otaFrom, prefs.otaTo);
}
