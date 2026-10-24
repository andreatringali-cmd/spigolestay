// Fusione a 3 vie delle chiavi PIATTE (impostazioni, modelli messaggi, utenti, piano…) con una base PERSISTENTE per dispositivo. Logica PURA (niente browser né rete).
//
// PROBLEMA: prima, sulle chiavi in comune tra locale e server vinceva SEMPRE il locale. Un dispositivo con una copia VECCHIA (scheda non ricaricata da ore, telefono, bundle in cache)
// riscriveva sul server impostazioni già aggiornate altrove (modelli e invio automatico tornati com'erano prima). La regola a 3 vie esisteva solo con la base IN MEMORIA, che dopo
// ogni ricarica della pagina è vuota: proprio il caso peggiore. Qui la base sopravvive ai ricaricamenti sotto forma di IMPRONTE (hash) per chiave, legate all'utente.
//
// REGOLE per ogni chiave piatta k presente sia in locale sia sul server con valori DIVERSI (base = ultimo valore sincronizzato di QUESTO dispositivo):
//  - locale uguale alla base                → il locale è solo una copia vecchia: vince il SERVER;
//  - server uguale alla base, locale diverso → modifica fatta qui: vince il LOCALE;
//  - cambiati entrambi                       → vince il locale (come prima), tranne `spigolestay:users` che si fonde per utente (mergeUsers3);
//  - NESSUNA base per k (primo avvio dopo wipe, nuovo dispositivo, prima versione con questa regola) → vince il SERVER (la memoria non è affidabile);
//  - chiave che il server non ha → resta quella locale (mai cancellata da qui).

import { GUIDES_KEY, mergeGuidesMap } from "./guide-protect";

type Snap = Record<string, string>;
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

export const USERS_KEY = "spigolestay:users";

// Serializzazione canonica (chiavi ordinate; undefined ignorato): due JSON con lo stesso contenuto ma chiavi in ordine diverso risultano uguali.
function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "undefined";
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const o = v as Rec;
  return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
}
const eq = (a: unknown, b: unknown): boolean => a === b || canon(a) === canon(b);

/** Impronta breve (circa 64 bit + lunghezza) del CONTENUTO di una chiave: non il contenuto, per non gonfiare lo storage. undefined se la chiave non c'è. */
export function flatHash(raw: string | undefined | null): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  let s = raw;
  try { s = canon(JSON.parse(raw)); } catch { /* non è JSON: si usa il testo così com'è */ }
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57; // cyrb53
  for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36) + "." + s.length.toString(36);
}

// ── Base persistente ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Costruisce il testo da salvare nella chiave locale della base: { v, uid, hashes }. `include` esclude le chiavi con regola propria / per-dispositivo. */
export function buildSyncBase(uid: string, last: Snap | null | undefined, include: (k: string) => boolean, hashOf: (k: string, raw: string) => string | undefined = (_k, raw) => flatHash(raw)): string {
  const hashes: Record<string, string> = {};
  for (const k of Object.keys(last ?? {})) {
    if (!include(k)) continue;
    const raw = (last as Snap)[k];
    if (typeof raw !== "string") continue;
    const h = hashOf(k, raw);
    if (h !== undefined) hashes[k] = h;
  }
  return JSON.stringify({ v: 1, uid, hashes });
}
/** Legge la base salvata. Ritorna null se manca, è rovinata o è di UN ALTRO utente (allora si scarta: nessuna fiducia). */
export function parseSyncBase(raw: string | null | undefined, uid: string): Record<string, string> | null {
  if (!raw || !uid) return null;
  try {
    const p = JSON.parse(raw) as { v?: unknown; uid?: unknown; hashes?: unknown };
    if (!p || p.v !== 1 || p.uid !== uid || !isRec(p.hashes)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.hashes)) if (typeof v === "string") out[k] = v;
    return out;
  } catch { return null; }
}

// ── Utenti: fusione PER UTENTE (id) ───────────────────────────────────────────────────────────────────────────────────────────────────
// Campi personali: un valore VUOTO o assente da una parte non deve cancellare quello pieno dell'altra (la foto del profilo spariva perché un dispositivo
// vecchio, il cui record utente non l'aveva, vinceva "in blocco"). Si distingue «rimossa» da «mai avuta» con la base: era nella base e ora manca = rimozione voluta.
export const PERSONAL_USER_FIELDS = ["photo", "phone", "firstName", "lastName", "avatarColor", "language", "username"];
const isEmptyVal = (v: unknown): boolean => v === undefined || v === null || v === "";
// lastLogin e sessions cambiano a ogni accesso: non contano per decidere se un utente è stato "modificato" (cancellazioni altrove).
const stripVolatile = (u: unknown): unknown => { if (!isRec(u)) return u; const { lastLogin: _l, sessions: _s, ...rest } = u; void _l; void _s; return rest; };

function mergeUserFields(b: Rec | undefined, l: Rec, s: Rec, prefer: "server" | "local"): Rec {
  const out: Rec = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(s), ...Object.keys(b ?? {})])) {
    const lv = l[k], sv = s[k], bv = b?.[k];
    const personal = PERSONAL_USER_FIELDS.includes(k);
    let v: unknown;
    if (eq(lv, sv)) v = lv;
    else if (b) {
      if (eq(lv, bv)) v = sv;                                   // non toccato qui: si adotta il server
      else if (eq(sv, bv)) v = lv;                              // toccato solo qui (anche una rimozione voluta): vince il locale
      else v = personal ? (isEmptyVal(lv) ? sv : lv) : lv;      // cambiati entrambi: il vuoto non cancella il pieno; per il resto come prima (locale)
    } else if (personal) {
      v = isEmptyVal(sv) ? lv : isEmptyVal(lv) ? sv : (prefer === "server" ? sv : lv); // senza base il vuoto perde sempre contro il pieno
    } else {
      v = prefer === "server" ? (sv !== undefined ? sv : lv) : (lv !== undefined ? lv : sv); // senza base: server (o locale se così richiesto)
    }
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Fonde l'elenco utenti (`spigolestay:users`) per id. Ritorna null se locale o server non sono array validi (allora decide il chiamante).
 *  - utente in entrambi: campo per campo (vedi sopra); permessi, strutture e stato seguono la regola a 3 vie con la base, senza base `prefer`;
 *  - utente solo sul server: si aggiunge, a meno che fosse nella base e qui sia stato cancellato;
 *  - utente solo in locale: resta, a meno che fosse nella base, invariato qui, e sul server sia stato cancellato.
 * L'ordine è quello del server, poi gli utenti solo locali: deterministico, così a parità di contenuto non ci sono riscritture inutili.
 */
export function mergeUsers3(baseRaw: string | undefined, localRaw: string | undefined, serverRaw: string | undefined, prefer: "server" | "local" = "server"): string | null {
  const parse = (r: string | undefined): unknown[] | null => { if (r === undefined) return null; try { const p = JSON.parse(r); return Array.isArray(p) ? p : null; } catch { return null; } };
  const local = parse(localRaw), server = parse(serverRaw);
  if (!local || !server) return null;
  const base = parse(baseRaw);
  const idOf = (u: unknown): string => { const id = isRec(u) ? u.id : undefined; return id !== undefined && id !== null && id !== "" ? String(id) : "#" + canon(u); };
  const index = (list: unknown[] | null) => { const m = new Map<string, unknown>(); for (const u of list ?? []) m.set(idOf(u), u); return m; };
  const bMap = index(base), lMap = index(local), sMap = index(server);
  const hasBase = !!base;
  const out: unknown[] = [];
  for (const [id, su] of sMap) {
    const lu = lMap.get(id);
    if (lu !== undefined) { out.push(isRec(lu) && isRec(su) ? mergeUserFields(hasBase && isRec(bMap.get(id)) ? bMap.get(id) as Rec : undefined, lu, su, prefer) : su); continue; }
    if (hasBase && bMap.has(id)) continue; // c'era e qui non c'è più: cancellato qui, non si reintroduce
    out.push(su);                          // nuovo sul server (o senza base: vince il server)
  }
  for (const [id, lu] of lMap) {
    if (sMap.has(id)) continue;
    if (hasBase && bMap.has(id) && eq(stripVolatile(lu), stripVolatile(bMap.get(id)))) continue; // cancellato altrove e qui non toccato
    out.push(lu);
  }
  return JSON.stringify(out);
}

// ── Chiavi piatte ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Applica la regola a 3 vie alle chiavi piatte di `local` (vedi in alto). `merged` = {...server, ...local} già calcolato; ritorna una copia con le sole chiavi adottate dal server
 * (o fuse) sostituite, e `merged` stesso se non cambia nulla. `skip` esclude le chiavi con regola propria o per-dispositivo.
 *  - `base`       = ultimo stato sincronizzato in MEMORIA (valori interi);
 *  - `baseHashes` = base PERSISTENTE (impronte per chiave) letta dal localStorage; usata per le chiavi che la base in memoria non ha.
 *                   `undefined` = comportamento di prima (senza base vince il locale: serve alla creazione del primo salvataggio); un oggetto, anche vuoto, = senza base vince il server.
 */
export function mergeFlatKeys3(
  merged: Snap,
  local: Snap,
  server: Snap | null | undefined,
  base: Snap | null | undefined,
  baseHashes: Record<string, string> | null | undefined,
  skip: (key: string) => boolean,
): Snap {
  if (!server) return merged;
  const newMode = !!baseHashes;
  let out = merged;
  const put = (k: string, v: string) => { if (out === merged) out = { ...merged }; out[k] = v; };
  for (const k of Object.keys(local)) {
    if (skip(k)) continue;
    const l = local[k], s = server[k];
    if (s === undefined || l === s) continue;                  // il server non ha la chiave (resta la locale) o è identica
    const hl = flatHash(l), hs = flatHash(s);
    if (hl === hs) continue;                                    // stesso contenuto scritto in modo diverso
    const bRaw = base?.[k];
    const hb = bRaw !== undefined ? flatHash(bRaw) : baseHashes?.[k];
    if (k === USERS_KEY) {
      if (hb !== undefined && hl === hb) { put(k, s); continue; }   // utenti non toccati qui: copia del server
      if (hb !== undefined && hs === hb) continue;                  // toccati solo qui: vince il locale
      const m = mergeUsers3(bRaw, l, s, newMode ? "server" : "local"); // cambiati entrambi o senza base: fusione per utente
      if (m !== null) put(k, m); else if (newMode) put(k, s);
      continue;
    }
    if (k === GUIDES_KEY) {
      // Guide ospiti: si fondono guida per guida e mai un campo PIENO viene sostituito da uno VUOTO (una guida più povera, anche se "più recente", non cancella quella piena).
      // Se il locale è invariato dall'ultima sync (stessa impronta della base) la base è il locale stesso: l'eventuale svuotamento arrivato dal server si accetta solo se piccolo.
      const m = mergeGuidesMap(bRaw !== undefined ? bRaw : (hb !== undefined && hl === hb ? l : undefined), l, s);
      if (m !== null) { put(k, m); continue; }
    }
    if (hb === undefined) { if (newMode) put(k, s); continue; }   // senza base: server (solo nella modalità con base persistente)
    if (hl === hb) put(k, s);                                       // locale invariato dall'ultima sync: era una copia vecchia
    // altrimenti: locale cambiato (con server invariato o cambiato anch'esso) → resta il locale
  }
  return out;
}
