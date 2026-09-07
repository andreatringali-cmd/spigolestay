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

// Lingue del sito pubblico
const SITE_LANGS: [string, string][] = [["it", "🇮🇹 IT"], ["en", "🇬🇧 EN"], ["fr", "🇫🇷 FR"], ["de", "🇩🇪 DE"], ["es", "🇪🇸 ES"]];
// Dizionario UI (chiave = italiano). Le stringhe non presenti restano in italiano.
const SITE_DICT: Record<string, Record<string, string>> = {
  "Arrivo": { en: "Check-in", fr: "Arrivée", de: "Anreise", es: "Llegada" },
  "Partenza": { en: "Check-out", fr: "Départ", de: "Abreise", es: "Salida" },
  "Adulti": { en: "Adults", fr: "Adultes", de: "Erwachsene", es: "Adultos" },
  "Bambini": { en: "Children", fr: "Enfants", de: "Kinder", es: "Niños" },
  "Verifica disponibilità": { en: "Check availability", fr: "Vérifier la disponibilité", de: "Verfügbarkeit prüfen", es: "Ver disponibilidad" },
  "Età dei bambini": { en: "Children's age", fr: "Âge des enfants", de: "Alter der Kinder", es: "Edad de los niños" },
  "Chi siamo": { en: "About us", fr: "À propos", de: "Über uns", es: "Quiénes somos" },
  "Le nostre camere": { en: "Our rooms", fr: "Nos chambres", de: "Unsere Zimmer", es: "Nuestras habitaciones" },
  "letti": { en: "beds", fr: "lits", de: "Betten", es: "camas" },
  "fino a": { en: "up to", fr: "jusqu'à", de: "bis zu", es: "hasta" },
  "ospiti": { en: "guests", fr: "personnes", de: "Gäste", es: "huéspedes" },
  "Prenota": { en: "Book", fr: "Réserver", de: "Buchen", es: "Reservar" },
  "Servizi": { en: "Amenities", fr: "Services", de: "Ausstattung", es: "Servicios" },
  "Informazioni utili": { en: "Useful info", fr: "Infos utiles", de: "Nützliche Infos", es: "Información útil" },
  "Galleria": { en: "Gallery", fr: "Galerie", de: "Galerie", es: "Galería" },
  "Offerte": { en: "Offers", fr: "Offres", de: "Angebote", es: "Ofertas" },
  "Codice": { en: "Code", fr: "Code", de: "Code", es: "Código" },
  "Dicono di noi": { en: "Reviews", fr: "Avis", de: "Bewertungen", es: "Opiniones" },
  "recensioni": { en: "reviews", fr: "avis", de: "Bewertungen", es: "opiniones" },
  "Leggi le recensioni su Google": { en: "Read reviews on Google", fr: "Lire les avis sur Google", de: "Bewertungen auf Google lesen", es: "Ver opiniones en Google" },
  "Domande frequenti": { en: "FAQ", fr: "FAQ", de: "Häufige Fragen", es: "Preguntas frecuentes" },
  "Come arrivare": { en: "How to reach us", fr: "Comment nous rejoindre", de: "Anfahrt", es: "Cómo llegar" },
  "Indicazioni stradali": { en: "Directions", fr: "Itinéraire", de: "Wegbeschreibung", es: "Cómo llegar" },
  "Contatti": { en: "Contacts", fr: "Contacts", de: "Kontakt", es: "Contacto" },
  "Dove siamo": { en: "Where we are", fr: "Où nous sommes", de: "Wo wir sind", es: "Dónde estamos" },
  "Scrivici su WhatsApp": { en: "Message us on WhatsApp", fr: "Écrivez-nous sur WhatsApp", de: "Schreib uns auf WhatsApp", es: "Escríbenos por WhatsApp" },
  "Apri su Google Maps": { en: "Open in Google Maps", fr: "Ouvrir dans Google Maps", de: "In Google Maps öffnen", es: "Abrir en Google Maps" },
  "Prenota direttamente e risparmia": { en: "Book direct and save", fr: "Réservez en direct et économisez", de: "Direkt buchen und sparen", es: "Reserva directo y ahorra" },
  "Prenotando da qui eviti le commissioni delle OTA e ottieni il miglior prezzo garantito.": { en: "Booking here you avoid OTA fees and get the best guaranteed price.", fr: "En réservant ici, vous évitez les commissions des OTA et bénéficiez du meilleur prix garanti.", de: "Bei Direktbuchung sparen Sie OTA-Gebühren und erhalten den garantiert besten Preis.", es: "Reservando aquí evitas las comisiones de las OTA y obtienes el mejor precio garantizado." },
  "Iscriviti alla newsletter": { en: "Subscribe to the newsletter", fr: "Inscrivez-vous à la newsletter", de: "Newsletter abonnieren", es: "Suscríbete a la newsletter" },
  "Lascia i tuoi dati e ricevi in anteprima le nostre offerte e promozioni.": { en: "Leave your details and get our offers and promotions first.", fr: "Laissez vos coordonnées et recevez nos offres en avant-première.", de: "Hinterlassen Sie Ihre Daten und erhalten Sie unsere Angebote zuerst.", es: "Déjanos tus datos y recibe antes nuestras ofertas." },
  "Nome": { en: "First name", fr: "Prénom", de: "Vorname", es: "Nombre" },
  "Cognome": { en: "Last name", fr: "Nom", de: "Nachname", es: "Apellido" },
  "Telefono": { en: "Phone", fr: "Téléphone", de: "Telefon", es: "Teléfono" },
  "Iscrivimi": { en: "Subscribe", fr: "S'inscrire", de: "Abonnieren", es: "Suscribirme" },
  "Grazie! Ti terremo aggiornato sulle offerte.": { en: "Thanks! We'll keep you posted on our offers.", fr: "Merci ! Nous vous tiendrons informé de nos offres.", de: "Danke! Wir halten Sie über Angebote auf dem Laufenden.", es: "¡Gracias! Te mantendremos al día de las ofertas." },
  "Tutti i diritti riservati.": { en: "All rights reserved.", fr: "Tous droits réservés.", de: "Alle Rechte vorbehalten.", es: "Todos los derechos reservados." },
  "Sito creato dal gruppo": { en: "Website by the", fr: "Site créé par le groupe", de: "Website vom Team", es: "Sitio creado por el grupo" },
  "notte": { en: "night", fr: "nuit", de: "Nacht", es: "noche" },
  "notti": { en: "nights", fr: "nuits", de: "Nächte", es: "noches" },
};

interface Cfg { nome: string; tagline: string; accent: string; heroBg?: string; googleUrl?: string; hero: boolean; camere: boolean; recensioni: boolean; mappa: boolean; contatti: boolean }
const DEFCFG: Cfg = { nome: "", tagline: "Il tuo soggiorno nel cuore di Ortigia", accent: "#4F46E5", heroBg: "", googleUrl: "", hero: true, camere: true, recensioni: true, mappa: true, contatti: true };


export default function SitoWebPage() {
  return <DataProvider><Site /></DataProvider>;
}

function Site() {
  const { structures, roomTypes, units, bookings, getStructure, getGuest, addGuest } = useData();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null);
  const [lang, setLang] = useState("it");
  useEffect(() => { try { const l = new URLSearchParams(window.location.search).get("lang") || localStorage.getItem("xenora:sitelang"); if (l && SITE_LANGS.some(([c]) => c === l)) setLang(l); } catch {} }, []);
  const setLangP = (l: string) => { setLang(l); try { localStorage.setItem("xenora:sitelang", l); } catch {} };
  const T = (s: string) => (lang === "it" ? s : (SITE_DICT[s]?.[lang] ?? s));
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

  // Galleria: foto delle tipologie + foto delle singole camere, con etichetta della tipologia.
  const gallery = useMemo(() => {
    const out: { src: string; label: string }[] = [];
    types.forEach((rt) => getImages(`rt:${rt.id}`).forEach((u) => out.push({ src: u, label: rt.name })));
    units.filter((u) => u.structureId === sid).forEach((u) => { const rt = roomTypes.find((r) => r.id === u.roomTypeId); (u.photos ?? []).forEach((p) => out.push({ src: p, label: rt?.name ?? u.name })); });
    const seen = new Set<string>();
    return out.filter((g) => (seen.has(g.src) ? false : (seen.add(g.src), true))).slice(0, 20);
  }, [types, units, sid, roomTypes]);
  const [gi, setGi] = useState(0);

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
    <div className="flex min-h-full flex-col bg-wash">
      {/* Top bar */}
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg text-sm font-bold text-white" style={{ backgroundColor: structure?.photoColor ?? accent }}>{structure?.logo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={structure.logo} alt="" className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase()}</div>
          <div className="text-sm font-bold text-txt">{name}<span className="ml-1 text-[11px] font-normal text-faint">· Xenorabook</span></div>
          <div className="ml-auto flex items-center gap-3 text-xs text-dim">
            {weather && <span className="flex items-center gap-1 rounded-full bg-wash px-2 py-1 font-medium" title={`Meteo ${structure?.city ?? "Siracusa"}`}>{wIcon(weather.code)} {weather.temp}° · {structure?.city ?? "Siracusa"}</span>}
            <select value={lang} onChange={(e) => setLangP(e.target.value)} className="rounded-lg border border-line bg-paper px-2 py-1 text-xs" title="Lingua / Language">{SITE_LANGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>
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
            <h2 className="mb-3 font-display text-xl font-bold text-txt">{T("Chi siamo")}</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-dim">{structure.description}</p>
          </section>
        )}

        {/* Camere */}
        {cfg.camere && (
          <section className="mt-10">
            <h2 className="mb-3 font-display text-xl font-bold text-txt">{T("Le nostre camere")}</h2>
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
            <h2 className="mb-3 font-display text-xl font-bold text-txt">{T("Servizi")}</h2>
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

        {/* Galleria (carosello) */}
        {gallery.length > 0 && (() => {
          const cur = gallery[gi % gallery.length];
          const len = gallery.length;
          return (
            <section className="mt-10">
              <h2 className="mb-3 font-display text-xl font-bold text-txt">{T("Galleria")}</h2>
              <div className="relative overflow-hidden rounded-2xl border border-line bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cur.src} alt={cur.label} onClick={() => setLightbox(cur.src)} className="mx-auto max-h-[460px] w-full cursor-zoom-in bg-black object-contain" />
                {len > 1 && (
                  <>
                    <button onClick={() => setGi((g) => (g - 1 + len) % len)} className="absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-xl text-white hover:bg-black/65">‹</button>
                    <button onClick={() => setGi((g) => (g + 1) % len)} className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-xl text-white hover:bg-black/65">›</button>
                  </>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4">
                  <div className="text-base font-semibold text-white">{cur.label}</div>
                  <div className="text-[11px] text-white/70">{(gi % len) + 1} / {len}</div>
                </div>
              </div>
              {len > 1 && (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {gallery.map((g, i) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <button key={i} onClick={() => setGi(i)} className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${i === gi % len ? "" : "opacity-60"}`} style={{ borderColor: i === gi % len ? accent : "var(--line)" }}><img src={g.src} alt="" className="h-full w-full object-cover" /></button>
                  ))}
                </div>
              )}
            </section>
          );
        })()}

        {/* Offerte attive */}
        {offers.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 font-display text-xl font-bold text-txt">{T("Offerte")}</h2>
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

        {/* Newsletter (sinistra) / Mappa (destra) */}
        <section className="mt-10 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-4">
            <h3 className="font-display text-lg font-bold text-txt">{T("Iscriviti alla newsletter")}</h3>
            <p className="mt-1 text-sm text-dim">{T("Lascia i tuoi dati e ricevi in anteprima le nostre offerte e promozioni.")}</p>
            {nlDone ? (
              <div className="mt-3 rounded-lg border border-line bg-paper p-3 text-center text-sm font-medium text-[color:var(--ok)]">✓ {T("Grazie! Ti terremo aggiornato sulle offerte.")}</div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input value={nl.firstName} onChange={(e) => setNl({ ...nl, firstName: e.target.value })} placeholder={T("Nome")} className={field} />
                <input value={nl.lastName} onChange={(e) => setNl({ ...nl, lastName: e.target.value })} placeholder={T("Cognome")} className={field} />
                <input value={nl.email} onChange={(e) => setNl({ ...nl, email: e.target.value })} placeholder="Email *" className={`${field} col-span-2`} />
                <input value={nl.phone} onChange={(e) => setNl({ ...nl, phone: e.target.value })} placeholder={T("Telefono")} className={`${field} col-span-2`} />
                <button onClick={nlSubmit} disabled={!nl.email.trim() || (!nl.firstName.trim() && !nl.lastName.trim())} className="col-span-2 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: accent }}>{T("Iscrivimi")}</button>
              </div>
            )}
          </div>
          {cfg.mappa && (() => {
            const addr = [structure?.address, structure?.streetNumber].filter(Boolean).join(" ");
            const full = [addr, [structure?.postalCode, structure?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
            const q = (structure?.lat && structure?.lng) ? `${structure.lat},${structure.lng}` : encodeURIComponent(full || `${structure?.city ?? "Siracusa"}`);
            return (
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                <iframe src={`https://maps.google.com/maps?q=${q}&z=15&output=embed`} className="h-52 w-full" style={{ border: 0 }} loading="lazy" title="Mappa" />
                <div className="p-4">
                  <h3 className="font-display text-lg font-bold text-txt">{T("Dove siamo")}</h3>
                  <p className="mt-1 text-sm text-dim">{full || "Ortigia, Siracusa"}{structure?.zone ? ` · ${structure.zone}` : ""}</p>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-medium" style={{ color: accent }}>{T("Apri su Google Maps")} ↗</a>
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

        {/* Recensioni Google (banner sempre visibile se c'è il link) */}
        {cfg.googleUrl && (
          <section className="mt-10">
            <a href={cfg.googleUrl} target="_blank" rel="noreferrer" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-5 transition hover:shadow-md">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-white">
                  <svg width="22" height="22" viewBox="0 0 48 48"><path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 1.9-1.6 4.8-4.5 6.7l-.1.3 6.5 5 .4.1c4.2-3.8 6.2-9.5 6.2-15.4Z"/><path fill="#34A853" d="M24 46c5.9 0 10.9-1.9 14.5-5.3l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3.1-6.7 5.2-.1.3C7.5 41 15.1 46 24 46Z"/><path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4 0-1.5.3-3 .7-4.4v-.3l-6.8-5.3-.2.1A22.3 22.3 0 0 0 2 24c0 3.6.9 7 2.4 10l7.1-5.6Z"/><path fill="#EA4335" d="M24 10.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.3 29.9 2 24 2 15.1 2 7.5 7 4.4 14l7.1 5.6C13.3 14.3 18.2 10.5 24 10.5Z"/></svg>
                </span>
                <div>
                  <div className="font-display text-lg font-bold text-txt">{T("Dicono di noi")}</div>
                  <div className="text-sm text-dim">★★★★★ · {T("Leggi le recensioni su Google")}</div>
                </div>
              </div>
              <span className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: accent }}>{T("Leggi le recensioni su Google")} ↗</span>
            </a>
          </section>
        )}

        {/* Recensioni interne (dagli ospiti) */}
        {cfg.recensioni && reviews.length > 0 && (
          <section className="mt-10">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl font-bold text-txt">{T("Dicono di noi")} <span className="ml-1 text-sm font-normal text-dim">★ {reviewsAvg.toFixed(1)}/10 · {reviews.length} {T("recensioni")}</span></h2>
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
              <div className="flex items-center gap-2">
                {structure?.phone && <a href={`https://wa.me/${structure.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" title="WhatsApp" className="grid h-7 w-7 place-items-center rounded-full bg-wash transition hover:opacity-80" style={{ color: "#25D366" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1-.4-.1-.9-.3-1.6-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.3.7-2 .9-2.2.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.6-.3.3c-.2.2-.3.3-.1.6.2.3.9 1.4 1.9 2.3 1.3 1.1 2.3 1.5 2.6 1.6.3.1.5.1.7-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.1.1.5-.1 1Z" /></svg></a>}
                {structure?.instagram && <a href={structure.instagram.startsWith("http") ? structure.instagram : `https://instagram.com/${structure.instagram.replace(/^@/, "")}`} target="_blank" rel="noreferrer" title="Instagram" className="grid h-7 w-7 place-items-center rounded-full bg-wash transition hover:opacity-80" style={{ color: "#C13584" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg></a>}
                {structure?.facebook && <a href={structure.facebook.startsWith("http") ? structure.facebook : `https://facebook.com/${structure.facebook}`} target="_blank" rel="noreferrer" title="Facebook" className="grid h-7 w-7 place-items-center rounded-full bg-wash transition hover:opacity-80" style={{ color: "#1877F2" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" /></svg></a>}
                {structure?.website && <a href={structure.website.startsWith("http") ? structure.website : `https://${structure.website}`} target="_blank" rel="noreferrer" title="Sito" className="grid h-7 w-7 place-items-center rounded-full bg-wash transition hover:opacity-80" style={{ color: accent }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg></a>}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[11px] text-faint">
            <span>© {new Date().getFullYear()} {name}. {T("Tutti i diritti riservati.")}</span>
            <span>Sito creato dal gruppo <b className="text-dim">Xenora</b> · Prenotazione online sicura</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
