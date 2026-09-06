"use client";

import { useEffect, useMemo, useState } from "react";
import { DataProvider, useData } from "@/lib/store";
import type { RoomType } from "@/lib/types";
import { effectiveBase } from "@/lib/pricing";
import { getImages } from "@/lib/images";
import { eur } from "@/lib/format";

const toISO = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return toISO(d); };

interface Cfg { nome: string; tagline: string; accent: string; hero: boolean; camere: boolean; recensioni: boolean; mappa: boolean; contatti: boolean }
const DEFCFG: Cfg = { nome: "", tagline: "Il tuo soggiorno nel cuore di Ortigia", accent: "#4F46E5", hero: true, camere: true, recensioni: true, mappa: true, contatti: true };


export default function SitoWebPage() {
  return <DataProvider><Site /></DataProvider>;
}

function Site() {
  const { structures, roomTypes, getStructure } = useData();
  const cfg = useMemo<Cfg>(() => { try { const r = localStorage.getItem("spigolestay:sito"); if (r) return { ...DEFCFG, ...JSON.parse(r) }; } catch {} return DEFCFG; }, []);
  const [sid, setSid] = useState(() => { try { return new URLSearchParams(window.location.search).get("s") || structures[0]?.id || ""; } catch { return structures[0]?.id ?? ""; } });
  // Lo store carica i dati dopo il mount: aggancia la prima struttura appena disponibile.
  useEffect(() => { if ((!sid || !structures.some((s) => s.id === sid)) && structures[0]) setSid(structures[0].id); }, [structures, sid]);
  const structure = getStructure(sid);
  const name = structure?.name || cfg.nome || "Xenora";
  const accent = cfg.accent;

  const today = toISO(new Date());
  const [ci, setCi] = useState(addDays(today, 7));
  const [co, setCo] = useState(addDays(today, 8));
  const [ad, setAd] = useState(2);
  const [ch, setCh] = useState(0);

  const types = roomTypes.filter((rt) => rt.structureId === sid);
  const go = (extra = "") => { window.location.href = `/prenota?s=${sid}&ci=${ci}&co=${co}&ad=${ad}&ch=${ch}${extra}`; };

  const field = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  return (
    <div className="min-h-full bg-wash pb-20">
      {/* Top bar */}
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: structure?.photoColor ?? accent }}>{name.slice(0, 2).toUpperCase()}</div>
          <div className="text-sm font-bold text-txt">{name}<span className="ml-1 text-[11px] font-normal text-faint">· Sito ufficiale</span></div>
          <div className="ml-auto flex items-center gap-3 text-xs text-dim">
            {structure?.phone && <span>{structure.phone}</span>}
            {structures.length > 1 && <select value={sid} onChange={(e) => setSid(e.target.value)} className="rounded-lg border border-line bg-paper px-2 py-1 text-xs">{structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          </div>
        </div>
      </div>

      {/* Hero + ricerca */}
      {cfg.hero && (
        <div className="relative overflow-hidden px-4 py-14 text-white" style={{ background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 45%, #000))` }}>
          <div className="mx-auto max-w-5xl">
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{name}</h1>
            <p className="mt-2 max-w-xl text-white/90">{cfg.tagline}</p>
            <div className="mt-6 grid max-w-3xl gap-2 rounded-2xl bg-white/95 p-3 shadow-lg sm:grid-cols-5">
              <label className="block text-[11px] font-medium text-dim">Arrivo<input type="date" value={ci} min={today} onChange={(e) => { setCi(e.target.value); if (e.target.value >= co) setCo(addDays(e.target.value, 1)); }} className={`${field} mt-0.5 w-full`} /></label>
              <label className="block text-[11px] font-medium text-dim">Partenza<input type="date" value={co} min={addDays(ci, 1)} onChange={(e) => setCo(e.target.value)} className={`${field} mt-0.5 w-full`} /></label>
              <label className="block text-[11px] font-medium text-dim">Adulti<input type="number" min={1} value={ad} onChange={(e) => setAd(Math.max(1, +e.target.value))} className={`${field} mt-0.5 w-full`} /></label>
              <label className="block text-[11px] font-medium text-dim">Bambini<input type="number" min={0} value={ch} onChange={(e) => setCh(Math.max(0, +e.target.value))} className={`${field} mt-0.5 w-full`} /></label>
              <button onClick={() => go()} className="mt-auto rounded-lg py-2 text-sm font-semibold text-white" style={{ backgroundColor: accent }}>Verifica disponibilità</button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-5xl px-4">
        {/* Chi siamo */}
        {structure?.description && (
          <section className="mt-10">
            <h2 className="mb-3 font-display text-xl font-bold text-txt">Chi siamo</h2>
            <p className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-dim">{structure.description}</p>
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

        {/* Recensioni */}
        {cfg.recensioni && (
          <section className="mt-10">
            <h2 className="mb-3 font-display text-xl font-bold text-txt">Dicono di noi</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {[["Andrea è un host straordinario, posizione perfetta.", "Giulia", "★★★★★"], ["Pulizia impeccabile e colazione ottima.", "Marc", "★★★★★"], ["Camera spaziosa e silenziosa, torneremo!", "Sofia", "★★★★★"]].map(([t, n, s], i) => (
                <div key={i} className="rounded-xl border border-line bg-surface p-4">
                  <div className="text-sm" style={{ color: "#E0A21C" }}>{s}</div>
                  <p className="mt-1 text-sm text-txt">“{t}”</p>
                  <div className="mt-2 text-xs text-faint">— {n}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Mappa / contatti */}
        <section className="mt-10 grid gap-3 sm:grid-cols-2">
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
        </section>

        <div className="mt-12 flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface p-6 text-center">
          <div className="font-display text-lg font-bold text-txt">Prenota direttamente e risparmia</div>
          <p className="max-w-md text-sm text-dim">Prenotando dal sito ufficiale eviti le commissioni delle OTA e ottieni il miglior prezzo garantito.</p>
          <button onClick={() => go()} className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: accent }}>Verifica disponibilità</button>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-5xl px-4 text-center text-[11px] text-faint">{name} · Prenotazione online sicura powered by Xenora</div>
    </div>
  );
}
