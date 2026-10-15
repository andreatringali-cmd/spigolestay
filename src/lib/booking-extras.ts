// Extra nella scheda prenotazione (animali, culla, letto aggiuntivo, e ogni altro extra del catalogo della struttura).
// Modulo puro. NON introduce un secondo concetto di "extra": estende quello esistente.
//   - il CATALOGO per struttura è Structure.extras (lo stesso del modulo Upselling, del motore di prenotazione e del check-in online);
//   - le VOCI vendute vivono in Booking.extras ({ name, price, extraId, qty }) con `price` = TOTALE della riga (prezzo × quantità × notti/persone);
//   - il totale ospite le somma già ovunque (bookingExtrasTotal/bookingPaidTotal/bookingGrandTotal, Cassa, fatture, BookingAmounts),
//     quindi aggiungere una voce qui non richiede altri ricalcoli e non crea doppi conteggi: una voce è identificata dall'extraId.

import type { Booking, ExtraService } from "./types";
import { entryMatches, entryName, isActive, unitAmount } from "./upselling";

export type BookingExtraEntry = NonNullable<Booking["extras"]>[number];

/** Quanto serve di una prenotazione per calcolare il prezzo di una riga (anche dal modulo di modifica, prima del salvataggio). */
export type StayLike = Pick<Booking, "checkIn" | "checkOut" | "adults">;

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * I tre extra suggeriti per ogni struttura. Id fissi: così si riconoscono ovunque e non si duplicano.
 * I prezzi sono solo un punto di partenza (confirmed:false → "prezzo di esempio", non proposti agli ospiti finché il gestore non li conferma);
 * la culla è gratuita per scelta (free:true).
 */
export const SUGGESTED_EXTRAS: ExtraService[] = [
  { id: "animale-domestico", name: "Animale domestico (piccola/media taglia)", desc: "Cani e gatti di piccola e media taglia, su richiesta.", price: 10, per: "stay", kind: "other", maxQty: 2, confirmed: false },
  { id: "culla-da-campo", name: "Culla da campo", desc: "Gratuita, su richiesta.", price: 0, per: "stay", kind: "other", maxQty: 1, free: true, confirmed: true },
  { id: "letto-aggiuntivo", name: "Letto aggiuntivo", desc: "Letto extra in camera, su richiesta.", price: 20, per: "night", kind: "other", maxQty: 2, confirmed: false },
];

/** Suggeriti che la struttura non ha ancora nel catalogo (confronto per id). */
export function missingSuggested(catalog: ExtraService[] | undefined): ExtraService[] {
  const have = new Set((catalog ?? []).map((e) => e.id));
  return SUGGESTED_EXTRAS.filter((s) => !have.has(s.id));
}

/** Catalogo + i suggeriti mancanti (senza duplicati): il catalogo che il gestore vede nella scheda prenotazione. */
export function catalogWithSuggested(catalog: ExtraService[] | undefined): ExtraService[] {
  return [...(catalog ?? []), ...missingSuggested(catalog)];
}

/** Gli extra selezionabili in una prenotazione: attivi; il gratuito è selezionabile (non serve un prezzo > 0). */
export function selectableExtras(catalog: ExtraService[] | undefined): ExtraService[] {
  return catalogWithSuggested(catalog).filter(isActive);
}

/** Voce della prenotazione che corrisponde a un extra di catalogo (per id; per le voci vecchie senza id, per nome). */
export function entryFor(entries: BookingExtraEntry[] | undefined, e: Pick<ExtraService, "id" | "name">): BookingExtraEntry | undefined {
  return (entries ?? []).find((x) => entryMatches(x, e));
}

/** Quantità attuale di un extra nella prenotazione (0 = non presente). */
export function entryQty(entries: BookingExtraEntry[] | undefined, e: Pick<ExtraService, "id" | "name">): number {
  const hit = entryFor(entries, e);
  if (!hit) return 0;
  const fromName = Number(/\s×\s?(\d+)$/u.exec(hit.name || "")?.[1]); // voci vecchie (nuova prenotazione, Upselling) senza qty: "Culla ×2"
  return Math.max(1, Math.round(hit.qty ?? (Number.isFinite(fromName) && fromName > 0 ? fromName : 1)));
}

/** Importo di UNA unità dell'extra per questo soggiorno (a notte × notti, a persona × adulti, una tantum = prezzo). */
export function extraUnitAmount(e: Pick<ExtraService, "price" | "per">, stay: StayLike): number {
  return round2(unitAmount(e, stay));
}

/** Quantità massima consentita per l'extra (maxQty del catalogo; senza tetto 99). */
export const maxQtyOf = (e: Pick<ExtraService, "maxQty">) => Math.max(1, Math.round(e.maxQty ?? 99));

/**
 * Imposta la quantità di un extra di catalogo: aggiunge la voce (qty ≥ 1), ne cambia la quantità o la toglie (qty = 0).
 * La riga conserva extraId e, se c'è, offerId (voce nata da un'offerta Upselling): nessun doppione, nessun conteggio doppio.
 * Il prezzo della riga è un'istantanea: prezzo unitario × quantità al momento della scelta.
 */
export function setExtraQty(entries: BookingExtraEntry[] | undefined, e: ExtraService, qty: number, stay: StayLike): BookingExtraEntry[] {
  const list = [...(entries ?? [])];
  const q = Math.max(0, Math.min(maxQtyOf(e), Math.round(Number.isFinite(qty) ? qty : 0)));
  const idx = list.findIndex((x) => entryMatches(x, e));
  if (q === 0) return idx >= 0 ? list.filter((_, i) => i !== idx) : list;
  const line: BookingExtraEntry = {
    ...(idx >= 0 ? list[idx] : {}),
    name: entryName(e.name, q),
    price: round2(extraUnitAmount(e, stay) * q),
    extraId: e.id,
    qty: q,
  };
  if (idx >= 0) { list[idx] = line; return list; }
  return [...list, line];
}

/** Totale delle voci (stessa somma di bookingExtrasTotal: price è già il totale della riga). */
export function entriesTotal(entries: BookingExtraEntry[] | undefined): number {
  return round2((entries ?? []).reduce((a, x) => a + (x?.price || 0), 0));
}

/** Voci "libere" (consumi e servizi non presenti nel catalogo della struttura): si mostrano a parte, con la possibilità di toglierle. */
export function freeEntries(entries: BookingExtraEntry[] | undefined, catalog: ExtraService[]): { entry: BookingExtraEntry; index: number }[] {
  const out: { entry: BookingExtraEntry; index: number }[] = [];
  (entries ?? []).forEach((x, index) => { if (!catalog.some((c) => entryMatches(x, c))) out.push({ entry: x, index }); });
  return out;
}

/** Etichetta della modalità di calcolo, per il gestore ("gratis", "una tantum", "a notte"…). */
export function pricingLabel(e: Pick<ExtraService, "price" | "per" | "free">): string {
  if (e.free || !(e.price > 0)) return e.free ? "gratis" : "prezzo da impostare";
  switch (e.per) {
    case "night": return "a notte";
    case "person": return "a persona";
    case "day": return "a giornata";
    default: return "una tantum";
  }
}
