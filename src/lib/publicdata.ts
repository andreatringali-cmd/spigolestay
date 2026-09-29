// Modalità "sito pubblico" (Xenosite su xenora.it/<slug>).
//
// Il mini-sito e il motore di prenotazione leggono i dati dallo store e da alcune
// chiavi localStorage (foto, promo, piani, regole prezzo, config sito). Per un
// visitatore anonimo questi dati non esistono nel suo browser: vengono invece
// PUBBLICATI sul server (tabella public_sites) e caricati qui in memoria.
//
// SNAP è un semplice dizionario chiave→stringa (le stesse stringhe che sarebbero
// in localStorage). Quando SNAP è attivo:
//   - lsGet() legge SOLO dallo snapshot (non tocca MAI il localStorage del
//     visitatore: nessun rischio di sovrascrivere i dati di un proprietario che
//     apre per caso il proprio sito pubblico);
//   - lo store e gli helper (immagini, promo, piani) usano lsGet come fonte.
//
// I dati pubblicati sono SANIFICATI: niente ospiti, niente PII/prezzi/note nelle
// prenotazioni (solo le date di occupazione per la disponibilità), niente dati
// fiscali della struttura.

import { supabase } from "./supabase";

export const DATA_KEY = "spigolestay:data:v1";
export const AUX_KEYS = [
  "spigolestay:sito",       // config del mini-sito (accent, tagline, sezioni, hero…)
  "spigolestay:images",     // foto (tipologie/camere)
  "spigolestay:promos",     // offerte
  "spigolestay:rateplans",  // piani tariffari
  "spigolestay:pricerules", // regole prezzo (weekend…)
];

// Segmenti già usati dall'app al primo livello dell'URL: uno slug pubblico non può
// coincidere con questi, altrimenti il sito verrebbe "coperto" dalla pagina interna.
export const RESERVED_SLUGS = new Set<string>([
  // route al root
  "accetta-invito", "api", "checkin", "g", "invito", "login", "og", "prenota", "preventivo", "sito-web",
  // route dell'app (gruppo)
  "abbonamento", "admin", "alloggiati", "assistente-ricavi", "calendario", "camere", "canali", "cassa",
  "guida-ospiti", "importa", "impostazioni", "mercato", "messaggi", "metasearch", "nettare", "ospiti",
  "pagamenti", "piani-tariffari", "prenotazioni", "preventivi", "promozioni", "pulizie", "rate-checker",
  "recensioni", "registro", "revenue", "sito", "statistiche", "strutture", "tariffe-derivate", "tariffe",
  "tassa-soggiorno", "upselling", "utenti", "widget",
  // asset/riservati vari
  "favicon.ico", "robots.txt", "sitemap.xml", "_next", "static", "public", "assets", "index",
]);

// ---- Config Xenosite: chiave scoped per struttura + migrazione ---------------
//
// FIX bug "il sottotitolo sparisce": prima di questo fix TUTTE le strutture
// condividevano un'unica chiave globale "spigolestay:sito" per la config del
// mini-sito (tagline/accent/sezioni/hero…). Configurare la struttura B
// sovrascriveva silenziosamente la config della struttura A nella stessa
// chiave. Ora ogni struttura ha la propria chiave `spigolestay:sito:<id>`.
export function siteConfigKey(structureId: string): string {
  return `spigolestay:sito:${structureId}`;
}

// Migrazione UNA TANTUM dalla vecchia chiave globale: se la struttura non ha
// ancora una chiave scoped propria, ma esiste ancora la vecchia chiave globale
// "spigolestay:sito", ne copiamo il contenuto nella chiave scoped — ma SOLO
// per la PRIMA struttura dell'account (structures[0].id, cioè `firstStructureId`).
// Euristica: la prima struttura è la più probabile "originale"/più vecchia,
// quindi la candidata più ragionevole per aver prodotto il valore legacy.
// Non è garantito: se l'utente aveva configurato per ultimo il sottotitolo di
// un'ALTRA struttura (non la prima), quel valore resta comunque intatto nella
// vecchia chiave globale (mai cancellata) ma non viene assegnato in automatico
// a nessuna struttura — l'utente dovrà reimpostarlo per quella struttura.
// Le altre strutture (senza chiave propria, diverse dalla prima) partono da un
// oggetto vuoto/DEF, per non ereditare per sbaglio la config di un'altra struttura.
export function getSiteConfigRaw(structureId: string, firstStructureId: string | undefined): string | null {
  const key = siteConfigKey(structureId);
  try {
    const scoped = localStorage.getItem(key);
    if (scoped != null) return scoped;
    if (firstStructureId && structureId === firstStructureId) {
      const legacy = localStorage.getItem("spigolestay:sito");
      if (legacy != null) {
        try { localStorage.setItem(key, legacy); } catch {}
        return legacy;
      }
    }
  } catch {}
  return null;
}

// Trasforma un nome struttura in slug URL-safe.
export function slugify(name: string): string {
  return (name || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

let SNAP: Record<string, string> | null = null;
let SLUG: string | null = null;

export function setPublicSnapshot(ls: Record<string, string>, slug?: string | null) {
  SNAP = ls;
  SLUG = slug ?? null;
}
export function isPublicMode(): boolean { return SNAP !== null; }
export function publicSlug(): string | null { return SLUG; }

// Carica dallo server il sito pubblicato per lo slug e attiva la modalità pubblica.
// Ritorna true se trovato. Idempotente.
export async function loadPublicSite(slug: string): Promise<boolean> {
  if (isPublicMode() && publicSlug() === slug) return true;
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.from("public_sites").select("data").eq("slug", slug).maybeSingle();
    if (error || !data || !data.data) return false;
    setPublicSnapshot(data.data as Record<string, string>, slug);
    return true;
  } catch { return false; }
}

// Lettura unificata: in modalità pubblica legge dallo snapshot, altrimenti dal localStorage.
export function lsGet(key: string): string | null {
  if (SNAP) return key in SNAP ? SNAP[key] : null;
  try { return localStorage.getItem(key); } catch { return null; }
}

// Campi struttura da NON pubblicare (dati fiscali/bancari privati).
const STRUCT_PRIVATE = ["vat", "taxCode", "iban", "ibanHolder"];

// Costruisce il dizionario da pubblicare per UNA struttura, a partire dal
// localStorage del proprietario. Ritorna null se la struttura non esiste.
export function buildPublishData(structureId: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let blob: {
    structures?: Record<string, unknown>[];
    roomTypes?: Record<string, unknown>[];
    units?: Record<string, unknown>[];
    bookings?: Record<string, unknown>[];
    events?: Record<string, unknown>[];
    rateOverrides?: Record<string, number>;
    directReviews?: Record<string, unknown>[];
  } = {};
  try { blob = JSON.parse(localStorage.getItem(DATA_KEY) || "{}"); } catch { return null; }

  const structures = (blob.structures ?? []).filter((s) => s.id === structureId);
  if (!structures.length) return null;
  const rtIds = new Set((blob.roomTypes ?? []).filter((rt) => rt.structureId === structureId).map((rt) => rt.id));

  // Struttura: rimuovo i campi privati. Restano i dati pubblici, incluso
  // googlePlaceId (serve al sito pubblico per mostrare le recensioni Google).
  const cleanStructs = structures.map((s) => {
    const c = { ...s };
    for (const k of STRUCT_PRIVATE) delete c[k];
    return c;
  });
  const roomTypes = (blob.roomTypes ?? []).filter((rt) => rt.structureId === structureId);
  const units = (blob.units ?? []).filter((u) => u.structureId === structureId);

  // Prenotazioni: SOLO le date di occupazione (nessun ospite, prezzo o nota).
  const bookings = (blob.bookings ?? [])
    .filter((b) => b.structureId === structureId || rtIds.has(b.roomTypeId as string))
    .map((b) => ({
      id: b.id,
      structureId: b.structureId,
      roomTypeId: b.roomTypeId,
      unitId: b.unitId ?? null,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      status: b.status,
      channel: b.channel,
    }));
  const events = (blob.events ?? []).filter((e) => (e as { structureId?: string }).structureId === structureId);

  // Recensioni dirette della struttura: pubblicate sul mini-sito (con l'eventuale
  // risposta del gestore). Sono dati NOSTRI, quindi possono comparire pubblicamente.
  const directReviews = (blob.directReviews ?? []).filter((r) => (r as { structureId?: string }).structureId === structureId);

  out[DATA_KEY] = JSON.stringify({
    structures: cleanStructs,
    roomTypes,
    units,
    bookings,
    guests: [],       // nessun dato ospite in pubblico
    events,
    rateOverrides: blob.rateOverrides ?? {},
    activities: [],
    directReviews,
  });

  // Chiavi ausiliarie: copiate così come sono (foto/promo/piani/regole/config).
  // "spigolestay:sito" è però SCOPED per struttura (vedi getSiteConfigRaw sopra):
  // leggiamo la chiave specifica di questa struttura, ma la scriviamo nello
  // snapshot pubblicato con la stessa chiave logica "spigolestay:sito", perché
  // lo snapshot pubblicato è già isolato per struttura (non serve scoping lì).
  const firstStructureId = (blob.structures ?? [])[0]?.id as string | undefined;
  for (const k of AUX_KEYS) {
    try {
      const v = k === "spigolestay:sito" ? getSiteConfigRaw(structureId, firstStructureId) : localStorage.getItem(k);
      if (v != null) out[k] = v;
    } catch {}
  }
  return out;
}

// ---- Rete di passaggio tra strutture dello STESSO proprietario --------------
//
// Quando un ospite cerca disponibilità su un Xenosite pubblico e la struttura
// è al completo per quelle date, cerchiamo tra le ALTRE strutture pubblicate
// dallo stesso account Xenora (public_sites.user_id — lo stesso identificativo
// che lega già le strutture "in comune" nel picker interno) una che abbia
// disponibilità VERA (camera libera + capienza sufficiente). Se la troviamo,
// il motore di prenotazione mostra un link diretto.
//
// V1, volutamente: SOLO strutture dello stesso proprietario. Nessuna
// condivisione dati con account diversi, nessun consenso da chiedere (è la
// stessa attività) e nessun meccanismo di invito tra tenant — quello è fuori
// scope (idea futura V2).
export interface SiblingSuggestion {
  slug: string;
  name: string;
  zone?: string;
  city?: string;
}

// Risolve, seguendo l'eventuale catena di derivazione (tariffe derivate
// condividono le camere fisiche della tipologia madre), l'id della tipologia
// "radice" a cui sono collegate le unità fisiche — stessa logica di
// rootType() nel motore di prenotazione (src/app/prenota/page.tsx).
function siblingRootId(rt: { id: string; deriveFrom?: string }, all: { id: string; deriveFrom?: string }[]): string {
  let cur = rt;
  const seen = new Set<string>();
  while (cur.deriveFrom && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = all.find((x) => x.id === cur.deriveFrom);
    if (!parent) break;
    cur = parent;
  }
  return cur.id;
}

export async function findAvailableSibling(opts: {
  currentSlug: string;
  currentStructureId?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
}): Promise<SiblingSuggestion | null> {
  if (!supabase) return null;
  try {
    const { data: mine } = await supabase.from("public_sites").select("user_id,structure_id").eq("slug", opts.currentSlug).maybeSingle();
    const ownerId = mine?.user_id as string | undefined;
    if (!ownerId) return null;
    const myStructureId = opts.currentStructureId || (mine?.structure_id as string | undefined);
    const { data: rows } = await supabase.from("public_sites").select("slug,structure_id,structure_name,data").eq("user_id", ownerId);
    if (!rows || rows.length < 2) return null; // serve almeno un'ALTRA struttura pubblicata

    for (const row of rows) {
      if (!row.slug || row.structure_id === myStructureId) continue; // salta la struttura corrente
      const raw = row.data as Record<string, string> | null;
      if (!raw || !raw[DATA_KEY]) continue;
      let blob: {
        structures?: Array<{ name?: string; zone?: string; city?: string; crossSuggestEnabled?: boolean }>;
        roomTypes?: Array<{ id: string; deriveFrom?: string; salesClosed?: boolean; maxOccupancy?: number; beds?: number }>;
        units?: Array<{ id: string; roomTypeId: string; outOfService?: boolean }>;
        bookings?: Array<{ unitId?: string | null; status?: string; channel?: string; checkIn: string; checkOut: string }>;
      };
      try { blob = JSON.parse(raw[DATA_KEY]); } catch { continue; }
      const structure = (blob.structures ?? [])[0];
      if (!structure) continue;
      const roomTypes = blob.roomTypes ?? [];
      const units = blob.units ?? [];
      const bookings = blob.bookings ?? [];
      const hasFree = roomTypes.some((rt) => {
        if (rt.salesClosed) return false;
        if ((rt.maxOccupancy ?? rt.beds ?? 0) < opts.guests) return false;
        const rootId = siblingRootId(rt, roomTypes);
        return units.some((u) => u.roomTypeId === rootId && !u.outOfService && !bookings.some((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.unitId === u.id && b.checkIn < opts.checkOut && b.checkOut > opts.checkIn));
      });
      if (hasFree) {
        return { slug: row.slug as string, name: (row.structure_name as string) || structure.name || "Un'altra struttura", zone: structure.zone, city: structure.city };
      }
    }
    return null;
  } catch { return null; }
}
