// Logica PURA dei messaggi automatici agli ospiti: la usano il cron (server), la chat e le prenotazioni (browser), e i test.
// Nessuna rete, nessun window: solo calcoli su dati già letti.
//
//  - fillTokens: sostituzione dei segnaposto {ospite} {struttura}… (maiuscole/minuscole indifferenti, segnaposto sconosciuti o vuoti NON lasciati
//    scritti, riga con solo l'etichetta di un link vuoto omessa).
//  - stayTimeText: «20.10.2026 dalle 15:00» / «… from 15:00» nella lingua dell'ospite (stesso testo per cron e chat).
//  - autoSubject / guestFallback / structureFallback: oggetto e ripieghi tradotti (mai «Benvenuti a !»).
//  - decideSend: dato un modello e una prenotazione, dice se oggi va inviato, saltato (e perché) o recuperato (last-minute).
//  - dedupeGroups: un solo messaggio per gruppo di camere.
//  - orgBlobFor: per le righe org_state, le chiavi personali (modelli, codici, guide, recensioni) vengono dal blob del titolare.

import { slotDateOf, stepsOfTemplate, type AutoTpl } from "./auto-schedule";
import { fmtDMY } from "./dates";
import { addDaysYmd } from "./dates-rome";

export type Lang = "it" | "en" | "fr" | "de" | "es";
const LANGS: Lang[] = ["it", "en", "fr", "de", "es"];
export const asLang = (l: string | undefined | null): Lang => (LANGS as string[]).includes(String(l)) ? (l as Lang) : "it";

// ───────────────────────── Segnaposto ─────────────────────────

/** Riga rimasta senza contenuto utile dopo aver tolto un segnaposto vuoto (solo punteggiatura/frecce, oppure una breve etichetta che finisce con «:» o con una freccia). */
function isEmptyLabel(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (!/[\p{L}\p{N}]/u.test(t)) return true;
  if (/[:：👉➡→]\s*$/u.test(t) && t.replace(/[:：👉➡→\s]+$/u, "").split(/\s+/).length <= 2) return true;
  return false;
}

export interface FillOpts {
  lang?: Lang;
  /** La struttura non ha un nome: la riga di firma «— {struttura}» salta e il ripiego neutro prende il posto del nome. */
  emptyStructure?: boolean;
}

/**
 * Sostituisce i segnaposto {nome} del testo. Il nome del segnaposto non distingue maiuscole/minuscole (come waTemplateFrom). Un segnaposto SCONOSCIUTO o vuoto non resta
 * scritto nel messaggio: sparisce, e se la riga resta con la sola etichetta («Google: {link_google}» senza link Google) l'intera riga viene omessa.
 */
export function fillTokens(text: string, ctx: Record<string, string>, opts: FillOpts = {}): string {
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx)) map[k.toLowerCase()] = v ?? "";
  let src = text;
  if (opts.emptyStructure) src = src.replace(/^[ \t]*[—–-][ \t]*\{struttura\}[ \t]*$/gim, "");
  const out: string[] = [];
  for (const line of src.split("\n")) {
    let blanked = false;
    // Frase lunga con un segnaposto vuoto (più di 2 parole prima): omessa per intero, mai «Il tuo codice d'accesso è.».
    const kept: string[] = [];
    const sentences = line.split(/(?<=[.!?…])[ \t]+/);
    for (const sen of sentences) {
      const empty = [...sen.matchAll(/\{([a-z_]+)\}/gi)].find((m) => { const v = map[m[1].toLowerCase()]; return v === undefined || v === ""; });
      if (empty) {
        const before = sen.slice(0, empty.index ?? 0).replace(/\{[a-z_]+\}/gi, "x");
        if ((before.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0) > 2) { blanked = true; continue; }
      }
      kept.push(sen);
    }
    if (!kept.length) continue;
    const filled = (kept.length === sentences.length ? line : kept.join(" ")).replace(/\{([a-z_]+)\}/gi, (_m, k: string) => {
      const v = map[k.toLowerCase()];
      if (v === undefined || v === "") { blanked = true; return ""; }
      return v;
    });
    if (blanked) {
      if (isEmptyLabel(filled)) continue;
      out.push(filled.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([,.;:!?])/g, "$1"));
    } else out.push(filled);
  }
  let res = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (opts.lang === "it" && opts.emptyStructure) res = res.replace(/\b([Aa]) la nostra struttura/g, "$1lla nostra struttura");
  return res;
}

// ───────────────────────── Orari di arrivo/partenza nella lingua dell'ospite ─────────────────────────

const validTime = (t?: string) => (/^\d{1,2}:\d{2}$/.test((t ?? "").trim()) ? (t as string).trim() : "");
const FROM: Record<Lang, (t: string) => string> = { it: (t) => `dalle ${t}`, en: (t) => `from ${t}`, fr: (t) => `à partir de ${t}`, de: (t) => `ab ${t} Uhr`, es: (t) => `desde las ${t}` };
const BY: Record<Lang, (t: string) => string> = { it: (t) => `entro le ${t}`, en: (t) => `by ${t}`, fr: (t) => `avant ${t}`, de: (t) => `bis ${t} Uhr`, es: (t) => `antes de las ${t}` };

/** {checkin} / {checkout}: «gg.mm.aaaa» + «dalle HH:MM» (arrivo) o «entro le HH:MM» (partenza), nella lingua dell'ospite. Senza orario resta la sola data. */
export function stayTimeText(kind: "checkin" | "checkout", lang: Lang, iso: string, time?: string): string {
  const d = fmtDMY(iso);
  const t = validTime(time);
  if (!t) return d;
  return `${d} ${(kind === "checkin" ? FROM : BY)[asLang(lang)](t)}`;
}

// ───────────────────────── Ripieghi e oggetto dell'email ─────────────────────────

const GUEST_FALLBACK: Record<Lang, string> = { it: "ospite", en: "guest", fr: "cher client", de: "lieber Gast", es: "huésped" };
const STRUCTURE_FALLBACK: Record<Lang, string> = { it: "la nostra struttura", en: "our property", fr: "notre établissement", de: "unserer Unterkunft", es: "nuestro alojamiento" };
export const guestFallback = (lang: Lang) => GUEST_FALLBACK[asLang(lang)];
export const structureFallback = (lang: Lang) => STRUCTURE_FALLBACK[asLang(lang)];

const SUBJECT: Record<Lang, (s: string, d: string) => string> = {
  it: (s, d) => `Il tuo soggiorno${s ? ` a ${s}` : ""}${d ? ` · ${d}` : ""}`,
  en: (s, d) => `Your stay${s ? ` at ${s}` : ""}${d ? ` · ${d}` : ""}`,
  fr: (s, d) => `Votre séjour${s ? ` à ${s}` : ""}${d ? ` · ${d}` : ""}`,
  de: (s, d) => `Ihr Aufenthalt${s ? ` in ${s}` : ""}${d ? ` · ${d}` : ""}`,
  es: (s, d) => `Tu estancia${s ? ` en ${s}` : ""}${d ? ` · ${d}` : ""}`,
};
/** Oggetto dell'email automatica: nella lingua dell'ospite, con struttura e data di arrivo. MAI il nome interno del modello. */
export function autoSubject(lang: Lang, structureName: string, checkIn?: string): string {
  return SUBJECT[asLang(lang)]((structureName ?? "").trim(), checkIn ? fmtDMY(checkIn) : "");
}

/** Al posto di {link_checkin} quando l'ospite ha già fatto il check-in online. */
const CHECKIN_DONE: Record<Lang, string> = { it: "✅ già completato, grazie!", en: "✅ already completed, thank you!", fr: "✅ déjà effectué, merci !", de: "✅ bereits erledigt, danke!", es: "✅ ya completado, ¡gracias!" };
export const checkinDoneText = (lang: Lang) => CHECKIN_DONE[asLang(lang)];

// ───────────────────────── Decisione di invio ─────────────────────────

export type SkipReason = "no_slot" | "not_due" | "tentative" | "web_checkin_done" | "no_balance" | "dup_group";
/** `bulkImport`: la data di prenotazione è quella di un import in blocco (es. prima connessione Channex: bookedOn = giorno dell'import) e NON dice quando l'ospite ha prenotato → niente recupero. */
export interface DecideBooking { status?: string; checkIn: string; checkOut: string; webCheckin?: boolean; bookedOn?: string; bulkImport?: boolean }
/** Il recupero last-minute vale solo per prenotazioni create negli ultimi giorni (non per quelle vecchie, né per l'import iniziale). */
export const RECOVERY_MAX_AGE_DAYS = 2;
export interface DecideInput { tpl: AutoTpl; booking: DecideBooking; today: string; balance: number }
export type Decision = { send: true; slot: string; recovery: boolean } | { send: false; reason: SkipReason };

/**
 * Oggi va inviato questo modello per questa prenotazione?
 *  - provvisoria (tentative): mai (niente codici né promemoria a chi non ha ancora una prenotazione ferma);
 *  - {link_checkin} ma il check-in online è già fatto: non serve;
 *  - {saldo} ma non c'è nulla da pagare: non ha senso;
 *  - giorno previsto = oggi: invio normale;
 *  - RECUPERO last-minute: prenotazione creata DOPO il giorno previsto (finestra già passata) con arrivo non ancora trascorso, modello «giorni prima
 *    dell'arrivo»: parte comunque, una volta sola (la deduplicazione per prenotazione+modello la fa il chiamante sul registro). Solo se creata negli ultimi
 *    2 giorni e non da un import in blocco; il chiamante lo toglie anche se per la stessa prenotazione oggi è già dovuto un modello con gli stessi passaggi (dropRedundantRecovery).
 */
export function decideSend(i: DecideInput): Decision {
  const { tpl, booking: b, today } = i;
  if (b.status === "tentative") return { send: false, reason: "tentative" };
  const slot = slotDateOf(tpl, b.checkIn, b.checkOut);
  if (!slot) return { send: false, reason: "no_slot" };
  const text = Object.values(tpl.texts ?? {}).join("\n");
  const due = slot === today;
  const bookedDay = (b.bookedOn ?? "").slice(0, 10);
  const recovery = !due && slot < today && tpl.trigger === "before_arrival" && b.checkIn >= today && !b.bulkImport && /^\d{4}-\d{2}-\d{2}$/.test(bookedDay) && bookedDay >= slot && bookedDay >= addDaysYmd(today, -RECOVERY_MAX_AGE_DAYS);
  if (!due && !recovery) return { send: false, reason: "not_due" };
  // Check-in online già fatto: un modello che serve SOLO a chiederlo non ha più senso; uno che porta anche altro (guida, orari) parte lo stesso,
  // con al posto del link la nota «già completato» (vedi checkinDoneText).
  if (b.webCheckin === true && /\{link_checkin\}/i.test(text) && stepsOfTemplate(tpl).every((k) => k === "checkin")) return { send: false, reason: "web_checkin_done" };
  // Saldo zero: un modello che serve SOLO a chiedere il saldo non ha senso; uno che porta anche altro parte lo stesso, con {saldo} vuoto (la riga con la sola etichetta salta).
  if (/\{saldo\}/i.test(text) && !(i.balance > 0.004) && stepsOfTemplate(tpl).every((k) => k === "pay")) return { send: false, reason: "no_balance" };
  return { send: true, slot, recovery };
}

/**
 * Recupero in più: se per la stessa prenotazione oggi è già dovuto (non in recupero) un altro modello con gli stessi passaggi/link (check-in, guida, saldo,
 * recensione), il modello in recupero sarebbe un secondo messaggio quasi uguale → scartato. Ritorna gli id dei modelli in recupero da non inviare.
 */
export function dropRedundantRecovery(items: { tpl: AutoTpl; dec: Decision }[]): Set<string> {
  const dueSteps = new Set<string>();
  for (const it of items) if (it.dec.send && !it.dec.recovery) for (const k of stepsOfTemplate(it.tpl)) dueSteps.add(k);
  const drop = new Set<string>();
  for (const it of items) {
    if (!it.dec.send || !it.dec.recovery) continue;
    const steps = stepsOfTemplate(it.tpl);
    if (steps.length && steps.every((k) => dueSteps.has(k))) drop.add(it.tpl.id);
  }
  return drop;
}

/**
 * Import in blocco: giorni (per struttura) in cui molte prenotazioni Channex risultano «prenotate» nello stesso giorno: è la data dell'import iniziale, non quella
 * della prenotazione vera. Chiave `${structureId}|${bookedOn}`. Si contano gruppi/prenotazioni distinti (le camere di un gruppo valgono una).
 */
export function bulkImportDays(bookings: { structureId?: string; source?: string; bookedOn?: string; groupId?: string; id: string }[], threshold = 6): Set<string> {
  const counts = new Map<string, Set<string>>();
  for (const b of bookings) {
    const day = (b.bookedOn ?? "").slice(0, 10);
    if (b.source !== "channex" || !day) continue;
    const k = `${b.structureId ?? ""}|${day}`;
    const set = counts.get(k) ?? new Set<string>(); set.add(b.groupId || b.id); counts.set(k, set);
  }
  const out = new Set<string>();
  for (const [k, set] of counts) if (set.size >= threshold) out.add(k);
  return out;
}

/**
 * Un messaggio per gruppo di camere: tra le prenotazioni con lo stesso groupId resta la prima (per arrivo, poi id); le altre sono da saltare.
 * Con `byGuest` lo stesso ospite con più prenotazioni che arrivano lo STESSO giorno NELLA STESSA struttura conta come un gruppo (un solo messaggio per ospite+struttura+giorno:
 * strutture diverse hanno codici, guide e saldi propri e non si fondono).
 */
export function dedupeGroups<T extends { id: string; groupId?: string; guestId?: string; structureId?: string; checkIn: string }>(rows: T[], opts: { byGuest?: boolean } = {}): { keep: T[]; skippedIds: Set<string>; membersOf: Map<string, string[]> } {
  const byGroup = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.groupId ? `g:${r.groupId}` : opts.byGuest && r.guestId ? `u:${r.guestId}:${r.structureId ?? ""}:${r.checkIn}` : "";
    if (key) { const l = byGroup.get(key) ?? []; l.push(r); byGroup.set(key, l); }
  }
  const skipped = new Set<string>();
  const membersOf = new Map<string, string[]>();
  for (const list of byGroup.values()) {
    const sorted = [...list].sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : a.id < b.id ? -1 : 1));
    membersOf.set(sorted[0].id, sorted.map((x) => x.id));
    for (const x of sorted.slice(1)) skipped.add(x.id);
  }
  return { keep: rows.filter((r) => !skipped.has(r.id)), skippedIds: skipped, membersOf };
}

// ───────────────────────── Strutture condivise (org_state) ─────────────────────────

/** Chiavi del blob PERSONALE del titolare che i messaggi automatici devono leggere anche per le strutture condivise. */
export const OWNER_KEYS = ["spigolestay:msgtemplates", "spigolestay:roomaccess", "spigolestay:guides", "spigolestay:reviewsettings"] as const;

/**
 * Blob con cui lavorare per una riga: per le righe personali è il blob stesso; per le righe org_state (che hanno solo i dati condivisi) si aggiungono le chiavi
 * personali del titolare (modelli, codici, guide, impostazioni recensioni), senza mai sovrascrivere quelle già presenti nella riga.
 */
export function orgBlobFor(orgBlob: Record<string, string>, ownerBlob: Record<string, string> | null | undefined): Record<string, string> {
  if (!ownerBlob) return orgBlob;
  const out: Record<string, string> = { ...orgBlob };
  for (const k of OWNER_KEYS) if (!out[k] && ownerBlob[k]) out[k] = ownerBlob[k];
  return out;
}

/** Il canale WhatsApp è usabile per un testo libero? Con un modello approvato sempre; altrimenti solo con la finestra di 24 ore aperta. */
export function whatsappUsable(o: { hasTemplate: boolean; windowOpen: boolean }): boolean {
  return o.hasTemplate || o.windowOpen;
}

/** Passaggio del percorso → tipo di promemoria registrato in chat (vedi guest-messages.ts → readReminderLog). */
export function remKindsOf(tpl: AutoTpl): string[] {
  const map: Record<string, string> = { checkin: "checkin", guide: "guide", pay: "pay-saldo", review: "review" };
  return stepsOfTemplate(tpl).map((s) => map[s]).filter(Boolean);
}

/**
 * Chiavi del registro «Invii programmati» (msgsent) di un invio: `${modello}-${prenotazione}-${giorno previsto}`. Il cron scrive la chiave con la prenotazione
 * RAPPRESENTANTE del gruppo; la coda dell'app deve considerare inviata la riga se è presente la chiave di una QUALSIASI camera rappresentata.
 */
export function sentKeysFor(tplKey: string, bookingId: string, date: string, members?: string[]): string[] {
  return Array.from(new Set([bookingId, ...(members ?? [])])).map((id) => `${tplKey}-${id}-${date}`);
}

/**
 * Il messaggio automatico con {link_checkin} previsto OGGI per una prenotazione coprirà davvero il promemoria check-in? `rows` = righe di auto_message_log per
 * (tenant, modello, prenotazione/camere del gruppo).
 *  - nessuna riga: il cron dei messaggi (gira dopo il promemoria) lo manderà oggi → coperto;
 *  - una riga con slot di oggi: già partito oggi (il claim si libera se l'invio fallisce) → coperto;
 *  - solo righe di altri giorni: il modello è già stato inviato in passato (date spostate) e oggi NON si rimanda → il promemoria serve.
 */
export function autoMessageCoversToday(rows: { slot_date?: string | null }[], today: string): boolean {
  if (!rows.length) return true;
  return rows.some((r) => String(r.slot_date ?? "").slice(0, 10) === today);
}
