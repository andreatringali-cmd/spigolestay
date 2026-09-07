"use client";

import { useEffect, useMemo, useState } from "react";
import { DataProvider, useData } from "@/lib/store";
import type { RoomType } from "@/lib/types";
import { effectiveBase } from "@/lib/pricing";
import { getImages } from "@/lib/images";
import { loadPromos } from "@/lib/promos";
import { eur } from "@/lib/format";

const toISO = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return toISO(d); };

interface Cfg { nome: string; tagline: string; accent: string; heroBg?: string; googleUrl?: string; hero: boolean; camere: boolean; recensioni: boolean; mappa: boolean; contatti: boolean }
const DEFCFG: Cfg = { nome: "", tagline: "Il tuo soggiorno nel cuore di Ortigia", accent: "#4F46E5", heroBg: "", googleUrl: "", hero: true, camere: true, recensioni: true, mappa: true, contatti: true };


export default function SitoWebPage() {
  return <DataProvider><Site /></DataProvider>;
}

function Site() {
  const { structures, roomTypes, units, bookings, getStructure, getGuest, addGuest } = useData();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null);
  const [nl, setNl] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [nlDone, setNlDone] = useState(false);
  const nlSubmit = () => {
    if (!nl.email.trim() || (!nl.firstName.trim() && !nl.lastName.trim())) return;
    addGuest({ firstName: nl.firstName.trim() || undefined, lastName: nl.lastName.trim() || undefined, email: nl.email.trim() || undefined, phone: nl.phone.trim() || undefined });
    setNlDone(true); setNl({ firstName: "", lastName: "", email: "", phone: "" });
  };
  const cfg = useMemo<Cfg>(() => { try { const r = localStorage.getItem("spigolestay:sito"); if (r) return { ...DEFCFG, ...JSON.parse(r) }; } catch {} return DEFCFG; }, []);
  const [sid, setSid] = useState(() => { try { return new URLSearchParams(window.location.search).get("s") || structures[0]?.id || ""; } catch { return structures[0]?.id ?? ""; } });
  // Lo store carica i dati dopo il mount: aggancia la prima struttura appena disponibile.
  useEffect(() => { if ((!sid || !structures.some((s) => s.id === sid)) && structures[0]) setSid(structures[0].id); }, [structures, sid]);
  const structure = getStructure(sid);
  const name = structure?.name || cfg.nome || "Xenora";
  const accent = cfg.accent;

  // Meteo (Open-Meteo, gratuito e senza chiave): coordinate struttura o Siracusa.
  const wLat = structure?.lat ?? 37.0755, wLng = structure?.lng ?? 15.2866;
  useEffect(() => {
    let ok = true;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${wLat}&longitude=${wLng}&current=temperature_2m,weather_code&timezone=Europe%2FRome`)
      .then((r) => r.json()).then((d) => { if (ok && d?.current) setWeather({ temp: Math.round(d.current.temperature_2m), code: d.current.weather_code }); }).catch(() => {});
    return () => { ok = false; };
  }, [wLat, wLng]);
  const wIcon = (c: number) => c === 0 ? "☀️" : c <= 3 ? "⛅" : c <= 48 ? "🌫️" : c <= 67 ? "🌧️" : c <= 77 ? "❄️" : c <= 82 ? "🌦️" : "⛈️";

  const today = toISO(new Date());
  const [ci, setCi] = useState(addDays(today, 7));
  const [co, setCo] = useState(addDays(today, 8));
  const [ad, setAd] = useState(2);
  const [ch, setCh] = useState(0);
  const [childAges, setChildAges] = useState<number[]>([]);
  const setChN = (n: number) => { setCh(n); setChildAges((prev) => { const next = prev.slice(0, n); while (next.length < n) next.push(8); return next; }); };

  const types = roomTypes.filter((rt) => rt.structureId === sid);
  const go = (extra = "") => { window.location.href = `/prenota?s=${sid}&ci=${ci}&co=${co}&ad=${ad}&ch=${ch}${ch > 0 ? `&ages=${childAges.join(",")}` : ""}${extra}`; };

  // Galleria: foto delle tipologie + foto delle singole camere della struttura.
  const gallery = useMemo(() => {
    const imgs: string[] = [];
    types.forEach((rt) => getImages(`rt:${rt.id}`).forEach((u) => imgs.push(u)));
    units.filter((u) => u.structureId === sid).forEach((u) => (u.photos ?? []).forEach((p) => imgs.push(p)));
    return Array.from(new Set(imgs)).slice(0, 12);
  }, [types, units, sid]);

  // Offerte attive (modulo Promozioni).
  const offers = useMemo(() => { try { return loadPromos().filter((p) => p.discountPct && p.code); } catch { return []; } }, []);

  // Recensioni reali: dagli ospiti passati (come il modulo Recensioni).
  const reviews = useMemo(() => {
    const TXT = ["Soggiorno perfetto, posizione ottima e host gentilissimo.", "Camera pulita e silenziosa, torneremo di sicuro.", "Accoglienza calorosa e tutto come descritto.", "Colazione ottima e consigli preziosi sulla città.", "Struttura curata nei dettagli, esperienza top."];
    const R = [10, 9, 10, 9, 8, 10, 9, 10];
    return bookings
      .filter((b) => b.structureId === sid && b.checkOut < today && b.status !== "cancelled" && b.channel !== "blocked")
      .sort((a, b) => b.checkOut.localeCompare(a.checkOut)).slice(0, 6)
      .map((b, i) => ({ id: b.id, name: (getGuest(b.guestId)?.fullName || "Ospite").split(" ")[0], date: b.checkOut, rating: R[i % R.length], text: TXT[i % TXT.length] }));
  }, [bookings, sid, today, getGuest]);
  const reviewsAvg = reviews.length ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) : 0;

  const field = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  return (
    <div className="min-h-full bg-wash pb-20">
      {/* Top bar */}
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg text-sm font-bold text-white" style={{ backgroundColor: structure?.photoColor ?? accent }}>{structure?.logo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={structure.logo} alt="" className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase()}</div>
          <div className="text-sm font-bold text-txt">{name}<span className="ml-1 text-[11px] font-normal text-faint">· Xenorabook</span></div>
          <div className="ml-auto flex items-center gap-3 text-xs text-dim">
            {weather && <span className="flex items-center gap-1 rounded-full bg-wash px-2 py-1 font-medium" title={`Meteo ${structure?.city ?? "Siracusa"}`}>{wIcon(weather.code)} {weather.temp}° · {structure?.city ?? "Siracusa"}</span>}
            {structure?.phone && <span>{structure.phone}</span>}
            {structures.length > 1 && <select value={sid} onChange={(e) => setSid(e.target.value)} className="rounded-lg border border-line bg-paper px-2 py-1 text-xs">{structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          </div>
        </div>
      </div>

      {/* Hero + ricerca */}
      {cfg.hero && (
        <div className="relative overflow-hidden px-4 py-14 text-white" style={{ background: cfg.heroBg ? `linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)), url(${cfg.heroBg}) center/cover no-repeat` : `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 45%, #000))` }}>
          <div className="mx-auto max-w-5xl">
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{name}</h1>
            <p className="mt-2 max-w-xl text-white/90">{cfg.tagline}</p>
            <div className="mt-6 grid w-full gap-2 rounded-2xl bg-white/95 p-3 shadow-lg sm:grid-cols-5">
              <label className="block text-[11px] font-medium text-dim">Arrivo<input type="date" value={ci} min={today} onChange={(e) => { setCi(e.target.value); if (e.target.value >= co) setCo(addDays(e.target.value, 1)); }} className={`${field} mt-0.5 w-full`} /></label>
              <label className="block text-[11px] font-medium text-dim">Partenza<input type="date" value={co} min={addDays(ci, 1)} onChange={(e) => setCo(e.target.value)} className={`${field} mt-0.5 w-full`} /></label>
              <label className="block text-[11px] font-medium text-dim">Adulti<input type="number" min={1} value={ad} onChange={(e) => setAd(Math.max(1, +e.target.value))} className={`${field} mt-0.5 w-full`} /></label>
              <label className="block text-[11px] font-medium text-dim">Bambini<input type="number" min={0} value={ch} onChange={(e) => setChN(Math.max(0, +e.target.value))} className={`${field} mt-0.5 w-full`} /></label>
              <button onClick={() => go()} className="mt-auto rounded-lg py-2 text-sm font-semibold text-white" style={{ backgroundColor: accent }}>Verifica disponibilità</button>
            </div>
            {ch > 0 && (
              <div className="mt-2 w-full rounded-2xl bg-white/95 p-3 shadow-lg">
                <div className="mb-1 text-[11px] font-medium text-dim">Età dei bambini <span className="text-faint">(per la tassa di soggiorno e la sistemazione)</span></div>
                <div className="flex flex-wrap gap-2">
                  {childAges.map((age, i) => (
                    <label key={i} className="flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs text-dim">Bimbo {i + 1}
                      <input type="number" min={0} max={17} value={age} onChange={(e) => setChildAges((prev) => prev.map((a, j) => (j === i ? Math.max(0, Math.min(17, +e.target.value)) : a)))} className="w-14 rounded border border-line bg-surface px-1.5 py-0.5 text-sm text-txt outline-none focus:border-focus" />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-5xl px-4">
        {/* Chi siamo */}
        {structure?.description && (
          <section className="mt-10">
            <h2 className="mb-3 font-display text-xl font-bold text-txt">Chi siamo</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-dim">{structure.description}</p>
          </section>
        )}

        {/* Camere */}
        {cfg.camere && (
          <section className="mt-10">
            <h2 className="mb-3 font-display text-xl font-bold text-txt">Le nostre camere</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {types.map((rt) => (
                <button key={rt.id} onClick={() => go()} className="group overflow-hidden rounded-xl border border-line bg-surface text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  {(() => { const cover = getImages(`rt:${rt.id}`)[0]; return cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt={rt.name} className="h-32 w-full object-cover" />
                  ) : (
                    <div className="grid h-32 place-items-center" style={{ background: `linear-gradient(135deg, ${rt.color ?? accent}, color-mix(in srgb, ${rt.color ?? accent} 55%, #000))` }}>
                      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.6" opacity="0.9"><path d="M3 8v11" /><path d="M3 13h18v6" /><path d="M21 19v-4a3 3 0 0 0-3-3h-7v4" /><circle cx="7" cy="11.5" r="1.4" /></svg>
                    </div>
                  ); })()}
                  <div className="p-3">
                    <div className="flex items-center justify-between"><span className="font-semibold text-txt">{rt.name}</span><span className="font-mono text-sm font-bold text-txt">da {eur(effectiveBase(rt, roomTypes))}</span></div>
                    <div className="mt-0.5 text-xs text-dim">{rt.beds} letti · fino a {rt.maxOccupancy ?? rt.beds} ospiti{rt.size ? ` · ${rt.size} m²` : ""}{rt.bedConfig ? ` · ${rt.bedConfig}` : ""}</div>
                    {(rt.amenities ?? []).length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{(rt.amenities ?? []).slice(0, 3).map((a) => <span key={a} className="rounded-full bg-wash px-2 py-0.5 text-[10px] text-dim">{a}</span>)}</div>}
                    <div className="mt-2 text-xs font-medium" style={{ color: accent }}>Prenota →</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Servizi struttura */}
        {(structure?.services ?? []).length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 font-display text-xl font-bold text-txt">Servizi</h2>
            <div className="flex flex-wrap gap-2">{(structure?.services ?? []).map((s) => <span key={s} className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-dim">{s}</span>)}</div>
          </section>
        )}

        {/* Informazioni utili */}
        {structure && (() => {
          const polLabel: Record<string, string> = { flessibile: "Cancellazione flessibile", moderata: "Cancellazione moderata", rigida: "Cancellazione rigida" };
          const tax = structure.cityTax ? (structure.cityTaxMode === "percent" ? `${structure.cityTaxPercent ?? 0}% del soggiorno` : `${structure.cityTaxAmount ?? 2} € a persona/notte`) : "";
          const cards = ([
            structure.checkInFrom ? ["Check-in", `dalle ${structure.checkInFrom}${structure.checkInTo ? ` alle ${structure.checkInTo}` : ""}`] : ["", ""],
            structure.checkOutBy ? ["Check-out", `entro le ${structure.checkOutBy}`] : ["", ""],
            tax ? ["Tassa di soggiorno", tax] : ["", ""],
            structure.cancelPolicy ? ["Cancellazione", polLabel[structure.cancelPolicy] ?? ""] : ["", ""],
            typeof structure.pets === "boolean" ? ["Animali", structure.pets ? "Ammessi" : "Non ammessi"] : ["", ""],
            typeof structure.smoking === "boolean" ? ["Fumatori", structure.smoking ? "Consentito" : "Vietato fumare"] : ["", ""],
            structure.minAge ? ["Età minima check-in", `${structure.minAge} anni`] : ["", ""],
            structure.cin ? ["CIN", structure.cin] : ["", ""],
          ] as [string, string][]).filter(([l]) => l);
          if (!cards.length) return null;
          return (
            <section className="mt-10">
              <h2 className="mb-3 font-display text-xl font-bold text-txt">Informazioni utili</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {cards.map(([l, v]) => (
                  <div key={l} className="rounded-xl border border-line bg-surface p-3">
                    <div className="text-[11px] uppercase tracking-wide text-faint">{l}</div>
                    <div className="mt-0.5 text-sm font-medium text-txt">{v}</div>
                  </div>
                ))}
              </div>
            </section>
          );
        })()}

        {/* Galleria foto */}
        {gallery.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 font-display text-xl font-bold text-txt">Galleria</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {gallery.map((src, i) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <button key={i} onClick={() => setLightbox(src)} className="group overflow-hidden rounded-xl border border-line"><img src={src} alt="" className="h-32 w-full object-cover transition group-hover:scale-105" /></button>
              ))}
            </div>
          </section>
        )}

        {/* Offerte attive */}
        {offers.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 font-display text-xl font-bold text-txt">Offerte</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {offers.map((p) => (
                <div key={p.id} className="rounded-xl border p-4" style={{ borderColor: `color-mix(in srgb, ${accent} 40%, var(--line))`, backgroundColor: `color-mix(in srgb, ${accent} 6%, transparent)` }}>
                  <div className="flex items-center gap-2"><span className="rounded-full px-2 py-0.5 text-sm font-bold text-white" style={{ backgroundColor: accent }}>−{p.discountPct}%</span><span className="font-semibold text-txt">{p.name || "Offerta"}</span></div>
                  <div className="mt-2 text-sm text-dim">Codice: <b className="font-mono text-txt">{p.code}</b></div>
                  <button onClick={() => go()} className="mt-2 text-sm font-medium" style={{ color: accent }}>Prenota con l'offerta →</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recensioni */}
        {cfg.recensioni && reviews.length > 0 && (
          <section className="mt-10">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl font-bold text-txt">Dicono di noi <span className="ml-1 text-sm font-normal text-dim">★ {reviewsAvg.toFixed(1)}/10 · {reviews.length} recensioni</span></h2>
              {cfg.googleUrl && <a href={cfg.googleUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Leggi le recensioni su Google ↗</a>}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {reviews.map((r) => (
                <div key={r.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="text-sm" style={{ color: "#E0A21C" }}>{"★".repeat(Math.round(r.rating / 2))}</div>
                  <p className="mt-1 text-sm text-txt">“{r.text}”</p>
                  <div className="mt-2 text-xs text-faint">— {r.name}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* FAQ + Come arrivare */}
        {structure && (() => {
          const faqs: [string, string][] = [
            structure.checkInFrom ? ["A che ora è il check-in?", `Dalle ${structure.checkInFrom}${structure.checkInTo ? ` alle ${structure.checkInTo}` : ""}. Check-out ${structure.checkOutBy ? `entro le ${structure.checkOutBy}` : "al mattino"}.`] : ["", ""],
            typeof structure.pets === "boolean" ? ["Sono ammessi gli animali?", structure.pets ? "Sì, gli animali domestici sono i benvenuti." : "Purtroppo non sono ammessi animali."] : ["", ""],
            typeof structure.smoking === "boolean" ? ["Si può fumare?", structure.smoking ? "È consentito fumare negli spazi indicati." : "La struttura è non fumatori."] : ["", ""],
            structure.services?.some((s) => /parchegg/i.test(s)) ? ["C'è il parcheggio?", "Sì, è disponibile il parcheggio."] : ["", ""],
            ["Come si paga?", "Puoi prenotare direttamente dal sito; il saldo si effettua secondo le indicazioni della struttura."],
          ].filter(([q]) => q) as [string, string][];
          const addrFull = [[structure.address, structure.streetNumber].filter(Boolean).join(" "), [structure.postalCode, structure.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
          const q = (structure.lat && structure.lng) ? `${structure.lat},${structure.lng}` : encodeURIComponent(addrFull || `${structure.city ?? "Siracusa"}`);
          return (
            <section className="mt-10 grid gap-4 sm:grid-cols-2">
              <div>
                <h2 className="mb-3 font-display text-xl font-bold text-txt">Domande frequenti</h2>
                <div className="flex flex-col divide-y divide-[color:var(--line)] rounded-xl border border-line bg-surface">
                  {faqs.map(([qn, an]) => (
                    <div key={qn} className="p-3"><div className="text-sm font-semibold text-txt">{qn}</div><div className="mt-0.5 text-sm text-dim">{an}</div></div>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="mb-3 font-display text-xl font-bold text-txt">Come arrivare</h2>
                <div className="rounded-xl border border-line bg-surface p-4 text-sm text-dim">
                  <p>{addrFull || "Siracusa"}</p>
                  <p className="mt-2">🚗 In auto: raggiungi {structure.city ?? "Siracusa"} e segui le indicazioni fino all'indirizzo.</p>
                  <p className="mt-1">✈️ Aeroporto più vicino: Catania Fontanarossa (CTA).</p>
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${q}`} target="_blank" rel="noreferrer" className="mt-2 inline-block font-medium" style={{ color: accent }}>Indicazioni stradali ↗</a>
                </div>
              </div>
            </section>
          );
        })()}

        {/* Contatti (sinistra) / Mappa (destra) */}
        <section className="mt-10 grid gap-3 sm:grid-cols-2">
          {cfg.contatti && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h3 className="font-display text-lg font-bold text-txt">Contatti</h3>
              <div className="mt-1 flex flex-col gap-1 text-sm text-dim">
                {structure?.email && <a href={`mailto:${structure.email}`} className="hover:underline">✉ {structure.email}</a>}
                {structure?.phone && <a href={`tel:${structure.phone}`} className="hover:underline">☎ {structure.phone}</a>}
                {structure?.phone && <a href={`https://wa.me/${structure.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="font-medium" style={{ color: "#25D366" }}>Scrivici su WhatsApp</a>}
                {structure?.website && <a href={structure.website.startsWith("http") ? structure.website : `https://${structure.website}`} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: accent }}>🌐 {structure.website}</a>}
                <div className="mt-1 flex gap-3">
                  {structure?.instagram && <a href={structure.instagram.startsWith("http") ? structure.instagram : `https://instagram.com/${structure.instagram.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="font-medium hover:underline" style={{ color: "#C13584" }}>Instagram</a>}
                  {structure?.facebook && <a href={structure.facebook.startsWith("http") ? structure.facebook : `https://facebook.com/${structure.facebook}`} target="_blank" rel="noreferrer" className="font-medium hover:underline" style={{ color: "#1877F2" }}>Facebook</a>}
                </div>
              </div>
            </div>
          )}
          {cfg.mappa && (() => {
            const addr = [structure?.address, structure?.streetNumber].filter(Boolean).join(" ");
            const full = [addr, [structure?.postalCode, structure?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
            const q = (structure?.lat && structure?.lng) ? `${structure.lat},${structure.lng}` : encodeURIComponent(full || `${structure?.city ?? "Siracusa"}`);
            return (
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                <iframe src={`https://maps.google.com/maps?q=${q}&z=15&output=embed`} className="h-52 w-full" style={{ border: 0 }} loading="lazy" title="Mappa" />
                <div className="p-4">
                  <h3 className="font-display text-lg font-bold text-txt">Dove siamo</h3>
                  <p className="mt-1 text-sm text-dim">{full || "Ortigia, Siracusa"}{structure?.zone ? ` · ${structure.zone}` : ""}</p>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-medium" style={{ color: accent }}>Apri su Google Maps ↗</a>
                </div>
              </div>
            );
          })()}
        </section>

        <div className="mt-12 flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface p-6 text-center">
          <div className="font-display text-lg font-bold text-txt">Prenota direttamente e risparmia</div>
          <p className="max-w-md text-sm text-dim">Prenotando da qui eviti le commissioni delle OTA e ottieni il miglior prezzo garantito.</p>
          <button onClick={() => go()} className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: accent }}>Verifica disponibilità</button>
        </div>

        {/* Newsletter */}
        <section className="mt-10 rounded-2xl border border-line bg-surface p-6">
          <div className="grid gap-4 sm:grid-cols-2 sm:items-center">
            <div>
              <h2 className="font-display text-xl font-bold text-txt">Iscriviti alla newsletter</h2>
              <p className="mt-1 text-sm text-dim">Lascia i tuoi dati e ricevi in anteprima le nostre offerte e promozioni.</p>
            </div>
            {nlDone ? (
              <div className="rounded-xl border border-line bg-paper p-4 text-center text-sm font-medium text-[color:var(--ok)]">✓ Grazie! Ti terremo aggiornato sulle offerte.</div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <input value={nl.firstName} onChange={(e) => setNl({ ...nl, firstName: e.target.value })} placeholder="Nome" className={field} />
                <input value={nl.lastName} onChange={(e) => setNl({ ...nl, lastName: e.target.value })} placeholder="Cognome" className={field} />
                <input value={nl.email} onChange={(e) => setNl({ ...nl, email: e.target.value })} placeholder="Email *" className={`${field} col-span-2`} />
                <input value={nl.phone} onChange={(e) => setNl({ ...nl, phone: e.target.value })} placeholder="Telefono" className={`${field} col-span-2`} />
                <button onClick={nlSubmit} disabled={!nl.email.trim() || (!nl.firstName.trim() && !nl.lastName.trim())} className="col-span-2 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: accent }}>Iscrivimi</button>
                <p className="col-span-2 text-[10px] text-faint">Iscrivendoti acconsenti a ricevere comunicazioni promozionali. Puoi disiscriverti quando vuoi.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-h-[90vh] max-w-full rounded-lg object-contain" />
          <button onClick={() => setLightbox(null)} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white">✕</button>
        </div>
      )}

      <footer className="mt-12 border-t border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-txt">
              <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md text-xs font-bold text-white" style={{ backgroundColor: structure?.photoColor ?? accent }}>{structure?.logo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={structure.logo} alt="" className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase()}</span>
              {name}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-faint">
              {structure?.email && <a href={`mailto:${structure.email}`} className="hover:text-dim">{structure.email}</a>}
              {structure?.phone && <a href={`tel:${structure.phone}`} className="hover:text-dim">{structure.phone}</a>}
              {structure?.cin && <span>CIN {structure.cin}</span>}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[11px] text-faint">
            <span>© {new Date().getFullYear()} {name}. Tutti i diritti riservati.</span>
            <span>Sito creato dal gruppo <b className="text-dim">Xenora</b> · Prenotazione online sicura</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
