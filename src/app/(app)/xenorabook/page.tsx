"use client";

import { useMemo } from "react";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";

// Immagine segnaposto originale (edifici + arco) per una struttura, colorata per hue.
function StructImg({ hue, initial }: { hue: number; initial: string }) {
  const h2 = (hue + 28) % 360;
  const id = `sb${hue}`;
  return (
    <svg viewBox="0 0 400 300" className="h-full w-full object-cover" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={`hsl(${hue},46%,58%)`} /><stop offset="1" stopColor={`hsl(${h2},42%,44%)`} />
      </linearGradient></defs>
      <rect width="400" height="300" fill={`url(#${id})`} />
      <g fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M96 210 v-70 a56 56 0 0 1 112 0 v70" />
        <path d="M150 210 v-42 a26 26 0 0 1 52 0 v42" />
        <path d="M232 210 v-96 l58 -34 v130" />
        <line x1="70" y1="212" x2="318" y2="212" />
      </g>
      <circle cx="316" cy="70" r="20" fill="#fff" fillOpacity="0.9" />
      <text x="316" y="77" textAnchor="middle" fontFamily="Georgia,serif" fontSize="22" fontWeight="700" fill={`hsl(${hue},46%,40%)`}>{initial}</text>
    </svg>
  );
}

const SAMPLES = [
  { name: "Casa del Càrrubo", area: "Ragusa · Ibla", rating: 4.9, reviews: 97, price: 134, hue: 96, amen: ["Terrazza", "Self check-in", "Wi-Fi"] },
  { name: "Le Terrazze di Ortigia", area: "Siracusa · Ortigia", rating: 4.7, reviews: 76, price: 150, hue: 38, amen: ["Vista mare", "A/C", "Colazione"] },
  { name: "Dimora San Giovanni", area: "Siracusa · Neapolis", rating: 4.8, reviews: 58, price: 88, hue: 268, amen: ["Parcheggio", "Animali ok", "Wi-Fi"] },
  { name: "Il Baglio di Marzamemi", area: "Noto · Marzamemi", rating: 4.9, reviews: 143, price: 172, hue: 150, amen: ["Vista mare", "Piscina", "Colazione"] },
];
const stars = (n: number) => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));

export default function XenoraBookPage() {
  const { structures } = useData();
  // Le TUE strutture in cima (come appariranno), poi esempi.
  const listings = useMemo(() => {
    const mine = structures.slice(0, 2).map((s, i) => ({
      name: s.name, area: "Siracusa", rating: [4.9, 4.8][i] ?? 4.8, reviews: [184, 132][i] ?? 90,
      price: [118, 96][i] ?? 100, hue: [18, 196][i] ?? 40, amen: ["Self check-in", "Colazione", "Wi-Fi"], mine: true,
    }));
    return [...mine, ...SAMPLES.map((s) => ({ ...s, mine: false }))];
  }, [structures]);

  const chips = ["✦ Solo Verificate", "Siracusa", "Ortigia", "Ragusa", "Vista mare", "Colazione inclusa", "Self check-in", "Parcheggio"];
  const criteria = [
    { ic: "★", tt: "Rating ≥ 4,7", ds: "Media recensioni verificate" },
    { ic: "✓", tt: "50+ recensioni", ds: "Airbnb, Booking, Xenora" },
    { ic: "🛡", tt: "Alloggiati 100%", ds: "Check-in a norma da 30+ giorni" },
    { ic: "€", tt: "Tassa soggiorno", ds: "Versata al 100% (audit auto)" },
  ];

  return (
    <>
      <PageHeader title="XenoraBook" subtitle="Il portale pubblico delle strutture verificate — anteprima" />

      <div className="mb-4 rounded-xl border border-line bg-wash px-4 py-3 text-sm text-dim">
        <b className="text-txt">Anteprima.</b> Qui appariranno le strutture Xenora che superano i criteri di qualità. Ranking e audit reali arrivano con il backend di XenoraBook; con l&apos;acquisto del dominio questa diventa la pagina pubblica dedicata.
      </div>

      {/* barra di ricerca (dimostrativa) */}
      <Card className="mb-4">
        <div className="grid gap-2 sm:grid-cols-[1.5fr_1fr_1fr_auto]">
          <div className="rounded-lg px-3 py-2 hover:bg-wash"><div className="text-[11px] font-bold uppercase tracking-wide text-faint">Destinazione</div><div className="text-sm font-semibold text-txt">Siracusa, Ortigia</div></div>
          <div className="rounded-lg px-3 py-2 hover:bg-wash"><div className="text-[11px] font-bold uppercase tracking-wide text-faint">Check-in → out</div><div className="text-sm font-semibold text-txt">12 – 15 lug</div></div>
          <div className="rounded-lg px-3 py-2 hover:bg-wash"><div className="text-[11px] font-bold uppercase tracking-wide text-faint">Ospiti</div><div className="text-sm font-semibold text-txt">2 adulti</div></div>
          <button className="flex items-center justify-center gap-2 rounded-lg bg-focus px-5 py-2.5 text-sm font-bold text-white"><Icon name="search" size={16} /> Cerca</button>
        </div>
      </Card>

      {/* filtri */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {chips.map((c, i) => (
          <button key={c} className={`whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-semibold ${i === 0 ? "bg-txt text-surface" : "border border-line bg-surface text-dim hover:text-txt"}`}>{c}</button>
        ))}
      </div>

      <div className="mb-2 flex items-baseline justify-between">
        <SectionTitle>Strutture verificate</SectionTitle>
        <span className="text-xs text-faint">{listings.length} risultati · esempio</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {listings.map((l, i) => (
          <article key={i} className="group overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-wash">
              <StructImg hue={l.hue} initial={l.name[0]} />
              <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-white shadow" style={{ backgroundColor: "#3F7A5B" }}>✦ Verificata</span>
              {l.mine && <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">La tua struttura</span>}
            </div>
            <div className="flex flex-col gap-1.5 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-[17px] font-bold text-txt">{l.name}</div>
                <div className="flex items-center gap-1 whitespace-nowrap text-[13px] font-bold text-txt"><span style={{ color: "#D99A2B" }}>★</span>{l.rating.toFixed(1)} <span className="font-semibold text-faint">({l.reviews})</span></div>
              </div>
              <div className="text-[13px] text-dim">📍 {l.area}</div>
              <div className="text-[12px]" style={{ color: "#D99A2B" }}>{stars(l.rating)}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">{l.amen.map((a) => <span key={a} className="rounded-md border border-line bg-wash px-2 py-0.5 text-[11px] text-dim">{a}</span>)}</div>
              <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2.5">
                <div className="text-lg font-extrabold text-txt">€{l.price} <span className="text-xs font-semibold text-dim">/ notte</span></div>
                <button className="rounded-lg bg-wash px-3 py-1.5 text-[13px] font-bold text-focus hover:bg-focus hover:text-white">Vedi →</button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* criteri */}
      <Card className="mt-6">
        <SectionTitle>Cosa significa «Verificata»</SectionTitle>
        <p className="mt-1 text-sm text-dim">Una struttura entra in XenoraBook solo se rispetta — in automatico, ricontrollati ogni mese — tutti questi requisiti.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {criteria.map((k) => (
            <div key={k.tt} className="flex items-start gap-3">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-lg text-sm" style={{ backgroundColor: "#E3F0E7", color: "#3F7A5B" }}>{k.ic}</span>
              <div><div className="text-[13px] font-bold text-txt">{k.tt}</div><div className="text-xs text-dim">{k.ds}</div></div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
