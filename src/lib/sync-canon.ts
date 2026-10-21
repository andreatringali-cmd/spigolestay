// Forma CANONICA dello stato sincronizzato: logica PURA (niente browser né rete), usata da sync-core.ts (firma di contenuto, fusione) e da authsync.tsx.
//
// PERCHE': due dispositivi con lo STESSO contenuto ma una lista scritta in ordine diverso (es. i conti di Cassa [contanti, banca, revolut] contro
// [revolut, contanti, banca]) risultavano «diversi» per la firma di contenuto, quindi ognuno riscriveva la riga condivisa e l'altro faceva lo stesso, all'infinito.
// Qui si definisce quando l'ORDINE di una lista non è un'informazione (liste di oggetti con `id`: l'ordine di visualizzazione è un campo `order`, non la
// posizione) e come si rende deterministico il valore condiviso dei conti.

type Json = Record<string, unknown>;
const isRec = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

export const DATA_KEY = "spigolestay:data:v1";
export const CONTI_KEY = "spigolestay:cassa:conti";
// Liste del blocco dati con elementi {id}: l'ordine non ha significato (le camere/tipologie hanno un campo `order` esplicito).
const DATA_LISTS = ["structures", "roomTypes", "units", "bookings", "guests", "directReviews", "events", "activities"];
// Chiavi piatte il cui valore e' una lista con elementi {key} e di cui l'ordine NON e' un dato condiviso (l'ordine di vista sta in conti-prefs, per dispositivo).
const KEYED_LISTS = new Set<string>([CONTI_KEY]);

// Serializzazione canonica (chiavi ordinate; undefined ignorato). Stessa idea di stableStringify di sync-core, duplicata per evitare un import circolare.
export function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "undefined";
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  const o = v as Json;
  return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stable(o[k])).join(",") + "}";
}

const fieldOf = (it: unknown, f: "id" | "key"): string | null => {
  if (!isRec(it)) return null;
  const v = it[f];
  if (typeof v === "string") return v !== "" ? v : null;
  if (f === "id" && typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

/** Ordina una lista di oggetti per `id` (o `key`), con spareggio sul contenuto. Se anche un solo elemento non ha il campo ritorna la lista ORIGINALE (stesso riferimento). */
export function sortListBy(list: unknown[], field: "id" | "key"): unknown[] {
  if (list.length < 2) return list;
  const tagged: { k: string; s: string; it: unknown }[] = [];
  for (const it of list) {
    const k = fieldOf(it, field);
    if (k === null) return list;
    tagged.push({ k, s: stable(it), it });
  }
  tagged.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  return tagged.map((x) => x.it);
}

const sortStrings = (v: unknown): unknown => (Array.isArray(v) && v.every((x) => typeof x === "string") ? [...(v as string[])].sort() : v);

/**
 * Valore di una chiave sincronizzata (già letto dal JSON) reso INDIPENDENTE DALL'ORDINE delle liste di oggetti con id:
 *  - blocco dati: collezioni di entita' e registro attivita' ordinati per id; lapidi e contatti cancellati sono insiemi;
 *  - chiavi piatte: se il valore e' una lista di oggetti con `id` si ordina per id; i conti di Cassa per `key`.
 * Solo il livello superiore: le liste annidate dentro un'entita' (pagamenti di una prenotazione, ecc.) restano com'erano.
 */
export function orderFree(flatKey: string, parsed: unknown): unknown {
  if (flatKey === DATA_KEY) {
    if (!isRec(parsed)) return parsed;
    const out: Json = { ...parsed };
    for (const c of DATA_LISTS) if (Array.isArray(out[c])) out[c] = sortListBy(out[c] as unknown[], "id");
    if (Array.isArray(out._deletedLeads)) out._deletedLeads = sortStrings(out._deletedLeads);
    if (isRec(out._deleted)) { const d: Json = {}; for (const [k, v] of Object.entries(out._deleted)) d[k] = sortStrings(v); out._deleted = d; }
    return out;
  }
  if (Array.isArray(parsed)) {
    const byId = sortListBy(parsed, "id");
    if (byId !== parsed) return byId;
    if (KEYED_LISTS.has(flatKey)) return sortListBy(parsed, "key");
  }
  return parsed;
}
export const orderFreeStringify = (flatKey: string, parsed: unknown): string => stable(orderFree(flatKey, parsed));

/** Valori di chiavi piatte (testo JSON) uguali per contenuto a meno dell'ordine delle liste di oggetti con id (vedi orderFree). Se non e' JSON valido: confronto del testo. */
export function sameFlatContent(flatKey: string, a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  try { return orderFreeStringify(flatKey, JSON.parse(a)) === orderFreeStringify(flatKey, JSON.parse(b)); } catch { return false; }
}

/**
 * Ordine CANONICO dei conti di Cassa nel valore condiviso: per chiave. Lo stesso per tutti i dispositivi (prima ognuno teneva il proprio e lo rimandava sul server).
 * L'ordine di visualizzazione resta in `conti-prefs.order` (per dispositivo) e non passa da qui. Ritorna il testo invariato se non e' una lista di voci con `key`.
 */
export function canonicalContiRaw(raw: string): string {
  try {
    const p = JSON.parse(raw);
    if (!Array.isArray(p)) return raw;
    const sorted = sortListBy(p, "key");
    return sorted === p ? raw : JSON.stringify(sorted);
  } catch { return raw; }
}

// ── Ospiti dell'organizzazione ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Gli ospiti dell'org sono una PROIEZIONE del locale (quelli citati dalle prenotazioni dell'org che questo dispositivo ha caricato), non l'elenco vero: un dispositivo
 * a finestra (modalita' veloce) puo' non avere la prenotazione che cita un ospite appena creato, pur avendo l'ospite. Se l'assenza dalla proiezione valesse «cancellato»
 * (fusione a 3 vie: era nella base e non c'e' piu' in locale) quel dispositivo lo toglierebbe dall'org e un altro lo rimetterebbe, in ciclo.
 * Per questo gli ospiti che erano gia' nella base dell'org e ci sono ancora nell'elenco locale completo (e non hanno lapide) restano nella proiezione.
 * Una vera cancellazione toglie l'ospite dal locale e mette la lapide: allora non si trattiene piu' e la fusione lo toglie, come prima.
 */
export function retainOrgGuests(localOrg: Json, baseOrgDataRaw: string | undefined, allGuests: unknown, tombGuests: unknown): Json {
  if (!baseOrgDataRaw) return localOrg;
  let base: unknown;
  try { base = JSON.parse(baseOrgDataRaw); } catch { return localOrg; }
  const baseGuests = isRec(base) && Array.isArray(base.guests) ? (base.guests as unknown[]) : [];
  if (!baseGuests.length) return localOrg;
  const have = new Set<string>();
  const cur = Array.isArray(localOrg.guests) ? (localOrg.guests as unknown[]) : [];
  for (const g of cur) { const id = fieldOf(g, "id"); if (id) have.add(id); }
  const all = new Map<string, unknown>();
  for (const g of Array.isArray(allGuests) ? (allGuests as unknown[]) : []) { const id = fieldOf(g, "id"); if (id) all.set(id, g); }
  const tombs = new Set<string>(Array.isArray(tombGuests) ? (tombGuests as unknown[]).filter((x): x is string => typeof x === "string") : []);
  const extra: unknown[] = [];
  for (const g of baseGuests) {
    const id = fieldOf(g, "id");
    if (!id || have.has(id) || tombs.has(id)) continue;
    const mine = all.get(id);
    if (mine === undefined) continue; // non c'e' piu' in locale: cancellato qui (o mai arrivato): la fusione decide
    have.add(id); extra.push(mine);
  }
  return extra.length ? { ...localOrg, guests: [...cur, ...extra] } : localOrg;
}
