"use client";

// XenoraBook PUBBLICO (fuori dal gestionale): xenora.it/xenorabook — portale a tutta pagina
// come lo vede un ospite dall'esterno. Nessun login, nessuna sidebar.
//
// Catalogo REALE: le strutture mostrate sono SOLO quelle che hanno davvero pubblicato il
// proprio Xenosite (tabella Supabase public_sites), lette da /api/xenorabook/listings.
// Nessun dataset di esempio: se oggi sono pubblicate 1-2 strutture, il portale mostra
// esattamente quelle — niente riempitivo finto per sembrare più popolato.
import { useMemo, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";
import { type Listing, stars, ListingImage } from "@/lib/xenorabook/data";

type Stats = { structures: number; cities: number; reviews: number };

export default function XenoraBookPublicPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [all, setAll] = useState<Listing[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/xenorabook/listings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setAll(Array.isArray(j?.listings) ? j.listings : []);
        setStats(j?.stats && typeof j.stats.structures === "number" ? j.stats : null);
        setStatus(j?.error ? "error" : "ok");
      })
      .catch(() => { if (alive) { setStatus("error"); } });
    return () => { alive = false; };
  }, []);

  const [city, setCity] = useState("Tutte");
  const [amen, setAmen] = useState<string[]>([]);
  const [sort, setSort] = useState<"consigliate" | "prezzo" | "rating">("consigliate");
  const [hovered, setHovered] = useState<string>("");
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [rooms, setRooms] = useState(1);
  const [minRating, setMinRating] = useState(0);
  const [minBeds, setMinBeds] = useState(0);
  const [types, setTypes] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const guestsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (guestsRef.current && !guestsRef.current.contains(e.target as Node)) setGuestsOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  // Vocabolari dei filtri: calcolati dalle strutture REALI caricate, non da liste fisse
  // di esempio — così un filtro compare solo se esiste davvero almeno una struttura a cui si applica.
  const cityOptions = useMemo(() => ["Tutte", ...Array.from(new Set(all.map((l) => l.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, "it"))], [all]);
  const typeOptions = useMemo(() => Array.from(new Set(all.map((l) => l.type).filter(Boolean))).sort((a, b) => a.localeCompare(b, "it")), [all]);
  const amenOptions = useMemo(() => Array.from(new Set(all.flatMap((l) => l.services))).sort((a, b) => a.localeCompare(b, "it")).slice(0, 12), [all]);

  const guestsTot = adults + children;
  const results = useMemo(() => {
    let r = all.filter((l) =>
      (city === "Tutte" || l.city === city) &&
      l.capacity >= guestsTot &&
      amen.every((a) => l.services.includes(a)) &&
      (minRating === 0 || (l.rating != null && l.rating >= minRating)) &&
      l.beds >= minBeds &&
      (types.length === 0 || types.includes(l.type))
    );
    if (sort === "prezzo") r = [...r].sort((a, b) => (a.priceFrom ?? Infinity) - (b.priceFrom ?? Infinity));
    else if (sort === "rating") r = [...r].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    else r = [...r].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (a.priceFrom ?? Infinity) - (b.priceFrom ?? Infinity));
    return r;
  }, [all, city, guestsTot, amen, sort, minRating, minBeds, types]);
  const activeCount = (minRating ? 1 : 0) + (minBeds ? 1 : 0) + types.length;

  const go = (slug: string) => router.push(`/xenorabook/${slug}?from=${from}&to=${to}&adults=${adults}&children=${children}`);
  const toggleAmen = (a: string) => setAmen((p) => p.includes(a) ? p.filter((x) => x !== a) : [...p, a]);
  const toggleType = (t: string) => setTypes((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t]);
  const resetFilters = () => { setMinRating(0); setMinBeds(0); setTypes([]); setAmen([]); };
  const nights = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) || 1);

  // Statistiche hero: SOLO quelle che possiamo calcolare onestamente dai dati reali.
  // Niente rating medio inventato, niente "% check-in a norma": con 1-2 strutture pubblicate
  // un aggregato del genere non sarebbe rappresentativo, quindi la statistica è omessa del tutto.
  const heroStats = useMemo(() => {
    const out: [string, string][] = [];
    if (!stats) return out;
    out.push([String(stats.structures), stats.structures === 1 ? "struttura pubblicata" : "strutture pubblicate"]);
    if (stats.cities > 0) out.push([String(stats.cities), stats.cities === 1 ? "città" : "città"]);
    if (stats.reviews > 0) out.push([String(stats.reviews), stats.reviews === 1 ? "recensione reale" : "recensioni reali"]);
    return out;
  }, [stats]);

  return (
    <div className="min-h-screen bg-wash">
      {/* Barra pubblica */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link href="/xenorabook" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/xenora-mark.png" alt="Xenora" width={26} height={26} style={{ width: 26, height: 26, objectFit: "contain" }} />
            <span className="font-display text-lg font-bold text-txt">XenoraBook</span>
          </Link>
          <a href="https://xenora.it" className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-txt hover:bg-wash">Sei una struttura? Accedi</a>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
      {/* ── HERO d'impatto ── */}
      <section className="relative overflow-hidden rounded-3xl" style={{ background: "linear-gradient(135deg,#1E3A46 0%,#2E5B63 42%,#BE5D38 100%)" }}>
        <HeroDeco />
        <div className="relative px-6 py-12 sm:px-10 sm:pt-16 sm:pb-24">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white backdrop-blur">✦ Le strutture Xenora</div>
          <h1 className="mt-4 max-w-[16ch] font-serif text-[clamp(30px,5.4vw,52px)] font-bold leading-[1.05] text-white" style={{ textWrap: "balance" }}>Dormi dove il gestore usa Xenora.</h1>
          <p className="mt-3 max-w-[48ch] text-[15px] leading-relaxed text-white/85">La vetrina delle strutture — case, B&amp;B e dimore — che hanno pubblicato il proprio Xenosite in Sicilia sud-orientale. Dati reali: nomi, foto e prezzi aggiornati direttamente dal gestore.</p>
          {heroStats.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-6 text-white">
              {heroStats.map(([n, l]) => (
                <div key={l}><div className="font-serif text-2xl font-bold">{n}</div><div className="text-[12px] text-white/75">{l}</div></div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Barra di ricerca */}
      <div className="relative z-10 mb-5 -mt-7 px-2 sm:-mt-16 sm:px-6">
        <div className="rounded-2xl border border-line bg-surface p-2 shadow-xl">
            <div className="grid gap-2 md:grid-cols-[1.4fr_1fr_1fr_1.1fr_auto]">
              <label className="rounded-xl px-3 py-2 hover:bg-wash">
                <div className="text-[11px] font-bold uppercase tracking-wide text-faint">Destinazione</div>
                <select value={city} onChange={(e) => setCity(e.target.value)} className="w-full bg-transparent text-sm font-semibold text-txt outline-none">
                  {cityOptions.map((c) => <option key={c} value={c}>{c === "Tutte" ? "Ovunque in Sicilia SE" : c}</option>)}
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

      {/* Filtri rapidi */}
      {typeOptions.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {typeOptions.map((t) => (
            <button key={t} onClick={() => toggleType(t)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${types.includes(t) ? "bg-focus text-white" : "border border-line bg-surface text-dim hover:text-txt"}`}>{t}</button>
          ))}
          <button onClick={() => setMoreOpen((o) => !o)} className="whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-txt hover:bg-wash">⚙ Filtri{activeCount ? ` · ${activeCount}` : ""}</button>
        </div>
      )}

      {moreOpen && (
        <Card className="mb-3">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <div className="mb-1 text-[12px] font-bold text-dim">Recensioni</div>
              <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))} className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt">
                <option value={0}>Qualsiasi</option><option value={4}>4+ molto bene</option><option value={4.5}>4,5+ eccellente</option>
              </select>
            </div>
            <div>
              <div className="mb-1 text-[12px] font-bold text-dim">Posti letto (min)</div>
              <select value={minBeds} onChange={(e) => setMinBeds(Number(e.target.value))} className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt">
                <option value={0}>Qualsiasi</option>{[1, 2, 3, 4].map((b) => <option key={b} value={b}>{b}+ letti</option>)}
              </select>
            </div>
          </div>
          {amenOptions.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-[12px] font-bold text-dim">Servizi</div>
              <div className="flex flex-wrap gap-2">
                {amenOptions.map((a) => (
                  <button key={a} onClick={() => toggleAmen(a)} className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${amen.includes(a) ? "bg-txt text-surface" : "border border-line bg-surface text-dim hover:text-txt"}`}>{a}</button>
                ))}
              </div>
            </div>
          )}
          {activeCount > 0 && <button onClick={resetFilters} className="mt-4 text-[13px] font-semibold text-focus hover:underline">Azzera filtri</button>}
        </Card>
      )}

      <div className="mb-3 flex items-baseline justify-between gap-3">
        <SectionTitle>{status === "loading" ? "Carico le strutture…" : `${results.length} strutture su Xenora`}</SectionTitle>
        {all.length > 0 && (
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] font-semibold text-dim">
            <option value="consigliate">Consigliate</option><option value="prezzo">Prezzo crescente</option><option value="rating">Più votate</option>
          </select>
        )}
      </div>

      {status === "loading" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-64 animate-pulse rounded-2xl border border-line bg-wash" />)}
        </div>
      )}

      {status === "error" && (
        <div className="rounded-xl border border-line bg-wash px-4 py-10 text-center text-sm text-dim">Catalogo momentaneamente non disponibile. Riprova tra poco.</div>
      )}

      {status === "ok" && all.length === 0 && (
        <div className="rounded-xl border border-line bg-wash px-4 py-14 text-center">
          <div className="text-sm font-semibold text-txt">Ancora nessuna struttura pubblicata.</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-dim">Le strutture che pubblicano il proprio Xenosite compaiono qui automaticamente. Torna a trovarci presto.</p>
        </div>
      )}

      {status === "ok" && all.length > 0 && (
        <div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((l) => (
              <article key={l.slug} onMouseEnter={() => setHovered(l.slug)} onMouseLeave={() => setHovered("")} onClick={() => go(l.slug)}
                className={`group cursor-pointer overflow-hidden rounded-2xl border bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${hovered === l.slug ? "border-focus" : "border-line"}`}>
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-wash">
                  <ListingImage src={l.images[0]} hue={l.hue} initial={l.name[0] || "X"} />
                  <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-white shadow" style={{ backgroundColor: "#3F7A5B" }}>Su Xenora</span>
                </div>
                <div className="flex flex-col gap-1.5 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-[17px] font-bold text-txt">{l.name}</div>
                    {l.rating != null ? (
                      <div className="flex items-center gap-1 whitespace-nowrap text-[13px] font-bold text-txt"><span style={{ color: "#D99A2B" }}>★</span>{l.rating.toFixed(1)} <span className="font-semibold text-faint">({l.reviews})</span></div>
                    ) : (
                      <div className="whitespace-nowrap text-[12px] font-semibold text-faint">Nuova su Xenora</div>
                    )}
                  </div>
                  <div className="text-[13px] text-dim">📍 {l.area}</div>
                  {l.rating != null && <div className="text-[12px]" style={{ color: "#D99A2B" }}>{stars(l.rating)}</div>}
                  {l.services.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">{l.services.slice(0, 4).map((a) => <span key={a} className="rounded-md border border-line bg-wash px-2 py-0.5 text-[11px] text-dim">{a}</span>)}</div>}
                  <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2.5">
                    <div>{l.priceFrom != null ? (<><span className="text-lg font-extrabold text-txt">€{l.priceFrom}</span> <span className="text-xs font-semibold text-dim">/ notte · €{l.priceFrom * nights} tot.</span></>) : <span className="text-xs font-semibold text-dim">Prezzo su richiesta</span>}</div>
                    <button onClick={(e) => { e.stopPropagation(); go(l.slug); }} className="rounded-lg bg-wash px-3 py-1.5 text-[13px] font-bold text-focus hover:bg-focus hover:text-white">Vedi camere →</button>
                  </div>
                </div>
              </article>
            ))}
            {results.length === 0 && <div className="col-span-full rounded-xl border border-line bg-wash px-4 py-10 text-center text-sm text-dim">Nessuna struttura con questi filtri. Prova ad allargare la ricerca.</div>}
          </div>
        </div>
      )}

      <Card className="mt-6">
        <SectionTitle>Come selezioniamo le strutture</SectionTitle>
        <p className="mt-1 text-sm text-dim">Oggi XenoraBook mostra le strutture che hanno pubblicato il proprio Xenosite: significa che il gestore usa Xenora per gestire camere, tariffe e prenotazioni — non ancora un controllo di qualità automatico. Questi sono i criteri che stiamo costruendo per un vero badge «Verificata»:</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[["★", "Rating ≥ 4,7", "In arrivo — media recensioni reali"], ["✓", "50+ recensioni", "In arrivo — Google e dirette"], ["🛡", "Alloggiati a norma", "In arrivo — stato check-in Questura"], ["€", "Tassa di soggiorno", "In arrivo — audit versamenti"]].map(([ic, tt, ds]) => (
            <div key={tt} className="flex items-start gap-3">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-lg text-sm" style={{ backgroundColor: "#E3F0E7", color: "#3F7A5B" }}>{ic}</span>
              <div><div className="text-[13px] font-bold text-txt">{tt}</div><div className="text-xs text-dim">{ds}</div></div>
            </div>
          ))}
        </div>
      </Card>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-6 text-center text-xs text-faint">XenoraBook · Digital Solution — le strutture che usano Xenora. <a href="https://xenora.it" className="text-focus hover:underline">Gestisci la tua struttura con Xenora</a></div>
      </footer>
    </div>
  );
}

function HeroDeco() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <circle cx="1010" cy="120" r="72" fill="#fff" opacity="0.14" />
      <circle cx="1010" cy="120" r="46" fill="#fff" opacity="0.16" />
      <g fill="#fff" opacity="0.10"><path d="M0 360 q150 -46 300 0 t300 0 t300 0 t300 0 v60 H0 Z" /></g>
      <g fill="#fff" opacity="0.07"><path d="M0 392 q160 -34 320 0 t320 0 t320 0 t320 0 v40 H0 Z" /></g>
      <g fill="none" stroke="#fff" strokeOpacity="0.16" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M120 356 v-58 a44 44 0 0 1 88 0 v58" />
        <path d="M188 356 v-34 a20 20 0 0 1 40 0 v34" />
        <path d="M250 356 v-96 l46 -28 v124" />
        <line x1="273" y1="238" x2="273" y2="330" />
      </g>
    </svg>
  );
}
