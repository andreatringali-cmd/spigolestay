// Stato CONDIVISO delle conversazioni OTA (Messaggi): «letto» e «non serve rispondere». Chiave piatta `spigolestay:msg:state` = mappa threadId → voce.
// Viaggia come le altre impostazioni condivise (org_state per le strutture di un'organizzazione + app_state personale), così Andrea, Greta e Stefano vedono gli
// stessi segni. Modulo PURO (nessun accesso a storage o rete), usato da sync-core.ts (fusione), org-cassa-config.ts (estrazione/applicazione sull'org) e dalla pagina.
//
// FUSIONE senza conflitti e senza cicli di riscrittura: ogni campo ha una regola commutativa, associativa e idempotente (come un CRDT), quindi qualunque ordine di
// incontro tra i dispositivi porta allo stesso risultato e un ciclo senza novità non cambia nulla:
//  - seenAt (ms dell'ultimo messaggio visto): vince il PIÙ GRANDE (letto non torna «da leggere» per un dispositivo in ritardo);
//  - noReply (non serve rispondere): ultimo vince, col proprio timestamp `nrAt` (a parità: nrFor più alto, poi «true»); `nrFor` = ms dell'ultimo messaggio al momento
//    del segno: se l'ospite scrive ancora dopo, la conversazione torna «in attesa» da sola;
//  - by / at: chi e quando ha toccato per ultimo (a parità vince il testo più grande, per essere deterministici).
// Le voci non si cancellano mai (il segno si annulla con noReply=false): l'unione per chiave basta e nessuna lapide è necessaria.

export const MSG_STATE_KEY = "spigolestay:msg:state";
/** Voce speciale: «da qui in poi conta»: la prima apertura (nessuno stato) non deve far risultare «da leggere» lo storico già presente. */
export const MSG_INIT_ID = "_init";

export interface MsgEntry {
  seenAt: number;        // ms dell'ultimo messaggio visto
  noReply: boolean;      // «non serve rispondere»
  nrAt: number;          // quando è stato cambiato noReply (ms)
  nrFor: number;         // ms dell'ultimo messaggio della conversazione quando è stato segnato
  nrBy: string;          // chi ha cambiato noReply
  by: string;            // chi ha toccato per ultimo la voce
  at: number;            // quando (ms)
  sid?: string;          // struttura della prenotazione collegata (instrada la voce sull'org giusta); assente = richiesta di informazioni
}
export type MsgState = Record<string, MsgEntry>;

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const str = (v: unknown): string => (typeof v === "string" ? v.slice(0, 60) : "");

/** Voce ripulita da campi sconosciuti o rovinati; null se non è una voce. */
export function cleanEntry(v: unknown): MsgEntry | null {
  if (!isRec(v)) return null;
  const e: MsgEntry = { seenAt: num(v.seenAt), noReply: v.noReply === true, nrAt: num(v.nrAt), nrFor: num(v.nrFor), nrBy: str(v.nrBy), by: str(v.by), at: num(v.at) };
  const sid = str(v.sid); if (sid) e.sid = sid;
  return e;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Fonde due voci della stessa conversazione (commutativa, associativa, idempotente). */
export function mergeEntry(a: MsgEntry, b: MsgEntry): MsgEntry {
  // noReply: vince la modifica più recente; a parità si decide in modo deterministico (nrFor, poi true, poi chi)
  const nrWin = a.nrAt !== b.nrAt ? (a.nrAt > b.nrAt ? a : b)
    : a.nrFor !== b.nrFor ? (a.nrFor > b.nrFor ? a : b)
    : a.noReply !== b.noReply ? (a.noReply ? a : b)
    : (cmp(a.nrBy, b.nrBy) >= 0 ? a : b);
  const lastWin = a.at !== b.at ? (a.at > b.at ? a : b) : (cmp(a.by, b.by) >= 0 ? a : b);
  const out: MsgEntry = { seenAt: Math.max(a.seenAt, b.seenAt), noReply: nrWin.noReply, nrAt: nrWin.nrAt, nrFor: nrWin.nrFor, nrBy: nrWin.nrBy, by: lastWin.by, at: Math.max(a.at, b.at) };
  const sid = a.sid && b.sid ? (cmp(a.sid, b.sid) >= 0 ? a.sid : b.sid) : (a.sid || b.sid);
  if (sid) out.sid = sid;
  return out;
}

/** Testo JSON → mappa. Non valido o vuoto → {} (mai un errore). */
export function parseMsgState(raw: string | null | undefined): MsgState {
  if (!raw) return {};
  let p: unknown;
  try { p = JSON.parse(raw); } catch { return {}; }
  if (!isRec(p)) return {};
  const out: MsgState = {};
  for (const [k, v] of Object.entries(p)) { if (!k) continue; const e = cleanEntry(v); if (e) out[k] = e; }
  return out;
}

/** Mappa → testo JSON CANONICO (chiavi ordinate, campi in ordine fisso): lo stesso contenuto dà sempre lo stesso testo. */
export function serializeMsgState(s: MsgState): string {
  const out: Record<string, MsgEntry> = {};
  for (const k of Object.keys(s).sort()) {
    const e = s[k];
    const o: MsgEntry = { seenAt: e.seenAt, noReply: e.noReply, nrAt: e.nrAt, nrFor: e.nrFor, nrBy: e.nrBy, by: e.by, at: e.at };
    if (e.sid) o.sid = e.sid;
    out[k] = o;
  }
  return JSON.stringify(out);
}

/** Unione per chiave di più mappe. */
export function mergeMsgStates(...states: MsgState[]): MsgState {
  const out: MsgState = {};
  for (const s of states) for (const [k, e] of Object.entries(s)) out[k] = out[k] ? mergeEntry(out[k], e) : e;
  return out;
}

/** Fusione dei due testi (locale e server). null = entrambi assenti (la regola non si applica). Un testo non valido conta come vuoto. */
export function mergeMsgStateRaw(localRaw: string | undefined, serverRaw: string | undefined): string | null {
  if (localRaw === undefined && serverRaw === undefined) return null;
  return serializeMsgState(mergeMsgStates(parseMsgState(localRaw), parseMsgState(serverRaw)));
}

// ── Organizzazione: quali voci viaggiano nell'org ─────────────────────────────────────────────────────────────────────────────────────────
/** Una voce appartiene a un'org se la sua struttura è dell'org; senza struttura (richiesta di informazioni) viaggia in ogni org che ha strutture. */
export const entryBelongsToOrg = (e: MsgEntry, org: Set<string>): boolean => (e.sid ? org.has(e.sid) : org.size > 0);

/** La parte dello stato locale che va nell'org (vuota se non c'è nulla: una parte vuota non deve toccare quella del server). */
export function extractOrgMsgState(local: Record<string, string>, org: Set<string>): Record<string, string> {
  const mine: MsgState = {};
  for (const [k, e] of Object.entries(parseMsgState(local[MSG_STATE_KEY]))) if (entryBelongsToOrg(e, org)) mine[k] = e;
  return Object.keys(mine).length ? { [MSG_STATE_KEY]: serializeMsgState(mine) } : {};
}

/** Riporta nel locale lo stato dell'org fuso col server. Ritorna SOLO la chiave se il contenuto cambia (vuoto = niente da fare, nessun salvataggio inutile). */
export function applyOrgMsgState(local: Record<string, string>, orgMerged: Record<string, string>, org: Set<string>): Record<string, string> {
  const theirs: MsgState = {};
  for (const [k, e] of Object.entries(parseMsgState(orgMerged[MSG_STATE_KEY]))) if (entryBelongsToOrg(e, org)) theirs[k] = e;
  if (!Object.keys(theirs).length) return {};
  const next = serializeMsgState(mergeMsgStates(parseMsgState(local[MSG_STATE_KEY]), theirs));
  const cur = local[MSG_STATE_KEY] === undefined ? undefined : serializeMsgState(parseMsgState(local[MSG_STATE_KEY]));
  return next === cur ? {} : { [MSG_STATE_KEY]: next };
}

// ── Letture e modifiche usate dalla pagina ───────────────────────────────────────────────────────────────────────────────────────────────
const blank = (): MsgEntry => ({ seenAt: 0, noReply: false, nrAt: 0, nrFor: 0, nrBy: "", by: "", at: 0 });

/** Ultimo messaggio visto di una conversazione: il valore della voce, ma mai meno della soglia «da qui in poi conta». */
export function seenAtOf(s: MsgState, threadId: string): number {
  return Math.max(s[threadId]?.seenAt ?? 0, s[MSG_INIT_ID]?.seenAt ?? 0);
}
/** «Non serve rispondere» valido ora: il segno cade se l'ospite ha scritto ancora dopo (lastAt oltre quello che c'era al momento del segno). */
export function noReplyActive(s: MsgState, threadId: string, lastAt: number): boolean {
  const e = s[threadId];
  return !!e && e.noReply && lastAt <= e.nrFor;
}

/** Segna come vista la conversazione fino a `lastAt`. Ritorna lo STESSO oggetto se non cambia nulla. */
export function markSeen(s: MsgState, threadId: string, lastAt: number, by: string, now: number, sid?: string): MsgState {
  const cur = s[threadId];
  if (cur && cur.seenAt >= lastAt && (!sid || cur.sid === sid)) return s;
  if (!cur && seenAtOf(s, threadId) >= lastAt) return s; // già sotto la soglia iniziale
  const e = { ...(cur ?? blank()), seenAt: Math.max(cur?.seenAt ?? 0, lastAt), by, at: Math.max(now, cur?.at ?? 0) };
  if (sid) e.sid = sid;
  return { ...s, [threadId]: e };
}
/** Imposta o toglie «non serve rispondere». */
export function setNoReply(s: MsgState, threadId: string, on: boolean, lastAt: number, by: string, now: number, sid?: string): MsgState {
  const cur = s[threadId] ?? blank();
  const e: MsgEntry = { ...cur, noReply: on, nrAt: Math.max(now, cur.nrAt + 1), nrFor: on ? Math.max(lastAt, 1) : cur.nrFor, nrBy: by, by, at: Math.max(now, cur.at) };
  if (sid) e.sid = sid;
  return { ...s, [threadId]: e };
}
/** Prima apertura (nessuna voce): ciò che c'è già non è «da leggere»; conta solo ciò che arriva da ora. */
export function initIfEmpty(s: MsgState, by: string, now: number): MsgState {
  if (Object.keys(s).length) return s;
  return { [MSG_INIT_ID]: { ...blank(), seenAt: now, by, at: now } };
}
/** Vecchio segno «letto» locale (xn:msg2:seen: threadId → ms) riportato nello stato condiviso, una volta sola. */
export function migrateOldSeen(s: MsgState, old: unknown, by: string, now: number): MsgState {
  if (!isRec(old)) return s;
  let out = s;
  for (const [id, v] of Object.entries(old)) { const t = num(v); if (id && t) out = markSeen(out, id, t, by, now); }
  return out;
}
