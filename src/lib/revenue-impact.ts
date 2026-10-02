// Revenue — simulazione dell'impatto in € di una variazione di tariffe, PRIMA di applicarla.
//
// Principio di onestà: una nuova tariffa NON cambia il prezzo delle prenotazioni già confermate
// (quelle restano al prezzo con cui sono state vendute). Può influire solo sulle camere ancora
// LIBERE in quel giorno. Quindi l'effetto è sempre calcolato sulle camere libere reali, mai sulle
// vendute, e va letto come "scenario in cui quelle camere si vendono" (limite superiore del
// guadagno / della perdita), non come una previsione di incasso: non conosciamo la domanda.
//
// Logica pura, senza dipendenze: testabile con `npm test`.
import type { Booking, Unit } from "./types";

export interface PriceChangeInput { typeId: string; iso: string; current: number; next: number }

export interface TypeDayAvailability { total: number; sold: number; free: number }

// Una prenotazione occupa la tipologia in quel giorno se è sull'unità della tipologia oppure,
// se non ha ancora un'unità assegnata, se è prenotata per quella tipologia. I blocchi
// ("fuori servizio") contano come occupati: non sono vendibili.
export function typeDayAvailability(bookings: Booking[], units: Unit[], typeId: string, iso: string): TypeDayAvailability {
  const typeUnits = units.filter((u) => u.roomTypeId === typeId && !u.outOfService);
  const ids = new Set(typeUnits.map((u) => u.id));
  const total = typeUnits.length;
  let sold = 0;
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    if (!(b.checkIn <= iso && iso < b.checkOut)) continue;
    if (b.unitId ? ids.has(b.unitId) : b.roomTypeId === typeId) sold++;
  }
  sold = Math.min(sold, total);
  return { total, sold, free: Math.max(0, total - sold) };
}

export interface ImpactSummary {
  changes: number;            // tariffe che cambiano davvero
  ups: number; downs: number; // quante salgono / scendono
  avgDeltaPct: number;        // variazione media % (semplice, sulle tariffe modificate)
  freeNightRooms: number;     // notti-camera ancora libere interessate dal cambio
  soldNightRooms: number;     // notti-camera già vendute: prezzo NON cambia
  revenueBefore: number;      // € se si vendessero tutte le libere alla tariffa attuale
  revenueAfter: number;       // € se si vendessero tutte le libere alla nuova tariffa
  deltaMaxUp: number;         // somma dei rialzi sulle camere libere (limite superiore del guadagno)
  deltaMaxDown: number;       // somma dei ribassi sulle camere libere (limite superiore della perdita, ≤ 0)
  net: number;                // revenueAfter − revenueBefore
}

export function simulateImpact(changes: PriceChangeInput[], bookings: Booking[], units: Unit[]): ImpactSummary {
  const s: ImpactSummary = { changes: 0, ups: 0, downs: 0, avgDeltaPct: 0, freeNightRooms: 0, soldNightRooms: 0, revenueBefore: 0, revenueAfter: 0, deltaMaxUp: 0, deltaMaxDown: 0, net: 0 };
  let pctSum = 0;
  for (const c of changes) {
    if (!(c.next >= 0) || c.next === c.current) continue;
    const av = typeDayAvailability(bookings, units, c.typeId, c.iso);
    s.changes++;
    if (c.next > c.current) s.ups++; else s.downs++;
    if (c.current > 0) pctSum += ((c.next - c.current) / c.current) * 100;
    s.freeNightRooms += av.free; s.soldNightRooms += av.sold;
    s.revenueBefore += c.current * av.free; s.revenueAfter += c.next * av.free;
    const d = (c.next - c.current) * av.free;
    if (d > 0) s.deltaMaxUp += d; else s.deltaMaxDown += d;
  }
  s.avgDeltaPct = s.changes ? Math.round(pctSum / s.changes) : 0;
  s.net = s.revenueAfter - s.revenueBefore;
  return s;
}
