"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";
import { type Listing, type StructType, SAMPLES, CITIES, AMEN_FILTERS, TYPES, stars, StructImg, mineListings } from "@/lib/xenorabook/data";

// Home del portale XenoraBook. `structures` = strutture reali del proprietario (vuoto
// nella versione pubblica esterna); `basePath` = "/xenorabook" (in-app) o "/portale" (pubblico).
export default function PortalHome({ structures = [], basePath = "/xenorabook" }: { structures?: { id: string; name?: string }[]; basePath?: string }) {
  const router = useRouter();
  const [city, setCity] = useState("Tutte");
  const [amen, setAmen] = useState<string[]>([]);
  const [sort, setSort] = useState<"consigliate" | "prezzo" | "rating">("consigliate");
  const [view, setView] = useState<"lista" | "mappa">("lista");
  const [hovered, setHovered] = useState<string>("");
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [rooms, setRooms] = useState(1);
  const [minRating, setMinRating] = useState(0);
  const [starClass, setStarClass] = useState(0);
  const [minBeds, setMinBeds] = useState(0);
  const [types, setTypes] = useState<StructType[]>([]);
  const [onlyAvail, setOnlyAvail] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const guestsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (guestsRef.current && !guestsRef.current.contains(e.target as Node)) setGuestsOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  const all: Listing[] = useMemo(() => [...mineListings(structures), ...SAMPLES], [structures]);
  const guestsTot = adults + children;
  const results = useMemo(() => {
    let r = all.filter((l) =>
      (city === "Tutte" || l.city === city) && l.capacity >= guestsTot && amen.every((a) => l.amen.includes(a)) &&
      l.rating >= minRating && (starClass === 0 || l.starClass === starClass) && l.beds >= minBeds &&
      (types.length === 0 || types.includes(l.type)) && (!onlyAvail || l.available)
    );
    if (sort === "prezzo") r = [...r].sort((a, b) => a.price - b.price);
    else if (sort === "rating") r = [...r].sort((a, b) => b.rating - a.rating);
    else r = [...r].sort((a, b) => Number(b.mine) - Number(a.mine) || b.rating - a.rating);
    return r;
  }, [all, city, guestsTot, amen, sort, minRating, starClass, minBeds, types, onlyAvail]);
  const activeCount = (minRating ? 1 : 0) + (starClass ? 1 : 0) + (minBeds ? 1 : 0) + types.length + (onlyAvail ? 1 : 0);

  const go = (id: string) => router.push(`${basePath}/${id}?from=${from}&to=${to}&adults=${adults}&children=${children}`);
  const toggleAmen = (a: string) => setAmen((p) => p.includes(a) ? p.filter((x) => x !== a) : [...p, a]);
  const toggleType = (t: StructType) => setTypes((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t]);
  const resetFilters = () => { setMinRating(0); setStarClass(0); setMinBeds(0); setTypes([]); setOnlyAvail(false); setAmen([]); };
  const nights = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) || 1);

  return (
    <>
      <section className="relative overflow-hidden rounded-3xl" style={{ background: "linear-gradient(135deg,#1E3A46 0%,#2E5B63 42%,#BE5D38 100%)" }}>
        <HeroDeco />
        <div className="relative px-6 py-12 sm:px-10 sm:pt-16 sm:pb-24">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white backdrop-blur">✦ Solo strutture verificate</div>
          <h1 className="mt-4 max-w-[16ch] font-serif text-[clamp(30px,5.4vw,52px)] font-bold leading-[1.05] text-white" style={{ textWrap: "balance" }}>Dormi solo dove la qualità è garantita.</h1>
          <p className="mt-3 max-w-[48ch] text-[15px] leading-relaxed text-white/85">La selezione curata di Xenora in Sicilia sud-orientale: case, B&amp;B e dimore verificate per recensioni, accoglienza e regolarità. Niente caos — solo strutture di cui fidarti.</p>
          <div className="mt-6 flex flex-wrap gap-6 text-white">
            {[["128", "strutture verificate"], ["4,8★", "rating medio"], ["7", "città"], ["100%", "check-in a norma"]].map(([n, l]) => (
              <div key={l}><div className="font-serif text-2xl font-bold">{n}</div><div className="text-[12px] text-white/75">{l}</div></div>
            ))}
          </div>
        </div>
      </section>

      <div className="relative z-10 mb-5 -mt-7 px-2 sm:-mt-16 sm:px-6">
        <div className="rounded-2xl border border-line bg-surface p-2 shadow-xl">
          <div className="grid gap-2 md:grid-cols-[1.4fr_1fr_1fr_1.1fr_auto]">
            <label className="rounded-xl px-3 py-2 hover:bg-wash">
              <div className="text-[11px] font-bold uppercase tracking-wide text-faint">Destinazione</div>
              <select value={city} onChange={(e) => setCity(e.target.value)} className="w-full bg-transparent text-sm font-semibold text-txt outline-none">
                {CITIES.map((cc) => <option key={cc} value={cc}>{cc === "Tutte" ? "Ovunque in Sicilia SE" : cc}</option>)}
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

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <button key={t} onClick={() => toggleType(t)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${types.includes(t) ? "bg-focus text-white" : "border border-line bg-surface text-dim hover:text-txt"}`}>{t}</button>
        ))}
        <button onClick={() => setMoreOpen((o) => !o)} className="whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-txt hover:bg-wash">⚙ Filtri{activeCount ? ` · ${activeCount}` : ""}</button>
        <div className="ml-auto inline-flex rounded-lg border border-line bg-surface p-0.5">
          <button onClick={() => setView("lista")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${view === "lista" ? "bg-focus text-white" : "text-dim"}`}>Lista</button>
          <button onClick={() => setView("mappa")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${view === "mappa" ? "bg-focus text-white" : "text-dim"}`}>Mappa</button>
        </div>
      </div>

      {moreOpen && (
        <Card className="mb-3">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><div className="mb-1 text-[12px] font-bold text-dim">Recensioni</div>
              <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))} className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt">
                <option value={0}>Qualsiasi</option><option value={4.5}>4,5+ ottimo</option><option value={4.7}>4,7+ eccellente</option><option value={4.9}>4,9+ eccezionale</option>
              </select></div>
            <div><div className="mb-1 text-[12px] font-bold text-dim">Stelle struttura</div>
              <select value={starClass} onChange={(e) => setStarClass(Number(e.target.value))} className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt">
                <option value={0}>Qualsiasi</option>{[3, 4, 5].map((s) => <option key={s} value={s}>{s} stelle</option>)}
              </select></div>
            <div><div className="mb-1 text-[12px] font-bold text-dim">Posti letto (min)</div>
              <select value={minBeds} onChange={(e) => setMinBeds(Number(e.target.value))} className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt">
                <option value={0}>Qualsiasi</option>{[1, 2, 3, 4].map((b) => <option key={b} value={b}>{b}+ letti</option>)}
              </select></div>
            <div><div className="mb-1 text-[12px] font-bold text-dim">Disponibilità</div>
              <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-txt"><input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} /> Solo disponibili nelle date</label></div>
          </div>
          <div className="mt-4"><div className="mb-1.5 text-[12px] font-bold text-dim">Servizi</div>
            <div className="flex flex-wrap gap-2">
              {AMEN_FILTERS.map((a) => <button key={a} onClick={() => toggleAmen(a)} className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${amen.includes(a) ? "bg-txt text-surface" : "border border-line bg-surface text-dim hover:text-txt"}`}>{a}</button>)}
            </div></div>
          {activeCount > 0 && <button onClick={resetFilters} className="mt-4 text-[13px] font-semibold text-focus hover:underline">Azzera filtri</button>}
        </Card>
      )}

      <div className="mb-3 flex items-baseline justify-between gap-3">
        <SectionTitle>{results.length} strutture verificate</SectionTitle>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] font-semibold text-dim">
          <option value="consigliate">Consigliate</option><option value="prezzo">Prezzo crescente</option><option value="rating">Più votate</option>
        </select>
      </div>

      <div className={view === "mappa" ? "grid gap-4 lg:grid-cols-[1fr_1fr]" : ""}>
        <div className={`grid gap-4 ${view === "mappa" ? "sm:grid-cols-1 xl:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
          {results.map((l) => (
            <article key={l.id} onMouseEnter={() => setHovered(l.id)} onMouseLeave={() => setHovered("")} onClick={() => go(l.id)}
              className={`group cursor-pointer overflow-hidden rounded-2xl border bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${hovered === l.id ? "border-focus" : "border-line"}`}>
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
                  <button onClick={(e) => { e.stopPropagation(); go(l.id); }} className="rounded-lg bg-wash px-3 py-1.5 text-[13px] font-bold text-focus hover:bg-focus hover:text-white">Vedi camere →</button>
                </div>
              </div>
            </article>
          ))}
          {results.length === 0 && <div className="col-span-full rounded-xl border border-line bg-wash px-4 py-10 text-center text-sm text-dim">Nessuna struttura con questi filtri. Prova ad allargare la ricerca.</div>}
        </div>
        {view === "mappa" && (
          <div className="sticky top-4 h-[520px] overflow-hidden rounded-2xl border border-line shadow-sm"><MapPanel results={results} hovered={hovered} setHovered={setHovered} /></div>
        )}
      </div>

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

function HeroDeco() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <circle cx="1010" cy="120" r="72" fill="#fff" opacity="0.14" /><circle cx="1010" cy="120" r="46" fill="#fff" opacity="0.16" />
      <g fill="#fff" opacity="0.10"><path d="M0 360 q150 -46 300 0 t300 0 t300 0 t300 0 v60 H0 Z" /></g>
      <g fill="#fff" opacity="0.07"><path d="M0 392 q160 -34 320 0 t320 0 t320 0 t320 0 v40 H0 Z" /></g>
      <g fill="none" stroke="#fff" strokeOpacity="0.16" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M120 356 v-58 a44 44 0 0 1 88 0 v58" /><path d="M188 356 v-34 a20 20 0 0 1 40 0 v34" />
        <path d="M250 356 v-96 l46 -28 v124" /><line x1="273" y1="238" x2="273" y2="330" />
      </g>
    </svg>
  );
}

function MapPanel({ results, hovered, setHovered }: { results: Listing[]; hovered: string; setHovered: (id: string) => void }) {
  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
        <defs>
          <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#AECBD6" /><stop offset="1" stopColor="#8FB6C4" /></linearGradient>
          <linearGradient id="land" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E9E2CE" /><stop offset="1" stopColor="#D9CFB4" /></linearGradient>
        </defs>
        <rect width="100" height="100" fill="url(#sea)" />
        <path d="M-5 8 Q20 6 34 16 Q46 24 44 40 Q42 58 52 70 Q60 80 56 96 L-5 100 Z" fill="url(#land)" stroke="#C9BE9F" strokeWidth="0.6" />
        <path d="M56 96 Q60 80 52 70 Q42 58 44 40 Q46 24 34 16" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="0.5" />
        {[["Siracusa", 60, 24], ["Ortigia", 80, 34], ["Noto", 46, 74], ["Ragusa", 20, 60]].map(([n, x, y]) => (
          <text key={n as string} x={x as number} y={y as number} fontSize="2.4" fontWeight="700" fill="#7A6E55" opacity="0.8">{n}</text>
        ))}
        <g transform="translate(90,90)" opacity="0.6"><circle r="3.4" fill="none" stroke="#7A6E55" strokeWidth="0.4" /><path d="M0 -3.4 L0.9 0 L0 3.4 L-0.9 0 Z" fill="#BE5D38" /></g>
      </svg>
      {results.map((l) => (
        <button key={l.id} onMouseEnter={() => setHovered(l.id)} onMouseLeave={() => setHovered("")}
          className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-[11px] font-bold shadow transition ${hovered === l.id ? "z-20 scale-110 bg-focus text-white" : "z-10 bg-surface text-txt"}`}
          style={{ left: `${l.x}%`, top: `${l.y}%`, border: "1px solid var(--line)" }} title={l.name}>€{l.price}</button>
      ))}
    </div>
  );
}
