// ============================================================
//  Dati condivisi dell'anteprima XenoraBook (lista + scheda struttura).
//  Dati di ESEMPIO per l'anteprima OTA; le strutture reali dell'utente vengono
//  aggiunte a runtime (id "mine-<structureId>") dalla app_state/org_state.
// ============================================================
import type { ReactElement } from "react";

export type StructType = "B&B" | "Casa vacanze" | "Appartamento" | "Affittacamere" | "Hotel";

export interface Listing {
  id: string; name: string; area: string; city: string; type: StructType; starClass: number;
  rating: number; reviews: number; price: number; hue: number; amen: string[];
  capacity: number; beds: number; available: boolean; x: number; y: number; mine?: boolean;
  desc?: string;
}

export const CITIES = ["Tutte", "Siracusa", "Ortigia", "Ragusa", "Noto"];
export const AMEN_FILTERS = ["Vista mare", "Colazione", "Self check-in", "Parcheggio", "Piscina", "A/C", "Wi-Fi", "Animali ok"];
export const TYPES: StructType[] = ["B&B", "Casa vacanze", "Appartamento", "Affittacamere", "Hotel"];
export const stars = (n: number) => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));

const DESC = "Nel cuore della Sicilia sud-orientale, questa struttura verificata unisce accoglienza curata e posizione strategica. Camere luminose, colazione con prodotti del territorio e ospitalità premiata dalle recensioni.";

export const SAMPLES: Listing[] = [
  { id: "s1", name: "Casa del Càrrubo", area: "Ragusa · Ibla", city: "Ragusa", type: "Casa vacanze", starClass: 4, rating: 4.9, reviews: 97, price: 134, hue: 96, amen: ["Terrazza", "Self check-in", "Wi-Fi"], capacity: 4, beds: 3, available: true, x: 26, y: 63, desc: "Dimora in pietra a due passi dal Duomo di Ibla, con terrazza panoramica sui tetti barocchi. " + DESC },
  { id: "s2", name: "Le Terrazze di Ortigia", area: "Siracusa · Ortigia", city: "Ortigia", type: "B&B", starClass: 4, rating: 4.7, reviews: 76, price: 150, hue: 38, amen: ["Vista mare", "A/C", "Colazione"], capacity: 3, beds: 2, available: true, x: 74, y: 33, desc: "Affaccio sul mare di Ortigia, terrazze al tramonto e colazione siciliana. " + DESC },
  { id: "s3", name: "Dimora San Giovanni", area: "Siracusa · Neapolis", city: "Siracusa", type: "Affittacamere", starClass: 3, rating: 4.8, reviews: 58, price: 88, hue: 268, amen: ["Parcheggio", "Animali ok", "Wi-Fi"], capacity: 2, beds: 1, available: true, x: 66, y: 28, desc: "Comoda al Parco Archeologico, con parcheggio privato e ospiti a quattro zampe benvenuti. " + DESC },
  { id: "s4", name: "Il Baglio di Marzamemi", area: "Noto · Marzamemi", city: "Noto", type: "Hotel", starClass: 5, rating: 4.9, reviews: 143, price: 172, hue: 150, amen: ["Vista mare", "Piscina", "Colazione"], capacity: 6, beds: 4, available: true, x: 60, y: 86, desc: "Antico baglio affacciato sulla tonnara, piscina e ristorante di pesce. " + DESC },
  { id: "s5", name: "Corte Barocca", area: "Noto · centro", city: "Noto", type: "Appartamento", starClass: 3, rating: 4.8, reviews: 64, price: 112, hue: 20, amen: ["Colazione", "A/C", "Self check-in"], capacity: 4, beds: 2, available: false, x: 48, y: 72, desc: "Appartamento nel centro barocco di Noto, a pochi passi dalla Cattedrale. " + DESC },
  { id: "s6", name: "Blu di Ortigia", area: "Siracusa · Ortigia", city: "Ortigia", type: "B&B", starClass: 4, rating: 4.9, reviews: 121, price: 165, hue: 205, amen: ["Vista mare", "Wi-Fi", "A/C"], capacity: 2, beds: 1, available: true, x: 78, y: 38, desc: "Piccolo B&B di charme sul lungomare, camere in tonalità del blu. " + DESC },
];

// Strutture reali dell'utente trasformate in "annunci" (id "mine-<id>").
export function mineListings(structures: { id: string; name?: string }[]): Listing[] {
  return structures.slice(0, 3).map((s, i) => ({
    id: `mine-${s.id}`, name: s.name || "La mia struttura", area: "Siracusa · Ortigia", city: i === 0 ? "Ortigia" : "Siracusa",
    type: "B&B" as StructType, starClass: 4, rating: [4.9, 4.8, 4.7][i] ?? 4.8, reviews: [184, 132, 90][i] ?? 90,
    price: [118, 96, 108][i] ?? 100, hue: [18, 196, 300][i] ?? 40, amen: ["Self check-in", "Colazione", "Wi-Fi", "A/C"],
    capacity: 4, beds: 3, available: true, x: [72, 68, 76][i] ?? 70, y: [36, 30, 42][i] ?? 33, mine: true,
    desc: "La tua struttura su XenoraBook. " + DESC,
  }));
}

export function allListings(structures: { id: string; name?: string }[]): Listing[] {
  return [...mineListings(structures), ...SAMPLES];
}
export function getListing(structures: { id: string; name?: string }[], id: string): Listing | undefined {
  return allListings(structures).find((l) => l.id === id);
}

export interface Room { id: string; name: string; occ: number; price: number; refundable: boolean }
// Camere prenotabili derivate dalla struttura (esempio per l'anteprima).
export function roomsFor(l: Listing): Room[] {
  const b = l.price;
  const rooms: Room[] = [
    { id: "comfort", name: "Camera Matrimoniale Comfort", occ: 2, price: b, refundable: true },
    { id: "superior", name: "Camera Superior con vista", occ: 2, price: Math.round(b * 1.25), refundable: true },
  ];
  if (l.capacity >= 3) rooms.push({ id: "tripla", name: "Camera Tripla", occ: 3, price: Math.round(b * 1.4), refundable: false });
  if (l.capacity >= 4) rooms.push({ id: "suite", name: "Suite Familiare", occ: 4, price: Math.round(b * 1.7), refundable: true });
  return rooms;
}

// Immagine segnaposto originale (skyline + arco) per una struttura, colorata per hue.
export function StructImg({ hue, initial, className }: { hue: number; initial: string; className?: string }): ReactElement {
  const h2 = (hue + 28) % 360; const id = `sb${hue}`;
  return (
    <svg viewBox="0 0 400 300" className={className ?? "h-full w-full object-cover"} preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={`hsl(${hue},46%,58%)`} /><stop offset="1" stopColor={`hsl(${h2},42%,44%)`} /></linearGradient></defs>
      <rect width="400" height="300" fill={`url(#${id})`} />
      <g fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M96 210 v-70 a56 56 0 0 1 112 0 v70" /><path d="M150 210 v-42 a26 26 0 0 1 52 0 v42" />
        <path d="M232 210 v-96 l58 -34 v130" /><line x1="70" y1="212" x2="318" y2="212" />
      </g>
      <circle cx="316" cy="70" r="20" fill="#fff" fillOpacity="0.9" />
      <text x="316" y="77" textAnchor="middle" fontFamily="Georgia,serif" fontSize="22" fontWeight="700" fill={`hsl(${hue},46%,40%)`}>{initial}</text>
    </svg>
  );
}
