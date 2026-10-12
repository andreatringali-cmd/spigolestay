// Salute del sistema: classificazione (semaforo, soglie, testi in italiano) dei dati raccolti dalla rotta /api/health.
// Modulo PURO: nessun accesso a rete o database, così si prova con i test. Niente dati personali: solo conteggi, date e stati.
import { spiegaErroreWa } from "./invii-log";

export type Light = "ok" | "warn" | "err" | "idle"; // idle = grigio: non applicabile / nessun dato, non conta tra le cose da controllare

export interface HealthItem { id: string; title: string; light: Light; text: string; at?: string }
export interface HealthSection { id: "invii" | "cron" | "channex" | "whatsapp" | "config"; title: string; items: HealthItem[] }
export interface HealthReport { summary: { light: "ok" | "warn" | "err"; attention: number; headline: string }; sections: HealthSection[] }

export const ORE_INVII_VECCHI = 36;       // pulizie: nessun invio da più di così = giallo
export const GIORNI_INVIO_FALLITO_ROSSO = 7; // un errore più vecchio di così non è più "urgente": passa a giallo
export const GIORNI_CHANNEX_GIALLO = 3;
export const GIORNI_CHANNEX_ROSSO = 14;

export interface InvioRow { at: string; job: string; channel: string; ok: boolean; detail?: string | null }
export interface ChannexMapRow { structure_id?: string | null; last_import_at?: string | null; updated_at?: string | null; name?: string | null }
export type ChannexPing = "ok" | "fail" | "timeout" | "skipped";
export interface EnvFlag { name: string; present: boolean; on?: boolean } // on: solo per gli interruttori "=1"; MAI il valore

export interface HealthInput {
  invii: InvioRow[] | null;           // righe di invii_log (anche non ordinate); null = registro non leggibile
  pulizieShareAt?: string | null;     // ultima traccia in pulizie_share_log (sent_at o slot_date)
  channex: { enabled: boolean; maps: ChannexMapRow[]; ping: ChannexPing };
  whatsapp: { connected: boolean; lastInAt?: number | null; lastOutAt?: number | null };
  env: EnvFlag[];
}

const H = 3600 * 1000, D = 24 * H;
const JOBS: { job: string; titolo: string; cron: string }[] = [
  { job: "pulizie", titolo: "Piano pulizie", cron: "Piano pulizie giornaliero" },
  { job: "messaggi", titolo: "Messaggi automatici agli ospiti", cron: "Messaggi automatici" },
  { job: "checkin", titolo: "Promemoria check-in", cron: "Promemoria check-in" },
];
const CANALE: Record<string, string> = { whatsapp: "WhatsApp", email: "Email" };

const ts = (iso?: string | null): number | null => { if (!iso) return null; const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/** Quanto tempo fa, in italiano ("2 ore fa", "3 giorni fa"). */
export function quantoFa(t: number, now: number): string {
  const ms = Math.max(0, now - t);
  if (ms < 60 * 1000) return "pochi secondi fa";
  if (ms < H) { const m = Math.floor(ms / 60000); return m === 1 ? "1 minuto fa" : `${m} minuti fa`; }
  if (ms < D) { const h = Math.floor(ms / H); return h === 1 ? "1 ora fa" : `${h} ore fa`; }
  const g = Math.floor(ms / D);
  return g === 1 ? "1 giorno fa" : `${g} giorni fa`;
}

/** Ultimo messaggio in arrivo/uscita da un JSON di conversazioni WhatsApp ("spigolestay:threads:v1"). Restituisce solo istanti, mai testi o nomi. */
export function ultimiMessaggiWa(threadsJson: string | null | undefined): { lastInAt: number | null; lastOutAt: number | null } {
  let lastInAt: number | null = null, lastOutAt: number | null = null;
  let parsed: unknown = null;
  try { parsed = JSON.parse(threadsJson || "{}"); } catch { parsed = null; }
  if (parsed && typeof parsed === "object") {
    for (const list of Object.values(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      for (const m of list) {
        if (!m || typeof m !== "object") continue;
        const { dir, ts: t } = m as { dir?: unknown; ts?: unknown };
        if (typeof t !== "number" || !Number.isFinite(t)) continue;
        if (dir === "in" && (lastInAt === null || t > lastInAt)) lastInAt = t;
        else if (dir === "out" && (lastOutAt === null || t > lastOutAt)) lastOutAt = t;
      }
    }
  }
  return { lastInAt, lastOutAt };
}

// ───────────────────────── 1) Invii automatici ─────────────────────────
function classificaInvii(input: HealthInput, now: number): HealthItem[] {
  if (input.invii === null) return [{ id: "invii-registro", title: "Registro degli invii", light: "warn", text: "Non riesco a leggere il registro degli invii: non posso dire se i messaggi stanno partendo." }];
  const out: HealthItem[] = [];
  for (const { job, titolo } of JOBS) {
    const rows = input.invii.filter((r) => r.job === job && ts(r.at) !== null).sort((a, b) => ts(b.at)! - ts(a.at)!);
    if (rows.length === 0) { out.push({ id: `invii-${job}`, title: titolo, light: "idle", text: "Nessun invio registrato finora." }); continue; }
    const ultimoJob = ts(rows[0].at)!;
    const canali = Array.from(new Set(rows.map((r) => r.channel)));
    for (const ch of canali) {
      const r = rows.find((x) => x.channel === ch)!; // il più recente di questo canale
      const t = ts(r.at)!;
      const nome = `${titolo} · ${CANALE[ch] ?? ch}`;
      const id = `invii-${job}-${ch}`;
      if (!r.ok) {
        const motivo = spiegaErroreWa(r.detail ?? undefined);
        const vecchio = now - t > GIORNI_INVIO_FALLITO_ROSSO * D;
        out.push({ id, title: nome, light: vecchio ? "warn" : "err", at: r.at, text: `L'ultimo invio (${quantoFa(t, now)}) non è arrivato.${motivo ? " " + motivo : " Controlla il collegamento e riprova."}` });
        continue;
      }
      // Giallo solo per le pulizie, dove ci si aspetta un invio ogni giorno, e solo sul canale più recente del job.
      if (job === "pulizie" && t === ultimoJob && now - t > ORE_INVII_VECCHI * H) {
        out.push({ id, title: nome, light: "warn", at: r.at, text: `Ultimo invio riuscito ${quantoFa(t, now)}: ci si aspetta un invio al giorno. Può essere normale se non ci sono pulizie in programma.` });
        continue;
      }
      out.push({ id, title: nome, light: "ok", at: r.at, text: `Ultimo invio riuscito ${quantoFa(t, now)}.` });
    }
  }
  return out;
}

// ───────────────────────── 2) Cron (dedotti dalle tracce) ─────────────────────────
function classificaCron(input: HealthInput, now: number): HealthItem[] {
  const out: HealthItem[] = [];
  for (const { job, cron } of JOBS) {
    let last: number | null = null;
    for (const r of input.invii ?? []) if (r.job === job) { const t = ts(r.at); if (t !== null && (last === null || t > last)) last = t; }
    if (job === "pulizie") { const s = ts(input.pulizieShareAt); if (s !== null && (last === null || s > last)) last = s; }
    const id = `cron-${job}`;
    if (last === null) { out.push({ id, title: cron, light: "idle", text: "Nessuna traccia di esecuzione: non è mai partito o non ha ancora avuto nulla da inviare." }); continue; }
    if (job === "pulizie" && now - last > ORE_INVII_VECCHI * H) {
      out.push({ id, title: cron, light: "warn", at: new Date(last).toISOString(), text: `Ultima traccia ${quantoFa(last, now)}: dovrebbe girare ogni giorno. Può essere normale se non ci sono pulizie.` });
    } else {
      out.push({ id, title: cron, light: "ok", at: new Date(last).toISOString(), text: `Ultima traccia ${quantoFa(last, now)}.` });
    }
  }
  return out;
}

// ───────────────────────── 3) Channex ─────────────────────────
function classificaChannex(input: HealthInput, now: number): HealthItem[] {
  const { enabled, maps, ping } = input.channex;
  if (maps.length === 0) return [{ id: "channex-map", title: "Channex", light: "idle", text: enabled ? "Nessuna struttura collegata a Channex." : "Channex non è in uso." }];
  const out: HealthItem[] = [];
  if (!enabled) out.push({ id: "channex-key", title: "Collegamento Channex", light: "err", text: "Ci sono strutture collegate ma manca la chiave di accesso a Channex: le prenotazioni dei portali non arrivano." });
  else if (ping === "ok") out.push({ id: "channex-ping", title: "Collegamento Channex", light: "ok", text: "Channex risponde correttamente." });
  else if (ping === "timeout") out.push({ id: "channex-ping", title: "Collegamento Channex", light: "warn", text: "Channex non ha risposto in pochi secondi: riprova tra poco." });
  else if (ping === "fail") out.push({ id: "channex-ping", title: "Collegamento Channex", light: "err", text: "Channex non accetta la richiesta: controlla la chiave di accesso." });
  maps.forEach((m, i) => {
    const nome = (m.name || "").trim() || `Struttura ${i + 1}`;
    const id = `channex-import-${i}`;
    const t = ts(m.last_import_at);
    if (t === null) { out.push({ id, title: `Ultimo import · ${nome}`, light: "warn", text: "Nessuna prenotazione importata da Channex finora." }); return; }
    const eta = now - t;
    const nota = "Può essere normale se non arrivano nuove prenotazioni.";
    if (eta > GIORNI_CHANNEX_ROSSO * D) out.push({ id, title: `Ultimo import · ${nome}`, light: "err", at: m.last_import_at!, text: `Ultimo import ${quantoFa(t, now)}. ${nota}` });
    else if (eta > GIORNI_CHANNEX_GIALLO * D) out.push({ id, title: `Ultimo import · ${nome}`, light: "warn", at: m.last_import_at!, text: `Ultimo import ${quantoFa(t, now)}. ${nota}` });
    else out.push({ id, title: `Ultimo import · ${nome}`, light: "ok", at: m.last_import_at!, text: `Ultimo import ${quantoFa(t, now)}.` });
  });
  return out;
}

// ───────────────────────── 4) WhatsApp ─────────────────────────
function classificaWhatsapp(input: HealthInput, now: number): HealthItem[] {
  const { connected, lastInAt, lastOutAt } = input.whatsapp;
  const usaWa = (input.invii ?? []).some((r) => r.channel === "whatsapp");
  const out: HealthItem[] = [];
  if (connected) out.push({ id: "wa-link", title: "Collegamento WhatsApp", light: "ok", text: "WhatsApp è collegato." });
  else out.push({ id: "wa-link", title: "Collegamento WhatsApp", light: usaWa ? "warn" : "idle", text: usaWa ? "WhatsApp non risulta collegato, ma ci sono invii via WhatsApp: non partiranno." : "WhatsApp non è collegato." });
  if (typeof lastInAt === "number") out.push({ id: "wa-in", title: "Ultimo messaggio ricevuto", light: "ok", at: new Date(lastInAt).toISOString(), text: `Ricevuto ${quantoFa(lastInAt, now)}.` });
  else out.push({ id: "wa-in", title: "Ultimo messaggio ricevuto", light: "idle", text: "Nessun messaggio ricevuto da WhatsApp." });
  if (typeof lastOutAt === "number") out.push({ id: "wa-out", title: "Ultimo messaggio inviato", light: "ok", at: new Date(lastOutAt).toISOString(), text: `Inviato ${quantoFa(lastOutAt, now)}.` });
  else out.push({ id: "wa-out", title: "Ultimo messaggio inviato", light: "idle", text: "Nessun messaggio inviato da WhatsApp." });
  return out;
}

// ───────────────────────── 5) Configurazione ─────────────────────────
export const ENV_INFO: Record<string, { cosa: string; mancante: Light; flag?: boolean }> = {
  META_APP_SECRET: { cosa: "Serve a verificare che i messaggi in arrivo da WhatsApp li abbia mandati davvero Meta.", mancante: "warn" },
  WHATSAPP_WEBHOOK_STRICT: { cosa: "Se impostata a 1, rifiuta i messaggi WhatsApp non firmati (più sicuro). Facoltativa.", mancante: "idle" },
  CRON_SECRET: { cosa: "Autorizza le attività automatiche notturne (pulizie, messaggi, check-in, Channex). Senza, non partono.", mancante: "err" },
  CRED_SECRET: { cosa: "Protegge le credenziali dei portali salvate (Alloggiati Web, WhatsApp). Senza, non si possono leggere.", mancante: "err" },
  ALLOGGIATI_LIVE: { cosa: "Interruttore: a 1 le schedine vengono davvero trasmesse alla Questura, altrimenti è solo una prova.", mancante: "idle", flag: true },
  AUTO_MESSAGES_LIVE: { cosa: "Interruttore: a 1 i messaggi automatici agli ospiti partono davvero, altrimenti è solo una prova.", mancante: "idle", flag: true },
  STRIPE_WEBHOOK_SECRET: { cosa: "Serve a ricevere in modo sicuro la conferma dei pagamenti e degli abbonamenti da Stripe.", mancante: "warn" },
  CHANNEX_API_KEY: { cosa: "Chiave di accesso a Channex, il collegamento con Booking, Airbnb e gli altri portali.", mancante: "warn" },
  RESEND_API_KEY: { cosa: "Serve a spedire le email (conferme, voucher, piano pulizie). Senza, le email non partono.", mancante: "warn" },
  ANTHROPIC_API_KEY: { cosa: "Attiva le funzioni con intelligenza artificiale (assistente, risposte automatiche).", mancante: "idle" },
};
export const ENV_NAMES = Object.keys(ENV_INFO);

function classificaConfig(input: HealthInput): HealthItem[] {
  const map = new Map(input.env.map((e) => [e.name, e]));
  return ENV_NAMES.map((name) => {
    const info = ENV_INFO[name];
    const e = map.get(name);
    const present = !!e?.present;
    if (!present) return { id: `env-${name}`, title: name, light: info.mancante, text: `Non impostata. ${info.cosa}` };
    if (info.flag) return { id: `env-${name}`, title: name, light: "ok" as Light, text: `${e?.on ? "Acceso" : "Impostata ma spenta"}. ${info.cosa}` };
    return { id: `env-${name}`, title: name, light: "ok" as Light, text: `Impostata. ${info.cosa}` };
  });
}

// ───────────────────────── Riepilogo ─────────────────────────
export function classificaSalute(input: HealthInput, now: number = Date.now()): HealthReport {
  const sections: HealthSection[] = [
    { id: "invii", title: "Invii automatici", items: classificaInvii(input, now) },
    { id: "cron", title: "Attività automatiche", items: classificaCron(input, now) },
    { id: "channex", title: "Channex (portali)", items: classificaChannex(input, now) },
    { id: "whatsapp", title: "WhatsApp", items: classificaWhatsapp(input, now) },
    { id: "config", title: "Configurazione", items: classificaConfig(input) },
  ];
  const all = sections.flatMap((s) => s.items);
  const errs = all.filter((i) => i.light === "err").length;
  const warns = all.filter((i) => i.light === "warn").length;
  const attention = errs + warns;
  const light = errs > 0 ? "err" : warns > 0 ? "warn" : "ok";
  const headline = attention === 0 ? "Tutto a posto" : attention === 1 ? "1 cosa da controllare" : `${attention} cose da controllare`;
  return { summary: { light, attention, headline }, sections };
}
