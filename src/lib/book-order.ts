// Ordine di una prenotazione dal sito pubblico (Xenosite, /prenota): extra scelti, codice promo e tariffe derivate. Logica SERVER, pura (l'unico I/O e' loadOwnerPromos).
// Il browser dell'ospite manda solo COSA ha scelto (id/quantita' degli extra, codice promo): prezzi e validita' si ricalcolano qui sui dati del proprietario.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeChosenExtras } from "./booking";
import { DEFAULT_EXTRAS, type ExtraService } from "./types";
import { isExamplePromo } from "./promo-example";

type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Tipologia "radice" di una tariffa derivata (deriveFrom): le camere fisiche appartengono alla madre, quindi disponibilita' e assegnazione della camera
 * si fanno sulla radice (come fa la pagina /prenota con rootType). Prezzo e prenotazione restano della tipologia scelta. Protetto dai cicli.
 */
export function rootRoomTypeId(roomTypes: Json[], rt: string): string {
  let cur = rt;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const node = roomTypes.find((x) => x.id === cur);
    const parent = node ? s(node.deriveFrom) : "";
    if (!parent || !roomTypes.some((x) => x.id === parent)) break;
    cur = parent;
  }
  return cur;
}

// ───────────────────────── codice promo ─────────────────────────

export interface BookPromo { code: string; pct: number }

/** Promo del proprietario da un blob di sync (chiave spigolestay:promos). */
export function promosFromBlob(blob: unknown): Json[] {
  try {
    const raw = (blob as Record<string, string> | null)?.["spigolestay:promos"];
    return raw ? arr(JSON.parse(raw)) : [];
  } catch { return []; }
}

/** Promo del proprietario: stato personale piu' organizzazioni condivise (come loadOwnerRatePlans, ma si sommano: ogni promo ha la sua struttura). */
export async function loadOwnerPromos(admin: SupabaseClient, ownerId: string): Promise<Json[]> {
  const out: Json[] = [];
  try {
    const { data: row } = await admin.from("app_state").select("data").eq("user_id", ownerId).maybeSingle();
    out.push(...promosFromBlob((row as { data?: unknown } | null)?.data));
    const { data: ms } = await admin.from("memberships").select("org_id").eq("user_id", ownerId);
    for (const m of arr(ms)) {
      const { data: os } = await admin.from("org_state").select("data").eq("org_id", m.org_id as string).maybeSingle();
      out.push(...promosFromBlob((os as { data?: unknown } | null)?.data));
    }
  } catch { /* nessuna promo leggibile: il codice non vale, nessuno sconto riconosciuto */ }
  return out;
}

/**
 * Il codice promo e' valido per questa struttura, per l'arrivo e per oggi? Stesse regole della pagina /prenota (applyPromoCode): codice uguale (maiuscole
 * ininfluenti), percentuale presente, scadenza offerta, periodo di soggiorno. null = non riconosciuto (nessuno sconto da concedere).
 */
export function resolveBookPromo(promos: Json[], code: string, o: { structureId: string; checkIn: string; today: string }): BookPromo | null {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  // Le promo di esempio precaricate (PASQUA15…) non sono offerte vere: il loro codice non vale (stessa regola del sito pubblico).
  const p = promos.find((x) => s(x.code).toUpperCase() === c && Number(x.discountPct) > 0 && (!s(x.structureId) || s(x.structureId) === o.structureId) && !isExamplePromo(x as never));
  if (!p) return null;
  if (s(p.validUntil) && o.today > s(p.validUntil)) return null;
  if (s(p.validFrom) && o.checkIn < s(p.validFrom)) return null;
  if (s(p.validTo) && o.checkIn > s(p.validTo)) return null;
  return { code: c, pct: Math.min(100, Math.max(0, Number(p.discountPct))) };
}

/**
 * Prezzo minimo accettabile del soggiorno dato lo sconto promo VALIDATO. `floor` e' la meta' del listino (stayFloor). Una promo legittima abbassa la soglia
 * (altrimenti un codice del 50% porterebbe sotto la meta' e verrebbe rifiutato), ma al massimo del 50% anche per i codici piu' alti (es. "notte gratis" 100%):
 * il minimo non scende mai sotto un quarto del listino e un codice inventato non cambia nulla.
 */
export function floorWithPromo(floor: number, promoPct: number): number {
  const pct = Math.min(50, Math.max(0, Number(promoPct) || 0));
  return Math.floor(floor * (1 - pct / 100));
}

// ───────────────────────── extra ─────────────────────────

/** Catalogo extra della struttura come lo mostra la pagina /prenota: quello della struttura se ha extra, altrimenti i predefiniti. */
export function bookExtrasCatalog(st: Json | null | undefined): ExtraService[] {
  const own = arr(st?.extras) as unknown as ExtraService[];
  return own.length ? own : DEFAULT_EXTRAS;
}

/** Extra scelti dall'ospite, validati sul catalogo del proprietario (nome e prezzo sono del server, mai del browser). */
export function priceBookExtras(raw: unknown, st: Json | null | undefined, stay: { checkIn: string; checkOut: string; adults: number }): { name: string; price: number; extraId: string; qty: number }[] {
  return sanitizeChosenExtras(raw, bookExtrasCatalog(st), stay);
}

export const extrasTotalOf = (list: { price: number }[]): number => Math.round(list.reduce((a, e) => a + (Number(e.price) || 0), 0) * 100) / 100;

/** Formato compatto per i metadata Stripe: "id~qty|id~qty". */
export const encodeOrderExtras = (list: { extraId: string; qty: number }[]): string => list.map((e) => `${e.extraId}~${e.qty}`).join("|").slice(0, 480);
export function decodeOrderExtras(raw: string | undefined): { id: string; qty: number }[] {
  const out: { id: string; qty: number }[] = [];
  for (const seg of String(raw || "").split("|")) {
    const [id, q] = seg.split("~");
    const qty = Math.round(Number(q));
    if (id && Number.isFinite(qty) && qty >= 1) out.push({ id, qty });
  }
  return out;
}
