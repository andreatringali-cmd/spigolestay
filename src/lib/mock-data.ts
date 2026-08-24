import type { Structure, RoomType, Unit, Guest, Booking, Channel } from "./types";
import { addDays, toISO } from "./dates";

// Assetto reale (semplificato): 4 strutture, tutte camere "Deluxe".
export const STRUCTURES: Structure[] = [
  { id: "st_house", name: "Spigole House", groupName: "Spigole", city: "Siracusa", photoColor: "#4F46E5" },
  { id: "st_rooms", name: "Spigole Rooms", groupName: "Spigole", city: "Siracusa", photoColor: "#0EA5E9" },
  { id: "st_cpa", name: "Central Perk Via Antioco", groupName: "Central Perk", city: "Siracusa", photoColor: "#E11D48" },
  { id: "st_cpd", name: "Central Perk Via Adige", groupName: "Central Perk", city: "Siracusa", photoColor: "#EAB308" },
];

export const ROOM_TYPES: RoomType[] = [
  { id: "rt_house", structureId: "st_house", name: "Deluxe", beds: 2, basePrice: 100 },
  { id: "rt_house_tri", structureId: "st_house", name: "Tripla", beds: 3, basePrice: 120 },
  { id: "rt_rooms", structureId: "st_rooms", name: "Deluxe", beds: 2, basePrice: 100 },
  { id: "rt_cpa", structureId: "st_cpa", name: "Deluxe", beds: 2, basePrice: 110 },
  { id: "rt_cpd", structureId: "st_cpd", name: "Deluxe", beds: 2, basePrice: 110 },
];

export const UNITS: Unit[] = [
  { id: "u_h1", structureId: "st_house", roomTypeId: "rt_house", name: "Camera 1" },
  { id: "u_h2", structureId: "st_house", roomTypeId: "rt_house_tri", name: "Camera 2" },
  { id: "u_h3", structureId: "st_house", roomTypeId: "rt_house", name: "Camera 3" },
  { id: "u_h4", structureId: "st_house", roomTypeId: "rt_house", name: "Camera 4" },
  { id: "u_r5", structureId: "st_rooms", roomTypeId: "rt_rooms", name: "Camera 5" },
  { id: "u_r6", structureId: "st_rooms", roomTypeId: "rt_rooms", name: "Camera 6" },
  { id: "u_r7", structureId: "st_rooms", roomTypeId: "rt_rooms", name: "Camera 7" },
  { id: "u_r8", structureId: "st_rooms", roomTypeId: "rt_rooms", name: "Camera 8" },
  { id: "u_a1", structureId: "st_cpa", roomTypeId: "rt_cpa", name: "Camera 1" },
  { id: "u_a2", structureId: "st_cpa", roomTypeId: "rt_cpa", name: "Camera 2" },
  { id: "u_a3", structureId: "st_cpa", roomTypeId: "rt_cpa", name: "Camera 3" },
  { id: "u_a4", structureId: "st_cpa", roomTypeId: "rt_cpa", name: "Camera 4" },
  { id: "u_d1", structureId: "st_cpd", roomTypeId: "rt_cpd", name: "Camera 1" },
  { id: "u_d2", structureId: "st_cpd", roomTypeId: "rt_cpd", name: "Camera 2" },
  { id: "u_d3", structureId: "st_cpd", roomTypeId: "rt_cpd", name: "Camera 3" },
  { id: "u_d4", structureId: "st_cpd", roomTypeId: "rt_cpd", name: "Camera 4", outOfService: true },
];

// ─────────── Generatore deterministico (stabile tra i reload) ───────────
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260812);
const pick = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)];

const FIRST = ["Marco", "Anna", "Luca", "Giulia", "Claire", "Hans", "Emily", "Lucía", "Piotr", "Minh", "Sofia", "Paolo", "Emma", "Liam", "Olivia", "Chiara", "Matteo", "Sara", "Davide", "Elena", "Jan", "Sven", "Maria", "José", "Yuki", "Chen", "Nina", "Tom", "Kate", "Peter", "Laura", "Andrea", "Ivan", "Petra", "Diego", "Noah", "Marta", "Francesca", "Ahmed", "Fatima"];
const LAST = ["Rossi", "Bianchi", "Esposito", "Müller", "Brown", "García", "Kowalski", "Nguyen", "Ferrari", "Romano", "Dupont", "Smith", "Johnson", "Novak", "Ivanov", "Yilmaz", "Silva", "Santos", "Moretti", "Conti", "Ricci", "Greco", "Bruno", "Weber", "Schmidt", "Fischer", "Lombardi", "Marino"];
const COUNTRIES: [string, string][] = [["IT", "it"], ["FR", "fr"], ["DE", "de"], ["GB", "en"], ["ES", "es"], ["US", "en"], ["NL", "en"], ["PL", "en"], ["CH", "de"], ["AT", "de"], ["BE", "fr"], ["SE", "en"]];

const BIRTH_PLACES = ["Roma", "Milano", "Napoli", "Torino", "Palermo", "Catania", "Siracusa", "Bologna", "Firenze", "Bari"];
const DOC_KINDS = ["CARTA IDENTITA'", "PASSAPORTO", "PATENTE"];
export const GUESTS: Guest[] = Array.from({ length: 50 }, (_, i) => {
  const first = pick(FIRST);
  const last = pick(LAST);
  const [country, language] = pick(COUNTRIES);
  const g: Guest = {
    id: `g${i + 1}`,
    fullName: `${first} ${last}`,
    firstName: first,
    lastName: last,
    email: `${first}.${last}${i}`.toLowerCase().replace(/[^a-z0-9.]/g, "") + "@example.com",
    phone: `+39 3${Math.floor(rng() * 90 + 10)} ${Math.floor(rng() * 900 + 100)} ${Math.floor(rng() * 9000 + 1000)}`,
    country,
    language,
  };
  // ~65% degli ospiti ha già i dati documento completi → schedina alloggiati pronta (il resto no).
  if (rng() < 0.65) {
    g.sex = rng() < 0.5 ? "M" : "F";
    g.birthDate = `19${70 + Math.floor(rng() * 35)}-${String(1 + Math.floor(rng() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rng() * 28)).padStart(2, "0")}`;
    g.birthPlace = pick(BIRTH_PLACES);
    g.citizenship = country;
    g.docType = pick(DOC_KINDS);
    g.docNumber = `${String.fromCharCode(65 + Math.floor(rng() * 26))}${String.fromCharCode(65 + Math.floor(rng() * 26))}${Math.floor(rng() * 9000000 + 1000000)}`;
  }
  return g;
});
// Ospite dell'esempio turnover (Camera 2, 14/08).
GUESTS.push({ id: "g_turn_demo", fullName: "Luca Verdi", email: "luca.verdi@example.com", phone: "+39 333 1234567", country: "Italia" });

const CHANNELS_POOL: Channel[] = ["booking", "booking", "airbnb", "airbnb", "expedia", "direct", "direct"];
const basePriceOf = (roomTypeId: string) => ROOM_TYPES.find((r) => r.id === roomTypeId)?.basePrice ?? 100;

// 120 prenotazioni, senza sovrapposizioni per camera, distribuite nel tempo.
function generateBookings(count: number): Booking[] {
  const bookable = UNITS.filter((u) => !u.outOfService);
  const rangeStart = new Date(2026, 6, 1); // 1 luglio 2026
  const nextFree = bookable.map(() => addDays(rangeStart, Math.floor(rng() * 20)));
  const out: Booking[] = [];

  for (let k = 0; k < count; k++) {
    // camera con la prima data libera più vicina → riempimento uniforme
    let ui = 0;
    for (let j = 1; j < bookable.length; j++) if (nextFree[j] < nextFree[ui]) ui = j;
    const u = bookable[ui];
    const checkInD = nextFree[ui];
    const los = 2 + Math.floor(rng() * 6); // 2–7 notti
    const checkOutD = addDays(checkInD, los);
    const g = pick(GUESTS);
    const adults = 1 + Math.floor(rng() * 2);
    const children = rng() < 0.25 ? 1 : 0;
    const total = Math.round(los * basePriceOf(u.roomTypeId) * (1 + rng() * 0.35));
    const unassigned = rng() < 0.035;
    const leadTime = 3 + Math.floor(rng() * 90); // prenotata 3–92 giorni prima del check-in

    // Stato incasso realistico: ~45% saldato, ~30% acconto (~30%), il resto ancora da pagare.
    const r = rng();
    const paid = r < 0.45 ? total : r < 0.75 ? Math.round(total * 0.3) : 0;

    out.push({
      id: `b${k + 1}`,
      structureId: u.structureId,
      roomTypeId: u.roomTypeId,
      unitId: unassigned ? null : u.id,
      guestId: g.id,
      channel: pick(CHANNELS_POOL),
      status: "confirmed",
      checkIn: toISO(checkInD),
      checkOut: toISO(checkOutD),
      bookedOn: toISO(addDays(checkInD, -leadTime)),
      adults,
      children,
      total,
      paid,
    });

    const gap = 1 + Math.floor(rng() * 9); // 1–9 giorni di stacco
    nextFree[ui] = addDays(checkOutD, gap);
  }
  return out.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
}

export const BOOKINGS: Booking[] = [
  ...generateBookings(120),
  // Esempio turnover: Camera 2 (u_h2) — arrivo lo stesso giorno (14/08) della partenza già presente.
  { id: "b_turn_demo", structureId: "st_house", roomTypeId: "rt_house", unitId: "u_h2", guestId: "g_turn_demo", channel: "direct", status: "confirmed", checkIn: "2026-08-14", checkOut: "2026-08-17", bookedOn: "2026-08-01", adults: 2, children: 1, total: 360 },
];
