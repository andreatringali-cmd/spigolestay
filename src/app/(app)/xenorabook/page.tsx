"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useData } from "@/lib/store";
import { Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";

// ── Immagine segnaposto originale (skyline + arco) colorata per hue ──
function StructImg({ hue, initial }: { hue: number; initial: string }) {
  const h2 = (hue + 28) % 360; const id = `sb${hue}`;
  return (
    <svg viewBox="0 0 400 300" className="h-full w-full object-cover" preserveAspectRatio="xMidYMid slice">
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

type StructType = "B&B" | "Casa vacanze" | "Appartamento" | "Affittacamere" | "Hotel";
interface Listing { id: string; name: string; area: string; city: string; type: StructType; starClass: number; rating: number; reviews: number; price: number; hue: number; amen: string[]; capacity: number; beds: number; available: boolean; x: number; y: number; mine?: boolean }

const SAMPLES: Listing[] = [
  { id: "s1", name: "Casa del Càrrubo", area: "Ragusa · Ibla", city: "Ragusa", type: "Casa vacanze", starClass: 4, rating: 4.9, reviews: 97, price: 134, hue: 96, amen: ["Terrazza", "Self check-in", "Wi-Fi"], capacity: 4, beds: 3, available: true, x: 26, y: 63 },
  { id: "s2", name: "Le Terrazze di Ortigia", area: "Siracusa · Ortigia", city: "Ortigia", type: "B&B", starClass: 4, rating: 4.7, reviews: 76, price: 150, hue: 38, amen: ["Vista mare", "A/C", "Colazione"], capacity: 3, beds: 2, available: true, x: 74, y: 33 },
  { id: "s3", name: "Dimora San Giovanni", area: "Siracusa · Neapolis", city: "Siracusa", type: "Affittacamere", starClass: 3, rating: 4.8, reviews: 58, price: 88, hue: 268, amen: ["Parcheggio", "Animali ok", "Wi-Fi"], capacity: 2, beds: 1, available: true, x: 66, y: 28 },
  { id: "s4", name: "Il Baglio di Marzamemi", area: "Noto · Marzamemi", city: "Noto", type: "Hotel", starClass: 5, rating: 4.9, reviews: 143, price: 172, hue: 150, amen: ["Vista mare", "Piscina", "Colazione"], capacity: 6, beds: 4, available: true, x: 60, y: 86 },
  { id: "s5", name: "Corte Barocca", area: "Noto · centro", city: "Noto", type: "Appartamento", starClass: 3, rating: 4.8, reviews: 64, price: 112, hue: 20, amen: ["Colazione", "A/C", "Self check-in"], capacity: 4, beds: 2, available: false, x: 48, y: 72 },
  { id: "s6", name: "Blu di Ortigia", area: "Siracusa · Ortigia", city: "Ortigia", type: "B&B", starClass: 4, rating: 4.9, reviews: 121, price: 165, hue: 205, amen: ["Vista mare", "Wi-Fi", "A/C"], capacity: 2, beds: 1, available: true, x: 78, y: 38 },
];
const CITIES = ["Tutte", "Siracusa", "Ortigia", "Ragusa", "Noto"];
const AMEN_FILTERS = ["Vista mare", "Colazione", "Self check-in", "Parcheggio", "Piscina", "A/C", "Wi-Fi", "Animali ok"];
const TYPES: StructType[] = ["B&B", "Casa vacanze", "Appartamento", "Affittacamere", "Hotel"];
const stars = (n: number) => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));

export default function XenoraBookPage() {
  const { structures } = useData();
  const [city, setCity] = useState("Tutte");
  const [amen, setAmen] = useState<string[]>([]);
  const [sort, setSort] = useState<"consigliate" | "prezzo" | "rating">("consigliate");
  const [view, setView] = useState<"lista" | "mappa">("lista");
  const [hovered, setHovered] = useState<string>("");
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [rooms, setRooms] = useState(1);
  const [minRating, setMinRating] = useState(0);   // recensioni
  const [starClass, setStarClass] = useState(0);   // stelle struttura
  const [minBeds, setMinBeds] = useState(0);        // posti letto
  const [types, setTypes] = useState<StructType[]>([]); // tipologia
  const [onlyAvail, setOnlyAvail] = useState(false);   // disponibilità
  const [moreOpen, setMoreOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const guestsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (guestsRef.current && !guestsRef.current.contains(e.target as Node)) setGuestsOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  const all: Listing[] = useMemo(() => {
    const mine: Listing[] = structures.slice(0, 2).map((s, i) => ({
      id: `mine-${s.id}`, name: s.name, area: "Siracusa · Ortigia", city: i === 0 ? "Ortigia" : "Siracusa",
      type: "B&B" as StructType, starClass: 4,
      rating: [4.9, 4.8][i] ?? 4.8, reviews: [184, 132][i] ?? 90, price: [118, 96][i] ?? 100,
      hue: [18, 196][i] ?? 40, amen: ["Self check-in", "Colazione", "Wi-Fi"], capacity: 4, beds: 3, available: true,
      x: [72, 68][i] ?? 70, y: [36, 30][i] ?? 33, mine: true,
    }));
    return [...mine, ...SAMPLES];
  }, [structures]);

  const guestsTot = adults + children;
  const results = useMemo(() => {
    let r = all.filter((l) =>
      (city === "Tutte" || l.city === city) &&
      l.capacity >= guestsTot &&
      amen.every((a) => l.amen.includes(a)) &&
      l.rating >= minRating &&
      (starClass === 0 || l.starClass === starClass) &&
      l.beds >= minBeds &&
      (types.length === 0 || types.includes(l.type)) &&
      (!onlyAvail || l.available)
    );
    if (sort === "prezzo") r = [...r].sort((a, b) => a.price - b.price);
    else if (sort === "rating") r = [...r].sort((a, b) => b.rating - a.rating);
    else r = [...r].sort((a, b) => Number(b.mine) - Number(a.mine) || b.rating - a.rating);
    return r;
  }, [all, city, guestsTot, amen, sort, minRating, starClass, minBeds, types, onlyAvail]);
  const activeCount = (minRating ? 1 : 0) + (starClass ? 1 : 0) + (minBeds ? 1 : 0) + types.length + (onlyAvail ? 1 : 0);

  const toggleAmen = (a: string) => setAmen((p) => p.includes(a) ? p.filter((x) => x !== a) : [...p, a]);
  const toggleType = (t: StructType) => setTypes((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t]);
  const resetFilters = () => { setMinRating(0); setStarClass(0); setMinBeds(0); setTypes([]); setOnlyAvail(false); setAmen([]); };
  const nights = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) || 1);

  return (
    <>
      {/* ── HERO d'impatto ── */}
      <section className="relative mb-24 overflow-hidden rounded-3xl sm:mb-16" style={{ background: "linear-gradient(135deg,#1E3A46 0%,#2E5B63 42%,#BE5D38 100%)" }}>
        <HeroDeco />
        <div className="relative px-6 py-12 sm:px-10 sm:py-16">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white backdrop-blur">✦ Solo strutture verificate</div>
          <h1 className="mt-4 max-w-[16ch] font-serif text-[clamp(30px,5.4vw,52px)] font-bold leading-[1.05] text-white" style={{ textWrap: "balance" }}>Dormi solo dove la qualità è garantita.</h1>
          <p className="mt-3 max-w-[48ch] text-[15px] leading-relaxed text-white/85">La selezione curata di Xenora in Sicilia sud-orientale: case, B&amp;B e dimore verificate per recensioni, accoglienza e regolarità. Niente caos — solo strutture di cui fidarti.</p>
          <div className="mt-6 flex flex-wrap gap-6 text-white">
            {[["128", "strutture verificate"], ["4,8★", "rating medio"], ["7", "città"], ["100%", "check-in a norma"]].map(([n, l]) => (
              <div key={l}><div className="font-serif text-2xl font-bold">{n}</div><div className="text-[12px] text-white/75">{l}</div></div>
            ))}
          </div>
        </div>

        {/* Barra di ricerca sovrapposta (stile OTA) */}
        <div className="relative px-4 pb-4 sm:absolute sm:inset-x-6 sm:-bottom-9 sm:px-0 sm:pb-0">
          <div className="rounded-2xl border border-line bg-surface p-2 shadow-xl">
            <div className="grid gap-2 md:grid-cols-[1.4fr_1fr_1fr_1.1fr_auto]">
              <label className="rounded-xl px-3 py-2 hover:bg-wash">
                <div className="text-[11px] font-bold uppercase tracking-wide text-faint">Destinazione</div>
                <select value={city} onChange={(e) => setCity(e.target.value)} className="w-full bg-transparent text-sm font-semibold text-txt outline-none">
                  {CITIES.map((c) => <option key={c} value={c}>{c === "Tutte" ? "Ovunque in Sicilia SE" : c}</option>)}
                </select>
              </label>
              <label className="rounded-xl px-3 py-2 hover:bg-wash">
                <div className="text-[11px] font-bold uppercase tracking-wide text-faint">Check-in</div>
                <input type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} className="w-full bg-transparent text-sm font-semibold text-txt outline-none" />
              </label>
              <label className="rounded-xl px-3 py-2 hover:bg-wash">
                <div className="text-[11px] font-bold uppercase tracking-wide text-faint">Check-out</div>
                <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-full bg-transparent text-sm font-semibold text-txt outline-none" />
              </label>
              <div className="relative" ref={guestsRef}>
                <button onClick={() => setGuestsOpen((o) => !o)} className="h-full w-full rounded-xl px-3 py-2 text-left hover:bg-wash">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-faint">Ospiti</div>
                  <div className="text-sm font-semibold text-txt">{adults + children} ospiti · {rooms} {rooms > 1 ? "camere" : "camera"}</div>
                </button>
                {guestsOpen && (
                  <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-line bg-surface p-3 shadow-lg">
                    {([["Adulti", adults, setAdults, 1], ["Bambini", children, setChildren, 0], ["Camere", rooms, setRooms, 1]] as const).map(([lbl, val, set, min]) => (
                      <div key={lbl} className="flex items-center justify-between py-1.5">
                        <span className="text-sm text-txt">{lbl}</span>
                        <span className="flex items-center gap-3">
                          <button onClick={() => set(Math.max(min, val - 1))} className="grid h-7 w-7 place-items-center rounded-full border border-line text-dim hover:text-txt">−</button>
                          <span className="w-5 text-center text-sm font-semibold">{val}</span>
                          <button onClick={() => set(val + 1)} className="grid h-7 w-7 place-items-center rounded-full border border-line text-dim hover:text-txt">+</button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => setGuestsOpen(false)} className="flex items-center justify-center gap-2 rounded-xl bg-focus px-5 py-2.5 text-sm font-bold text-white hover:opacity-90"><Icon name="search" size={16} /> Cerca</button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Filtri rapidi (servizi) + tipologia + toggle vista ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <button key={t} onClick={() => toggleType(t)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${types.includes(t) ? "bg-focus text-white" : "border border-line bg-surface text-dim hover:text-txt"}`}>{t}</button>
        ))}
        <button onClick={() => setMoreOpen((o) => !o)} className="whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-txt hover:bg-wash">
          ⚙ Filtri{activeCount ? ` · ${activeCount}` : ""}
        </button>
        <div className="ml-auto inline-flex rounded-lg border border-line bg-surface p-0.5">
          <button onClick={() => setView("lista")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${view === "lista" ? "bg-focus text-white" : "text-dim"}`}>Lista</button>
          <button onClick={() => setView("mappa")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${view === "mappa" ? "bg-focus text-white" : "text-dim"}`}>Mappa</button>
        </div>
      </div>

      {/* ── Pannello filtri avanzati ── */}
      {moreOpen && (
        <Card className="mb-3">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="mb-1 text-[12px] font-bold text-dim">Recensioni</div>
              <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))} className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt">
                <option value={0}>Qualsiasi</option><option value={4.5}>4,5+ ottimo</option><option value={4.7}>4,7+ eccellente</option><option value={4.9}>4,9+ eccezionale</option>
              </select>
            </div>
            <div>
              <div className="mb-1 text-[12px] font-bold text-dim">Stelle struttura</div>
              <select value={starClass} onChange={(e) => setStarClass(Number(e.target.value))} className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt">
                <option value={0}>Qualsiasi</option>{[3, 4, 5].map((s) => <option key={s} value={s}>{s} stelle</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1 text-[12px] font-bold text-dim">Posti letto (min)</div>
              <select value={minBeds} onChange={(e) => setMinBeds(Number(e.target.value))} className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt">
                <option value={0}>Qualsiasi</option>{[1, 2, 3, 4].map((b) => <option key={b} value={b}>{b}+ letti</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1 text-[12px] font-bold text-dim">Disponibilità</div>
              <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-txt">
                <input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} /> Solo disponibili nelle date
              </label>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-[12px] font-bold text-dim">Servizi</div>
            <div className="flex flex-wrap gap-2">
              {AMEN_FILTERS.map((a) => (
                <button key={a} onClick={() => toggleAmen(a)} className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${amen.includes(a) ? "bg-txt text-surface" : "border border-line bg-surface text-dim hover:text-txt"}`}>{a}</button>
              ))}
            </div>
          </div>
          {activeCount > 0 && <button onClick={resetFilters} className="mt-4 text-[13px] font-semibold text-focus hover:underline">Azzera filtri</button>}
        </Card>
      )}

      <div className="mb-3 flex items-baseline justify-between gap-3">
        <SectionTitle>{results.length} strutture verificate</SectionTitle>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] font-semibold text-dim">
          <option value="consigliate">Consigliate</option><option value="prezzo">Prezzo crescente</option><option value="rating">Più votate</option>
        </select>
      </div>

      {/* ── Layout: lista o lista+mappa ── */}
      <div className={view === "mappa" ? "grid gap-4 lg:grid-cols-[1fr_1fr]" : ""}>
        <div className={`grid gap-4 ${view === "mappa" ? "sm:grid-cols-1 xl:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
          {results.map((l) => (
            <article key={l.id} onMouseEnter={() => setHovered(l.id)} onMouseLeave={() => setHovered("")}
              className={`group overflow-hidden rounded-2xl border bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${hovered === l.id ? "border-focus" : "border-line"}`}>
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
                  <div><span className="text-lg font-extrabold text-txt">€{l.price}</span> <span className="text-xs font-semibold text-dim">/ notte · €{l.price * nights} tot.</span></div>
                  <button className="rounded-lg bg-wash px-3 py-1.5 text-[13px] font-bold text-focus hover:bg-focus hover:text-white">Vedi →</button>
                </div>
              </div>
            </article>
          ))}
          {results.length === 0 && <div className="col-span-full rounded-xl border border-line bg-wash px-4 py-10 text-center text-sm text-dim">Nessuna struttura con questi filtri. Prova ad allargare la ricerca.</div>}
        </div>

        {view === "mappa" && (
          <div className="sticky top-4 h-[520px] overflow-hidden rounded-2xl border border-line shadow-sm">
            <MapPanel results={results} hovered={hovered} setHovered={setHovered} />
          </div>
        )}
      </div>

      {/* criteri */}
      <Card className="mt-6">
        <SectionTitle>Cosa significa «Verificata»</SectionTitle>
        <p className="mt-1 text-sm text-dim">Una struttura entra in XenoraBook solo se rispetta — in automatico, ricontrollati ogni mese — tutti questi requisiti.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[["★", "Rating ≥ 4,7", "Media recensioni verificate"], ["✓", "50+ recensioni", "Airbnb, Booking, Xenora"], ["🛡", "Alloggiati 100%", "Check-in a norma da 30+ giorni"], ["€", "Tassa soggiorno", "Versata al 100% (audit auto)"]].map(([ic, tt, ds]) => (
            <div key={tt} className="flex items-start gap-3">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-lg text-sm" style={{ backgroundColor: "#E3F0E7", color: "#3F7A5B" }}>{ic}</span>
              <div><div className="text-[13px] font-bold text-txt">{tt}</div><div className="text-xs text-dim">{ds}</div></div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

// ── Decorazione hero: sole, mare e skyline stilizzati (SVG originale) ──
function HeroDeco() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <circle cx="1010" cy="120" r="72" fill="#fff" opacity="0.14" />
      <circle cx="1010" cy="120" r="46" fill="#fff" opacity="0.16" />
      <g fill="#fff" opacity="0.10">
        <path d="M0 360 q150 -46 300 0 t300 0 t300 0 t300 0 v60 H0 Z" />
      </g>
      <g fill="#fff" opacity="0.07">
        <path d="M0 392 q160 -34 320 0 t320 0 t320 0 t320 0 v40 H0 Z" />
      </g>
      {/* skyline stilizzato (cupole + torre, forma astratta) */}
      <g fill="none" stroke="#fff" strokeOpacity="0.16" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M120 356 v-58 a44 44 0 0 1 88 0 v58" />
        <path d="M188 356 v-34 a20 20 0 0 1 40 0 v34" />
        <path d="M250 356 v-96 l46 -28 v124" />
        <line x1="273" y1="238" x2="273" y2="330" />
      </g>
    </svg>
  );
}

// ── Mappa stilizzata (SVG originale della Sicilia sud-orientale) con pin-prezzo ──
function MapPanel({ results, hovered, setHovered }: { results: Listing[]; hovered: string; setHovered: (id: string) => void }) {
  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
        {/* mare */}
        <defs>
          <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#AECBD6" /><stop offset="1" stopColor="#8FB6C4" /></linearGradient>
          <linearGradient id="land" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E9E2CE" /><stop offset="1" stopColor="#D9CFB4" /></linearGradient>
        </defs>
        <rect width="100" height="100" fill="url(#sea)" />
        {/* terraferma stilizzata (forma astratta, non geografica) */}
        <path d="M-5 8 Q20 6 34 16 Q46 24 44 40 Q42 58 52 70 Q60 80 56 96 L-5 100 Z" fill="url(#land)" stroke="#C9BE9F" strokeWidth="0.6" />
        <path d="M56 96 Q60 80 52 70 Q42 58 44 40 Q46 24 34 16" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="0.5" />
        {/* etichette città */}
        {[["Siracusa", 60, 24], ["Ortigia", 80, 34], ["Noto", 46, 74], ["Ragusa", 20, 60]].map(([n, x, y]) => (
          <text key={n as string} x={x as number} y={y as number} fontSize="2.4" fontWeight="700" fill="#7A6E55" opacity="0.8">{n}</text>
        ))}
        {/* rosa dei venti */}
        <g transform="translate(90,90)" opacity="0.6"><circle r="3.4" fill="none" stroke="#7A6E55" strokeWidth="0.4" /><path d="M0 -3.4 L0.9 0 L0 3.4 L-0.9 0 Z" fill="#BE5D38" /></g>
      </svg>

      {/* pin-prezzo (HTML sovrapposto per interattività) */}
      {results.map((l) => (
        <button key={l.id} onMouseEnter={() => setHovered(l.id)} onMouseLeave={() => setHovered("")}
          className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-[11px] font-bold shadow transition ${hovered === l.id ? "z-20 scale-110 bg-focus text-white" : "z-10 bg-surface text-txt"}`}
          style={{ left: `${l.x}%`, top: `${l.y}%`, border: "1px solid var(--line)" }} title={l.name}>
          €{l.price}
        </button>
      ))}
    </div>
  );
}
