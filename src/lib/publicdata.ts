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
  } = {};
  try { blob = JSON.parse(localStorage.getItem(DATA_KEY) || "{}"); } catch { return null; }

  const structures = (blob.structures ?? []).filter((s) => s.id === structureId);
  if (!structures.length) return null;
  const rtIds = new Set((blob.roomTypes ?? []).filter((rt) => rt.structureId === structureId).map((rt) => rt.id));

  // Struttura: rimuovo i campi privati.
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

  out[DATA_KEY] = JSON.stringify({
    structures: cleanStructs,
    roomTypes,
    units,
    bookings,
    guests: [],       // nessun dato ospite in pubblico
    events,
    rateOverrides: blob.rateOverrides ?? {},
    activities: [],
  });

  // Chiavi ausiliarie: copiate così come sono (foto/promo/piani/regole/config).
  for (const k of AUX_KEYS) {
    try { const v = localStorage.getItem(k); if (v != null) out[k] = v; } catch {}
  }
  return out;
}
