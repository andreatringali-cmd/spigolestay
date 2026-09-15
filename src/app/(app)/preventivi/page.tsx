"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { useData } from "@/lib/store";
import { nights, parseISO, toISO, shiftISO } from "@/lib/dates";
import { eur } from "@/lib/format";
import { loadDeposit } from "@/lib/deposit";
import { shortenLink } from "@/lib/guestlink";
import { supabase } from "@/lib/supabase";
import { loadPlans, planApplies, planDepositPct, cancelText, type RatePlan } from "@/lib/rate-plans";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/authsync";

type Lang = "it" | "en" | "fr" | "de" | "es";
const LANGS: [Lang, string][] = [["it", "Italiano"], ["en", "English"], ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"]];
const FLAG: Record<Lang, string> = { it: "🇮🇹", en: "🇬🇧", fr: "🇫🇷", de: "🇩🇪", es: "🇪🇸" };
const fmt = (iso: string) => (iso ? parseISO(iso).toLocaleDateString("it-IT") : "—");

// Glifi social (path SVG, fill currentColor) per il piè di pagina del preventivo.
const SOCIAL_PATH: Record<string, string> = {
  facebook: "M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z",
  instagram: "M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.3-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.3-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 3.2A6.6 6.6 0 1 0 12 18.6 6.6 6.6 0 0 0 12 5.4zm0 10.9A4.3 4.3 0 1 1 12 7.7a4.3 4.3 0 0 1 0 8.6zm6.8-11.2a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z",
  linkedin: "M20.4 3H3.6C3 3 2.5 3.5 2.5 4.1v15.8c0 .6.5 1.1 1.1 1.1h16.8c.6 0 1.1-.5 1.1-1.1V4.1c0-.6-.5-1.1-1.1-1.1zM8.3 18.3H5.6V9.5h2.7v8.8zM6.9 8.3a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2zm11.4 10H15.6v-4.3c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2v4.4H9.9V9.5h2.6v1.2h.1c.4-.7 1.2-1.4 2.5-1.4 2.7 0 3.2 1.8 3.2 4.1v4.9z",
};
const socialHref = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

// Etichette del preventivo per lingua (formato "guida").
interface QLabels {
  hi: string; guest: string; avail: string; periodo: string; ci: string; co: string; durata: string; notte: string; notti: string;
  riepilogo: string; room: string; aNotte: string; colazione: string; inclusa: string; parcheggio: string; parkIncl: string; culla: string; cullaIncl: string;
  tassa: string; persone: string; totale: string; condizioni: string;
  accNone: string; accPart: string; accFull: string; cancLabel: string; cancText: string;
  modalita: string; bonifico: string; intest: string; causale: string; closing: string; quoteNo: string;
  perStay: string; perNight: string; perDay: string; perPerson: string; extrasTitle: string; extrasNote: string; extrasIntro: string;
}
const QL: Record<Lang, QLabels> = {
  it: { hi: "Gentile", guest: "Ospite", avail: "ho il piacere di confermarLe la disponibilità per il periodo richiesto", periodo: "Periodo", ci: "Check-in", co: "Check-out", durata: "Durata", notte: "notte", notti: "notti", riepilogo: "Riepilogo economico", room: "camera", aNotte: "a notte", colazione: "Colazione", inclusa: "Inclusa", parcheggio: "Parcheggio", parkIncl: "Incluso nel prezzo (per un'auto)", culla: "Culla", cullaIncl: "Gratuita (su richiesta)", tassa: "Tassa di soggiorno", persone: "persone", totale: "TOTALE COMPLESSIVO", condizioni: "Condizioni e pagamento", accNone: "Nessun acconto richiesto: il saldo di {tot} è dovuto al check-in.", accPart: "Per confermare è richiesto un acconto del {pct}% del totale, ovvero {dep}. Il saldo di {bal} al check-in.", accFull: "Per confermare è richiesto il pagamento dell'intero importo: {tot}.", cancLabel: "Cancellazione", cancText: "tariffa interamente rimborsabile fino a 7 giorni prima del check-in.", modalita: "Modalità di pagamento", bonifico: "Bonifico bancario", intest: "Intestatario", causale: "Causale", closing: "Restiamo a disposizione per qualsiasi informazione. A presto!", quoteNo: "Preventivo n.", perStay: "a soggiorno", perNight: "a notte", perDay: "a giornata", perPerson: "a persona", extrasTitle: "Servizi & esperienze", extrasNote: "Prezzi indicativi — puoi aggiungerli alla prenotazione.", extrasIntro: "Per rendere il tuo soggiorno indimenticabile, abbiamo pensato a una selezione di servizi ed esperienze su misura. Scopri le nostre proposte e aggiungi alla prenotazione ciò che desideri: al resto pensiamo noi." },
  en: { hi: "Dear", guest: "Guest", avail: "we are pleased to confirm availability for the requested dates", periodo: "Dates", ci: "Check-in", co: "Check-out", durata: "Length", notte: "night", notti: "nights", riepilogo: "Price summary", room: "room", aNotte: "per night", colazione: "Breakfast", inclusa: "Included", parcheggio: "Parking", parkIncl: "Included in the price (one car)", culla: "Cot", cullaIncl: "Free (on request)", tassa: "City tax", persone: "guests", totale: "GRAND TOTAL", condizioni: "Terms and payment", accNone: "No deposit required: the balance of {tot} is due at check-in.", accPart: "To confirm, a {pct}% deposit is required, i.e. {dep}. Balance of {bal} at check-in.", accFull: "To confirm, full payment is required: {tot}.", cancLabel: "Cancellation", cancText: "fully refundable up to 7 days before check-in.", modalita: "Payment methods", bonifico: "Bank transfer", intest: "Account holder", causale: "Reference", closing: "We remain at your disposal for any information. See you soon!", quoteNo: "Quote no.", perStay: "per stay", perNight: "per night", perDay: "per day", perPerson: "per person", extrasTitle: "Extras & experiences", extrasNote: "Indicative prices — you can add them to your booking.", extrasIntro: "To make your stay unforgettable, we've curated a selection of tailored services and experiences. Explore our proposals and add what you like to your booking — we'll take care of the rest." },
  fr: { hi: "Cher/Chère", guest: "client", avail: "nous avons le plaisir de confirmer la disponibilité pour les dates demandées", periodo: "Dates", ci: "Arrivée", co: "Départ", durata: "Durée", notte: "nuit", notti: "nuits", riepilogo: "Récapitulatif", room: "chambre", aNotte: "par nuit", colazione: "Petit-déjeuner", inclusa: "Inclus", parcheggio: "Parking", parkIncl: "Inclus dans le prix (une voiture)", culla: "Lit bébé", cullaIncl: "Gratuit (sur demande)", tassa: "Taxe de séjour", persone: "personnes", totale: "TOTAL GÉNÉRAL", condizioni: "Conditions et paiement", accNone: "Aucun acompte requis : le solde de {tot} est dû à l'arrivée.", accPart: "Pour confirmer, un acompte de {pct}% est requis, soit {dep}. Solde de {bal} à l'arrivée.", accFull: "Pour confirmer, le paiement intégral est requis : {tot}.", cancLabel: "Annulation", cancText: "entièrement remboursable jusqu'à 7 jours avant l'arrivée.", modalita: "Moyens de paiement", bonifico: "Virement bancaire", intest: "Titulaire", causale: "Motif", closing: "Nous restons à votre disposition. À bientôt !", quoteNo: "Devis n°", perStay: "par séjour", perNight: "par nuit", perDay: "par jour", perPerson: "par personne", extrasTitle: "Services & expériences", extrasNote: "Prix indicatifs — à ajouter à votre réservation.", extrasIntro: "Pour rendre votre séjour inoubliable, nous avons imaginé une sélection de services et d'expériences sur mesure. Découvrez nos propositions et ajoutez à votre réservation ce qui vous plaît : nous nous occupons du reste." },
  de: { hi: "Liebe/r", guest: "Gast", avail: "wir bestätigen Ihnen gerne die Verfügbarkeit für den gewünschten Zeitraum", periodo: "Zeitraum", ci: "Anreise", co: "Abreise", durata: "Dauer", notte: "Nacht", notti: "Nächte", riepilogo: "Preisübersicht", room: "Zimmer", aNotte: "pro Nacht", colazione: "Frühstück", inclusa: "Inklusive", parcheggio: "Parkplatz", parkIncl: "Im Preis inbegriffen (ein Auto)", culla: "Kinderbett", cullaIncl: "Kostenlos (auf Anfrage)", tassa: "Kurtaxe", persone: "Gäste", totale: "GESAMTBETRAG", condizioni: "Bedingungen und Zahlung", accNone: "Keine Anzahlung erforderlich: Der Restbetrag von {tot} ist bei Anreise fällig.", accPart: "Zur Bestätigung ist eine Anzahlung von {pct}% erforderlich, d.h. {dep}. Restbetrag {bal} bei Anreise.", accFull: "Zur Bestätigung ist die vollständige Zahlung erforderlich: {tot}.", cancLabel: "Stornierung", cancText: "bis 7 Tage vor Anreise voll erstattbar.", modalita: "Zahlungsarten", bonifico: "Banküberweisung", intest: "Kontoinhaber", causale: "Verwendungszweck", closing: "Wir stehen Ihnen gerne zur Verfügung. Bis bald!", quoteNo: "Angebot Nr.", perStay: "pro Aufenthalt", perNight: "pro Nacht", perDay: "pro Tag", perPerson: "pro Person", extrasTitle: "Extras & Erlebnisse", extrasNote: "Richtpreise — zur Buchung hinzufügbar.", extrasIntro: "Damit Ihr Aufenthalt unvergesslich wird, haben wir eine Auswahl maßgeschneiderter Services und Erlebnisse zusammengestellt. Entdecken Sie unsere Angebote und fügen Sie Ihrer Buchung hinzu, was Ihnen gefällt – um den Rest kümmern wir uns." },
  es: { hi: "Estimado/a", guest: "huésped", avail: "tenemos el placer de confirmar la disponibilidad para las fechas solicitadas", periodo: "Fechas", ci: "Entrada", co: "Salida", durata: "Duración", notte: "noche", notti: "noches", riepilogo: "Resumen económico", room: "habitación", aNotte: "por noche", colazione: "Desayuno", inclusa: "Incluido", parcheggio: "Aparcamiento", parkIncl: "Incluido en el precio (un coche)", culla: "Cuna", cullaIncl: "Gratis (bajo petición)", tassa: "Tasa turística", persone: "personas", totale: "TOTAL", condizioni: "Condiciones y pago", accNone: "No se requiere anticipo: el saldo de {tot} se paga en la entrada.", accPart: "Para confirmar se requiere un anticipo del {pct}%, es decir {dep}. Saldo de {bal} en la entrada.", accFull: "Para confirmar se requiere el pago íntegro: {tot}.", cancLabel: "Cancelación", cancText: "totalmente reembolsable hasta 7 días antes de la entrada.", modalita: "Formas de pago", bonifico: "Transferencia bancaria", intest: "Titular", causale: "Concepto", closing: "Quedamos a su disposición. ¡Hasta pronto!", quoteNo: "Presupuesto n.º", perStay: "por estancia", perNight: "por noche", perDay: "por día", perPerson: "por persona", extrasTitle: "Servicios y experiencias", extrasNote: "Precios orientativos — puedes añadirlos a la reserva.", extrasIntro: "Para hacer tu estancia inolvidable, hemos preparado una selección de servicios y experiencias a medida. Descubre nuestras propuestas y añade a tu reserva lo que desees: del resto nos ocupamos nosotros." },
};

type QuoteRoom = { roomTypeId: string; qty: number; price: number };
interface Preventivo {
  id: string;
  number: number;
  name: string;
  email?: string;
  phone?: string;
  structure: string;
  structureId: string;
  roomTypeId: string;
  roomLines?: QuoteRoom[];
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childAges?: number[];
  rooms: number;
  taxPersons: number;
  price: number;
  parking: boolean;
  parkingPrice: number;
  breakfast: boolean;
  breakfastPrice?: number;
  cot?: boolean;       // culla richiesta (solo con bambini)
  cotPrice?: number;   // € a notte per la culla (0 = inclusa)
  extrasPage?: boolean; // includi la 2ª pagina con i servizi extra
  acconto: number; // % acconto (predefinita dalla scheda struttura)
  note?: string;
  lang: Lang;
  total: number;
  createdAt: string;
  status: "inviato" | "confermato";
  bookingId?: string;
}

export default function PreventiviPage() {
  const { t } = useLang();
  const ask = useConfirm();
  const { structures, roomTypes, units, bookings, guests, rateOverrides, addGuest, updateGuest, addBooking, addActivity, activeStructureId } = useData();
  const { user } = useAuth();
  const lockedStructure = activeStructureId !== "all"; // struttura scelta in alto → niente scelta nel preventivo

  // Parametri in arrivo dal wizard "Aggiungi prenotazione" (modalità Preventivo): precompilano il modulo.
  const qp = (k: string) => { try { return new URLSearchParams(window.location.search).get(k) || ""; } catch { return ""; } };
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const name = `${firstName} ${lastName}`.trim();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [structureId, setStructureId] = useState(qp("s") || (lockedStructure ? activeStructureId : (structures[0]?.id ?? "")));
  const typesOf = roomTypes.filter((rt) => rt.structureId === structureId);
  const [checkIn, setCheckIn] = useState(qp("ci") || toISO(new Date()));
  const [checkOut, setCheckOut] = useState(qp("co") || shiftISO(qp("ci") || toISO(new Date()), 1));
  const [adults, setAdults] = useState(Number(qp("ad")) || 2);
  const [children, setChildren] = useState(Number(qp("ch")) || 0);
  const [childAges, setChildAges] = useState<number[]>(() => { const n = Number(qp("ch")) || 0; return Array.from({ length: n }, () => 8); }); // età dei bambini (per la tassa: sotto i 15 esenti)
  // Righe camera del preventivo (più tipologie nella struttura selezionata, ognuna con quantità e prezzo).
  const [roomLines, setRoomLines] = useState<QuoteRoom[]>(() => { const sid = qp("s") || (lockedStructure ? activeStructureId : (structures[0]?.id ?? "")); const rt0 = roomTypes.find((r) => r.structureId === sid); return rt0 ? [{ roomTypeId: rt0.id, qty: 1, price: rt0.basePrice }] : []; });
  const rtName = (id: string) => roomTypes.find((r) => r.id === id)?.name ?? "";
  // Disponibilità reale di una tipologia nel periodo (camere fisiche non occupate).
  const availOf = (rtId: string) => units.filter((u) => u.roomTypeId === rtId && !u.outOfService && !bookings.some((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.unitId === u.id && b.checkIn < checkOut && b.checkOut > checkIn)).length;
  const datesOk = !!(checkIn && checkOut && checkOut > checkIn);
  // Piani tariffari (definiti in Tariffe): scelti qui, applicano il loro scarto al prezzo del calendario.
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [planId, setPlanId] = useState("flex");
  useEffect(() => { const p = loadPlans(); setPlans(p); setPlanId((prev) => (p.some((x) => x.id === prev) ? prev : p[0]?.id ?? prev)); }, []);
  const activePlan = plans.find((p) => p.id === planId);
  const planAdj = activePlan?.adjPct ?? 0;
  // Prezzo automatico dal calendario per una tipologia nel periodo, con lo scarto del piano scelto (poi modificabile).
  const autoPrice = (rtId: string) => { const base = roomTypes.find((r) => r.id === rtId)?.basePrice ?? 100; let sum = 0, cnt = 0; for (let d = checkIn; d && d < checkOut && cnt < 60; d = shiftISO(d, 1)) { sum += rateOverrides[`${rtId}|${d}`] ?? rateOverrides[d] ?? base; cnt++; } const avg = cnt > 0 ? sum / cnt : base; return Math.max(0, Math.round(avg * (1 + planAdj / 100))); };
  const updateLine = (i: number, patch: Partial<QuoteRoom>) => setRoomLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () => setRoomLines((ls) => { const used = new Set(ls.map((l) => l.roomTypeId)); const next = typesOf.find((t) => !used.has(t.id)) ?? typesOf[0]; return next ? [...ls, { roomTypeId: next.id, qty: 1, price: autoPrice(next.id) }] : ls; });
  const removeLine = (i: number) => setRoomLines((ls) => ls.filter((_, j) => j !== i));
  const roomsTotal = roomLines.reduce((a, l) => a + l.qty, 0);
  // Riepilogo: righe con stessa tipologia + stesso prezzo accorpate in una sola (qtà sommata).
  const mergedLines = (() => { const m = new Map<string, QuoteRoom>(); roomLines.forEach((l) => { const k = `${l.roomTypeId}|${l.price}`; const ex = m.get(k); if (ex) ex.qty += l.qty; else m.set(k, { ...l }); }); return [...m.values()]; })();
  // Persone soggette a tassa: automatico = adulti + bambini di 15 anni o più (sotto i 15 esenti).
  const taxKids = childAges.filter((a) => a >= 15).length;
  const taxPersons = adults + taxKids;
  const [acconto, setAcconto] = useState<number>(50);
  const [structPct, setStructPct] = useState<number>(50); // % acconto impostata nella scheda struttura (card centrale)
  // Predefinito dalla % acconto impostata nella scheda struttura (voce globale).
  useEffect(() => { try { const d = loadDeposit(); const pct = Math.min(100, Math.max(0, Math.round(d.pct || 0))); setStructPct(pct || 50); setAcconto(d.on ? pct : 0); } catch {} }, []);
  const [breakfast, setBreakfast] = useState(true);
  const [breakfastPrice, setBreakfastPrice] = useState(0); // € a notte (0 = inclusa)
  const [parking, setParking] = useState(true);
  const [parkingPrice, setParkingPrice] = useState(0); // € a notte (0 = incluso)
  const [cot, setCot] = useState(false);       // culla (mostrata solo con bambini)
  const [cotPrice, setCotPrice] = useState(0); // € a notte per la culla (0 = inclusa)
  const [extrasPage, setExtrasPage] = useState(true); // 2ª pagina PDF con i servizi extra
  const [tab, setTab] = useState<"nuovo" | "archivio">("nuovo"); // sezione: editor o archivio
  const [note, setNote] = useState("");
  const [lang, setLang] = useState<Lang>("it");
  const [previewPage, setPreviewPage] = useState(0); // anteprima: 0 = pagina 1, 1 = pagina 2 (extra)
  const [flipDir, setFlipDir] = useState(1); // verso dello sfoglio (1 avanti, -1 indietro)
  const flipTo = (p: number) => { setFlipDir(p >= previewPage ? 1 : -1); setPreviewPage(p); };
  // Anteprima come foglio A4 reale: misuro la larghezza disponibile e scalo la pagina (794px = A4 @96dpi).
  const previewRef = useRef<HTMLDivElement>(null);
  const [pw, setPw] = useState(700);
  useEffect(() => {
    const el = previewRef.current; if (!el) return;
    const measure = () => { const w = el.clientWidth - 16; if (w > 60) setPw(w); };
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver((entries) => { const w = entries[0]?.contentRect.width; if (w && w > 60) setPw(w); });
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [tab]);
  // Dati di pagamento (salvati nel browser, si inseriscono una volta).
  const [payHolder, setPayHolder] = useState("");
  const [payIban, setPayIban] = useState("");
  const [payExtra, setPayExtra] = useState("PayPal / Revolut: su richiesta inviamo il link dedicato.");
  useEffect(() => { try { const r = JSON.parse(localStorage.getItem("spigolestay:paysettings") || "{}"); if (r.holder) setPayHolder(r.holder); if (r.iban) setPayIban(r.iban); if (typeof r.extra === "string") setPayExtra(r.extra); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem("spigolestay:paysettings", JSON.stringify({ holder: payHolder, iban: payIban, extra: payExtra })); } catch {} }, [payHolder, payIban, payExtra]);
  const [saved, setSaved] = useState<Preventivo[]>([]);
  const loaded = useRef(false);
  useEffect(() => { if (!loaded.current) return; try { localStorage.setItem("spigolestay:preventivi", JSON.stringify(saved)); } catch {} }, [saved]);
  useEffect(() => { try { const raw = localStorage.getItem("spigolestay:preventivi"); if (raw) setSaved(JSON.parse(raw)); } catch {} }, []);
  // Riconciliazione: se esiste una prenotazione nata dal pagamento online del preventivo, segnalo confermato.
  useEffect(() => {
    setSaved((prev) => {
      let changed = false;
      const next = prev.map((p) => {
        if (p.status === "confermato") return p;
        const ref = `${p.number}/${new Date(p.createdAt).getFullYear()}`;
        const hit = bookings.some((b) => b.status !== "cancelled" && (
          (typeof b.extId === "string" && b.extId.startsWith("stripe:") && b.structureId === p.structureId && b.checkIn === p.checkIn && b.checkOut === p.checkOut)
          || (typeof b.note === "string" && b.note.includes(`n. ${ref}`))
        ));
        if (hit) { changed = true; return { ...p, status: "confermato" as const }; }
        return p;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings]);
  useEffect(() => { loaded.current = true; }, []);

  // Pre-riempimento da un link (es. dal calendario: struttura, camera, date).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get("s"), rtId = p.get("rt"), ci = p.get("ci"), co = p.get("co");
    if (s && structures.some((x) => x.id === s)) {
      setStructureId(s);
      const t = rtId && roomTypes.some((r) => r.id === rtId) ? rtId : (roomTypes.find((r) => r.structureId === s)?.id ?? "");
      const rt2 = roomTypes.find((r) => r.id === t);
      if (rt2) setRoomLines([{ roomTypeId: rt2.id, qty: 1, price: rt2.basePrice }]);
    }
    if (ci) setCheckIn(ci);
    if (co) setCheckOut(co);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Idratazione: lo store carica dopo il mount. Appena le strutture ci sono, se la selezione è
  // vuota/non valida scegli la struttura giusta e popola la prima riga camera (evita "scheda vuota").
  useEffect(() => {
    if (!structures.length) return;
    const validSid = !!structureId && structures.some((s) => s.id === structureId);
    const sid = validSid ? structureId : (lockedStructure && structures.some((s) => s.id === activeStructureId) ? activeStructureId : structures[0].id);
    if (!validSid) setStructureId(sid);
    if (roomLines.length === 0) { const rt0 = roomTypes.find((r) => r.structureId === sid); if (rt0) setRoomLines([{ roomTypeId: rt0.id, qty: 1, price: rt0.basePrice }]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structures, roomTypes]);

  // Tariffa automatica dalle tariffe del calendario per il periodo scelto (poi modificabile per riga).
  useEffect(() => {
    if (!checkIn || !checkOut || checkOut <= checkIn) return;
    setRoomLines((ls) => ls.map((l) => ({ ...l, price: autoPrice(l.roomTypeId) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkIn, checkOut, rateOverrides, planId]);

  const n = Math.max(0, nights(checkIn, checkOut));
  const accommodation = roomLines.reduce((a, l) => a + l.qty * l.price * n, 0);
  const parkingTotal = parking ? parkingPrice * n : 0;
  const breakfastTotal = breakfast ? breakfastPrice * n : 0;
  const wantsCot = children > 0 && cot;
  const cotTotal = 0; // culla sempre gratuita
  // Imposta di soggiorno Siracusa: 4% del pernottamento (tariffa più alta), max 5 € a persona/notte, max 7 notti, bambini sotto i 15 esenti.
  const priceForTax = roomLines.reduce((m, l) => Math.max(m, l.price), 0);
  const cityTax = Math.round(Math.min(priceForTax * 0.04, 5 * taxPersons) * Math.min(n, 7));
  const total = accommodation + parkingTotal + breakfastTotal + cotTotal + cityTax;
  const deposit = Math.round(total * acconto / 100);
  const balance = total - deposit;
  const structure = structures.find((s) => s.id === structureId);
  const structureName = structure?.name ?? "";
  // Servizi extra attivi della struttura (per la 2ª pagina del preventivo).
  const structExtras = (structure?.extras ?? []).filter((e) => e.active !== false);
  const perLabel = (per: string, L: QLabels) => (({ stay: L.perStay, night: L.perNight, day: L.perDay, person: L.perPerson }) as Record<string, string>)[per] ?? "";
  // IBAN/intestatario: prima quelli della struttura, poi i dati manuali salvati nel browser.
  const docHolder = structure?.ibanHolder?.trim() || payHolder;
  const docIban = structure?.iban?.trim() || payIban;

  // Numerazione per anno (riparte ogni anno): n. progressivo/anno.
  const curYear = new Date().getFullYear();
  const nextNumber = saved.filter((p) => new Date(p.createdAt).getFullYear() === curYear).reduce((m, p) => Math.max(m, p.number ?? 0), 0) + 1;
  const quoteRef = `${nextNumber}/${curYear}`;
  const todayStr = fmt(toISO(new Date()));
  const message = useMemo(() => {
    const L = QL[lang];
    const nWord = n === 1 ? L.notte : L.notti;
    const parkTxt = parkingPrice > 0 ? `${eur(parkingPrice)} ${L.aNotte}` : L.parkIncl;
    const bkTxt = breakfastPrice > 0 ? `${eur(breakfastPrice)} ${L.aNotte}` : L.inclusa;
    let acc: string;
    if (acconto === 0) acc = L.accNone.replace("{tot}", eur(total));
    else if (acconto === 100) acc = L.accFull.replace("{tot}", eur(total));
    else acc = L.accPart.replace("{dep}", eur(deposit)).replace("{bal}", eur(balance)).replace("{pct}", String(acconto));
    const causale = `${(name || "").trim()} ${fmt(checkIn)}-${fmt(checkOut)}`.trim();
    const payBlock = (docHolder || docIban)
      ? [`• ${L.bonifico}:`, `   ${L.intest}: ${docHolder}`, `   IBAN: ${docIban}`, `   ${L.causale}: ${causale}`, ...(payExtra ? [`• ${payExtra}`] : [])].join("\n")
      : (payExtra ? `• ${payExtra}` : "");
    const lines = [
      `${L.quoteNo} ${quoteRef} · ${todayStr}`,
      ``,
      `${L.hi} ${name || L.guest},`,
      `${L.avail}:`,
      ``,
      `${L.periodo}:`,
      `• ${L.ci}: ${fmt(checkIn)}`,
      `• ${L.co}: ${fmt(checkOut)}`,
      `• ${L.durata}: ${n} ${nWord}`,
      ``,
      `${L.riepilogo}:`,
      ...mergedLines.map((l) => `• ${l.qty} ${rtName(l.roomTypeId) || L.room}: ${eur(l.price)} ${L.aNotte} × ${n} ${nWord} = ${eur(l.qty * l.price * n)}`),
      ...(breakfast ? [`• ${L.colazione}: ${bkTxt}`] : []),
      ...(parking ? [`• ${L.parcheggio}: ${parkTxt}`] : []),
      ...(wantsCot ? [`• ${L.culla}: ${L.cullaIncl}`] : []),
      `• ${L.tassa}: ${eur(cityTax)} (${taxPersons} ${L.persone})`,
      `• ${L.totale}: ${eur(total)}`,
      ``,
      `${L.condizioni}:`,
      acc,
      `• ${L.cancLabel}: ${L.cancText}`,
      ``,
      `${L.modalita}:`,
      payBlock,
      ...(note ? [``, note] : []),
      ``,
      L.closing,
      ``,
      structureName,
    ];
    return lines.filter((l) => l !== undefined).join("\n");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, lang, checkIn, checkOut, n, roomLines, accommodation, breakfast, breakfastPrice, parking, parkingPrice, wantsCot, cotPrice, cityTax, taxPersons, total, acconto, deposit, balance, note, docHolder, docIban, payExtra, structureName, quoteRef, todayStr]);

  // Testo (per invio WhatsApp/email); l'anteprima a schermo è il documento PDF.
  const outMsg = message;

  // Ricarica un preventivo salvato nel form (per modificarlo).
  const delQuote = async (p: Preventivo) => {
    if (await ask({ title: t("Elimina preventivo"), message: `${t("Eliminare il preventivo")} n. ${p.number}/${new Date(p.createdAt).getFullYear()} — ${p.name}?`, danger: true, confirmLabel: t("Elimina") })) {
      setSaved((prev) => prev.filter((x) => x.id !== p.id));
    }
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const loadQuote = (p: Preventivo) => {
    setTab("nuovo");
    setEditingId(p.id);
    setFirstName(p.name.split(" ")[0] ?? ""); setLastName(p.name.split(" ").slice(1).join(" "));
    setEmail(p.email ?? ""); setPhone(p.phone ?? "");
    setStructureId(p.structureId);
    setRoomLines(p.roomLines && p.roomLines.length ? p.roomLines : [{ roomTypeId: p.roomTypeId, qty: p.rooms ?? 1, price: p.price }]);
    setCheckIn(p.checkIn); setCheckOut(p.checkOut);
    setAdults(p.adults); setChildren(p.children);
    setChildAges(p.childAges ?? Array.from({ length: p.children }, () => 8));
    setParking(p.parking); setParkingPrice(p.parkingPrice);
    setCot(!!p.cot); setCotPrice(p.cotPrice ?? 0); setExtrasPage(p.extrasPage ?? true);
    setBreakfast(p.breakfast ?? true); setBreakfastPrice(p.breakfastPrice ?? 0); setAcconto(p.acconto ?? 50);
    setNote(p.note ?? ""); setLang(p.lang);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Righe intestazione/piè di pagina della struttura.
  const stAddress = (() => {
    const via = [structure?.address, structure?.streetNumber].filter(Boolean).join(" ");
    const citta = [[structure?.postalCode, structure?.city].filter(Boolean).join(" "), structure?.province ? `(${structure.province})` : ""].filter(Boolean).join(" ");
    return [via, citta].filter((x) => x && x.trim()).join(", ");
  })();
  const stContacts = [structure?.phone, structure?.email, structure?.website].filter(Boolean).join("  ·  ");
  const stLegal = [structure?.cin ? "CIN " + structure.cin : "", structure?.vat ? "P.IVA " + structure.vat : ""].filter(Boolean).join(" · ");
  const stSocials = ([["facebook", structure?.facebook], ["instagram", structure?.instagram], ["linkedin", structure?.linkedin]] as [string, string | undefined][])
    .filter(([, u]) => u && u.trim()).map(([k, u]) => ({ k, url: socialHref(u!) }));
  // Link pubblico "Conferma e paga": l'ospite apre, vede l'importo del preventivo e paga (Stripe).
  const payData = { s: structureName, ci: checkIn, co: checkOut, ad: adults, ch: children, rooms: roomLines.map((l) => ({ name: roomTypes.find((rt) => rt.id === l.roomTypeId)?.name ?? "Camera", amount: Math.round((l as { amount?: number; price?: number }).amount ?? ((l as { price?: number }).price ?? 0) * n) })), tot: total, dep: deposit, gn: name.trim(), ge: email.trim(), oe: structure?.email ?? "", sid: structureId, rt: roomLines[0]?.roomTypeId ?? "", ref: quoteRef, acct: structure?.stripeAccount ?? "", uid: user?.id ?? "" };
  const payUrl = (() => { try { return `${typeof window !== "undefined" ? window.location.origin : ""}/preventivo?q=${btoa(encodeURIComponent(JSON.stringify(payData)))}`; } catch { return ""; } })();
  // Accorcia il link (Supabase short_links → /g/<code>) per non mandare URL lunghissimi.
  const payShortRef = useRef<Record<string, string>>({});
  // Link pagamento CORTO: salvo il preventivo sul server (tabella quotes) e uso /preventivo?c=<codice>.
  // Così il link condiviso su WhatsApp è breve. Se il salvataggio non riesce, ripiego sullo shortener/link lungo.
  const getPayLink = async () => {
    if (!payUrl) return payUrl;
    const cached = payShortRef.current[payUrl];
    if (cached) return cached;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    try {
      if (supabase) {
        const AL = "abcdefghijkmnpqrstuvwxyz23456789";
        let code = ""; for (let i = 0; i < 7; i++) code += AL[Math.floor(Math.random() * AL.length)];
        const { error } = await supabase.from("quotes").insert({ code, data: payData });
        if (!error) { const short = `${origin}/preventivo?c=${code}`; payShortRef.current[payUrl] = short; return short; }
      }
    } catch { /* ripiego sotto */ }
    const s = await shortenLink(payUrl); payShortRef.current[payUrl] = s; return s;
  };
  const [mailState, setMailState] = useState<{ sending?: boolean; ok?: boolean; msg?: string }>({});
  // Invio del preventivo via server (Resend), come la conferma prenotazione: niente client di posta.
  const sendQuoteEmail = async () => {
    if (!email.trim()) { setMailState({ ok: false, msg: "Inserisci l'email del destinatario" }); return; }
    save();
    setMailState({ sending: true });
    try {
      const payLink = await getPayLink();
      const r = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "quote", to: email.trim(), subject: `Preventivo ${structureName}`, text: outMsg, ctaUrl: payLink, ctaLabel: "Conferma e paga online →", accent: structure?.photoColor, replyTo: structure?.email }) });
      const j = await r.json().catch(() => ({}));
      setMailState({ sending: false, ok: r.ok && j?.ok, msg: (r.ok && j?.ok) ? `Inviato a ${email.trim()}` : (j?.error || `Errore ${r.status}`) });
    } catch (e) { setMailState({ sending: false, ok: false, msg: e instanceof Error ? e.message : "Rete non disponibile" }); }
  };

  // Salvataggio in archivio (con dedup dell'ultimo identico).
  const save = () => {
    if (!name.trim()) return;
    const fields = { name: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined, structure: structureName, structureId, roomTypeId: roomLines[0]?.roomTypeId ?? "", roomLines, checkIn, checkOut, adults, children, childAges, rooms: roomsTotal, taxPersons, price: roomLines[0]?.price ?? 0, parking, parkingPrice, breakfast, breakfastPrice, cot: wantsCot, cotPrice, extrasPage: extrasPage && structExtras.length > 0, acconto, note: note.trim() || undefined, lang, total };
    // Modifica di un preventivo esistente (da "Modifica" in archivio): aggiorna in-place, niente duplicato.
    if (editingId && saved.some((p) => p.id === editingId)) {
      setSaved((prev) => prev.map((p) => (p.id === editingId ? { ...p, ...fields } : p)));
      return;
    }
    const dup = saved[0] && saved[0].name === name.trim() && saved[0].checkIn === checkIn && saved[0].checkOut === checkOut && saved[0].total === total;
    if (dup) return;
    const num = saved.filter((p) => new Date(p.createdAt).getFullYear() === curYear).reduce((m, p) => Math.max(m, p.number ?? 0), 0) + 1;
    addActivity("quote", `Preventivo n. ${num} inviato — ${name.trim()}`);
    setSaved((prev) => {
      return [{ id: crypto.randomUUID(), number: num, ...fields, createdAt: toISO(new Date()), status: "inviato" as const }, ...prev];
    });
  };

  // PDF su carta intestata (apre stampa → Salva come PDF) + salva in archivio.
  const printPdf = () => {
    save();
    const w = window.open("", "_blank", "width=820,height=1000");
    if (!w) return;
    const esc = (v: string) => (v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const L = QL[lang];
    const nWord = n === 1 ? L.notte : L.notti;
    const parkTxt = parkingPrice > 0 ? `${eur(parkingPrice)} ${L.aNotte}` : L.parkIncl;
    const bkTxt = breakfastPrice > 0 ? `${eur(breakfastPrice)} ${L.aNotte}` : L.inclusa;
    const accText = acconto === 0 ? L.accNone.replace("{tot}", eur(total)) : acconto === 100 ? L.accFull.replace("{tot}", eur(total)) : L.accPart.replace("{dep}", eur(deposit)).replace("{bal}", eur(balance)).replace("{pct}", String(acconto));
    const causale = `${(name || "").trim()} ${fmt(checkIn)}-${fmt(checkOut)}`.trim();
    const accent = structure?.photoColor || "#BE5D38";
    const logoHtml = structure?.logo
      ? `<img src="${structure.logo}" alt="" class="logoimg">`
      : `<div class="logo" style="background:${accent}">${esc((structureName || "S").slice(0, 1).toUpperCase())}</div>`;

    const dmy = (iso: string) => { try { return parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }); } catch { return iso; } };
    const periodCards = ([[L.ci, dmy(checkIn)], [L.co, dmy(checkOut)], [L.durata, `${n} ${nWord}`]] as [string, string][])
      .map(([k, v]) => `<div class="pc"><div class="pk">${esc(k)}</div><div class="pv">${esc(v)}</div></div>`).join("");
    const sumRows: string[] = mergedLines.map((l) => `<tr><td>${l.qty} ${esc(rtName(l.roomTypeId) || L.room)} <span class="mut">· ${eur(l.price)} ${esc(L.aNotte)} × ${n} ${nWord}</span></td><td class="r"><b>${eur(l.qty * l.price * n)}</b></td></tr>`);
    if (breakfast) sumRows.push(`<tr><td>${esc(L.colazione)}</td><td class="r mut">${esc(bkTxt)}</td></tr>`);
    if (parking) sumRows.push(`<tr><td>${esc(L.parcheggio)}</td><td class="r mut">${esc(parkTxt)}</td></tr>`);
    if (wantsCot) sumRows.push(`<tr><td>${esc(L.culla)}</td><td class="r mut">${esc(L.cullaIncl)}</td></tr>`);
    sumRows.push(`<tr><td>${esc(L.tassa)} <span class="mut">(${taxPersons} ${esc(L.persone)})</span></td><td class="r">${eur(cityTax)}</td></tr>`);
    const payHtml = (docHolder || docIban)
      ? `<div class="pay"><div class="payt">${esc(L.modalita)}</div>${docHolder ? `<div>${esc(L.intest)}: <b>${esc(docHolder)}</b></div>` : ""}${docIban ? `<div>IBAN: <span class="mono">${esc(docIban)}</span></div>` : ""}<div class="mut">${esc(L.causale)}: ${esc(causale)}</div>${payExtra ? `<div class="mut">${esc(payExtra)}</div>` : ""}</div>`
      : (payExtra ? `<div class="pay"><div class="mut">${esc(payExtra)}</div></div>` : "");

    // 2ª pagina: catalogo servizi extra (se attiva e se la struttura ne ha).
    const extrasRows = structExtras.map((e) => `<tr><td><b>${esc(e.name)}</b>${e.desc ? `<div class="mut" style="font-weight:400;margin-top:2px">${esc(e.desc)}</div>` : ""}</td><td class="r"><b>${eur(e.price)}</b> <span class="mut">${esc(perLabel(e.per, L))}</span></td></tr>`).join("");
    const extrasHtml = (extrasPage && structExtras.length)
      ? `<div class="sheet page2"><div class="bar"></div>
<div class="head">${logoHtml}<div style="min-width:0"><div class="brand">${esc(structureName || "Xenora")}</div>${stAddress ? `<div class="sub">${esc(stAddress)}</div>` : ""}${stContacts ? `<div class="sub" style="margin-top:1px">${esc(stContacts)}</div>` : ""}</div>
<div class="qbadge"><div class="qlabel">${esc(L.quoteNo)}</div><div class="qno">${quoteRef}</div><div class="qdate">${todayStr}</div></div></div>
<h2>${esc(L.extrasTitle)}</h2>
<p class="lead">${esc(L.extrasIntro)}</p>
<table>${extrasRows}</table>
<p class="note">${esc(L.extrasNote)}</p>
<div class="foot"><span>${[esc(structureName || "Xenora"), esc(stAddress), esc(stContacts), esc(stLegal)].filter(Boolean).join("  ·  ")}</span><span class="social">${stSocials.map((s) => `<a href="${esc(s.url)}"><svg viewBox="0 0 24 24" width="15" height="15" fill="#fff"><path d="${SOCIAL_PATH[s.k]}"/></svg></a>`).join("")}${stSocials.length ? "" : todayStr}</span></div>
</div>`
      : "";

    const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Preventivo ${esc(structureName)} · n.${quoteRef}</title><style>
@page{size:A4;margin:0}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;padding:0;background:#f1efec}
body{font-family:'Helvetica Neue',Arial,Helvetica,sans-serif;color:#2b2b2b;font-size:12.5px;line-height:1.5}
.sheet{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:20mm 18mm 16mm;position:relative}
.page2{page-break-before:always}
.bar{position:absolute;top:0;left:0;right:0;height:7px;background:${accent}}
.head{display:flex;align-items:center;gap:16px;border-bottom:1px solid #ece7df;padding-bottom:18px}
.logo{width:60px;height:60px;border-radius:14px;color:#fff;font-weight:800;font-size:30px;display:flex;align-items:center;justify-content:center}
.logoimg{width:60px;height:60px;object-fit:contain;border-radius:14px;background:#fff;border:1px solid #ece7df}
.brand{font-size:24px;font-weight:800;letter-spacing:-.4px}
.sub{color:#726b62;font-size:11.5px;margin-top:3px}
.qbadge{margin-left:auto;text-align:right}
.qlabel{font-size:9.5px;letter-spacing:.14em;color:#726b62;text-transform:uppercase;font-weight:700}
.qno{font-size:20px;font-weight:800;color:${accent}}
.qdate{font-size:11px;color:#726b62}
h2{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#9a9186;font-weight:700;margin:26px 0 10px}
.hi{font-size:15px;margin:22px 0 4px}
.lead{color:#726b62;margin:0 0 4px;font-size:12.5px}
.period{display:flex;gap:12px;margin-top:6px}
.pc{flex:1;border:1px solid #ece7df;border-radius:10px;padding:11px 13px}
.pk{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:#9a9186;font-weight:700}
.pv{font-size:15px;font-weight:700;margin-top:3px;white-space:nowrap}
table{width:100%;border-collapse:collapse}
td{padding:9px 2px;border-bottom:1px solid #f0ebe3;font-size:13px}
td.r{text-align:right;white-space:nowrap}
.mut{color:#9a9186;font-weight:400}
.total{display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding:14px 16px;border-radius:10px;background:${accent}14}
.total .tl{font-size:12px;font-weight:700;letter-spacing:.04em}
.total .tv{font-size:20px;font-weight:800;color:${accent}}
.cond{font-size:12.5px;line-height:1.55;margin:2px 0}
.canc{color:#726b62;font-size:12px;margin:4px 0 0}
.pay{margin-top:12px;border:1px solid #ece7df;border-radius:10px;padding:11px 13px;font-size:12.5px;line-height:1.7}
.payt{font-weight:700;margin-bottom:2px}
.mono{font-family:'Courier New',monospace}
.note{margin-top:14px;font-style:italic;color:#726b62;font-size:12px}
.closing{margin-top:20px;font-size:13px}
.sign{margin-top:2px;font-weight:700}
.foot{position:absolute;left:18mm;right:18mm;bottom:12mm;border-top:1px solid #ece7df;padding-top:10px;color:#b3a99c;font-size:10px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px}
.social{display:flex;gap:6px;flex:none}
.social a{width:24px;height:24px;border-radius:99px;background:${accent};display:flex;align-items:center;justify-content:center;text-decoration:none}
</style></head><body><div class="sheet"><div class="bar"></div>
<div class="head">${logoHtml}<div style="min-width:0"><div class="brand">${esc(structureName || "Xenora")}</div>${stAddress ? `<div class="sub">${esc(stAddress)}</div>` : ""}${stContacts ? `<div class="sub" style="margin-top:1px">${esc(stContacts)}</div>` : ""}</div>
<div class="qbadge"><div class="qlabel">${esc(L.quoteNo)}</div><div class="qno">${quoteRef}</div><div class="qdate">${todayStr}</div></div></div>
<p class="hi">${esc(L.hi)} <b>${esc(name || L.guest)}</b>,</p>
<p class="lead">${esc(L.avail)}.</p>
<h2>${esc(L.periodo)}</h2>
<div class="period">${periodCards}</div>
<h2>${esc(L.riepilogo)}</h2>
<table>${sumRows.join("")}</table>
<div class="total"><span class="tl">${esc(L.totale)}</span><span class="tv">${eur(total)}</span></div>
<h2>${esc(L.condizioni)}</h2>
<p class="cond">${esc(accText)}</p>
<p class="canc">${esc(L.cancLabel)}: ${esc(L.cancText)}</p>
${payHtml}
${note ? `<p class="note">${esc(note)}</p>` : ""}
<p class="closing">${esc(L.closing)}</p>
<p class="sign">${esc(structureName)}</p>
<div class="foot"><span>${[esc(structureName || "Xenora"), esc(stAddress), esc(stContacts), esc(stLegal)].filter(Boolean).join("  ·  ")}</span><span class="social">${stSocials.map((s) => `<a href="${esc(s.url)}"><svg viewBox="0 0 24 24" width="15" height="15" fill="#fff"><path d="${SOCIAL_PATH[s.k]}"/></svg></a>`).join("")}${stSocials.length ? "" : todayStr}</span></div>
</div>${extrasHtml}</body></html>`;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  };

  // ── Conferma prenotazione dal preventivo (con anticipo 0/50/100%) ──
  const [confirming, setConfirming] = useState<{ q: Preventivo; pct: number } | null>(null);
  const [confMail, setConfMail] = useState<{ ok?: boolean; sending?: boolean; msg?: string }>({});
  const CONF: Record<Lang, { hi: string; ok: string; struct: string; ci: string; co: string; nt: string; pax: string; tot: string; pay: string; dep: string; bal: string; atc: string; none: string; full: string; bye: string }> = {
    it: { hi: "Gentile", ok: "la sua prenotazione è confermata! ✅", struct: "Struttura", ci: "Check-in", co: "Check-out", nt: "Notti", pax: "Ospiti", tot: "Totale", pay: "Pagamento", dep: "Anticipo", bal: "Saldo", atc: "al check-in", none: "Nessun anticipo · saldo di", full: "Importo intero da versare", bye: "La aspettiamo!" },
    en: { hi: "Dear", ok: "your booking is confirmed! ✅", struct: "Property", ci: "Check-in", co: "Check-out", nt: "Nights", pax: "Guests", tot: "Total", pay: "Payment", dep: "Deposit", bal: "Balance", atc: "at check-in", none: "No deposit · balance of", full: "Full amount to be paid", bye: "See you soon!" },
    fr: { hi: "Cher/Chère", ok: "votre réservation est confirmée ! ✅", struct: "Logement", ci: "Arrivée", co: "Départ", nt: "Nuits", pax: "Personnes", tot: "Total", pay: "Paiement", dep: "Acompte", bal: "Solde", atc: "à l'arrivée", none: "Pas d'acompte · solde de", full: "Montant total à régler", bye: "À bientôt !" },
    de: { hi: "Liebe/r", ok: "Ihre Buchung ist bestätigt! ✅", struct: "Unterkunft", ci: "Anreise", co: "Abreise", nt: "Nächte", pax: "Gäste", tot: "Gesamt", pay: "Zahlung", dep: "Anzahlung", bal: "Restbetrag", atc: "bei Anreise", none: "Keine Anzahlung · Restbetrag von", full: "Gesamtbetrag zu zahlen", bye: "Bis bald!" },
    es: { hi: "Estimado/a", ok: "¡tu reserva está confirmada! ✅", struct: "Alojamiento", ci: "Entrada", co: "Salida", nt: "Noches", pax: "Huéspedes", tot: "Total", pay: "Pago", dep: "Anticipo", bal: "Saldo", atc: "en la entrada", none: "Sin anticipo · saldo de", full: "Importe total a pagar", bye: "¡Hasta pronto!" },
  };
  const buildConfirm = (q: Preventivo, pct: number) => {
    const L = CONF[q.lang]; const nn = nights(q.checkIn, q.checkOut);
    const deposit = Math.round(q.total * pct / 100); const balance = q.total - deposit;
    let pay: string;
    if (pct === 0) pay = `${L.none} ${eur(q.total)} ${L.atc}`;
    else if (pct === 100) pay = `${L.full}: ${eur(q.total)}`;
    else pay = `• ${L.dep} (${pct}%): ${eur(deposit)}\n• ${L.bal}: ${eur(balance)} ${L.atc}`;
    return `${L.hi} ${q.name},\n${L.ok}\n\n• ${L.struct}: ${q.structure}\n• ${L.ci}: ${fmt(q.checkIn)}\n• ${L.co}: ${fmt(q.checkOut)}\n• ${L.nt}: ${nn}\n• ${L.pax}: ${q.adults}${q.children ? ` + ${q.children}` : ""}\n• ${L.tot}: ${eur(q.total)}\n\n${L.pay}:\n${pay}\n\n${L.bye}`;
  };
  const confirmBooking = (collectDeposit: boolean) => {
    if (!confirming) return;
    const { q, pct } = confirming;
    // Evita doppioni in anagrafica: riusa un ospite esistente (stessa email, oppure stesso nome con
    // telefono compatibile) così resta una sola voce con lo storico delle prenotazioni.
    const norm = (s?: string) => (s ?? "").trim().toLowerCase();
    const fn = q.name.split(" ")[0], ln = q.name.split(" ").slice(1).join(" ");
    const found = guests.find((g) => {
      if (norm(q.email) && norm(g.email) === norm(q.email)) return true;
      if (norm(q.name) && norm(g.fullName) === norm(q.name) && (!norm(g.phone) || !norm(q.phone) || norm(g.phone) === norm(q.phone))) return true;
      return false;
    });
    let gid: string;
    if (found) {
      gid = found.id;
      updateGuest(found.id, { fullName: found.fullName || q.name, firstName: found.firstName || fn, lastName: found.lastName || ln, email: found.email || q.email || undefined, phone: found.phone || q.phone || undefined });
    } else {
      gid = addGuest({ fullName: q.name, firstName: fn, lastName: ln, email: q.email, phone: q.phone });
    }
    // Espande le righe camera in singole prenotazioni (fallback alla vecchia struttura a camera singola).
    const lines = (q.roomLines && q.roomLines.length) ? q.roomLines : [{ roomTypeId: q.roomTypeId, qty: q.rooms ?? 1, price: q.price }];
    const nn = Math.max(1, nights(q.checkIn, q.checkOut));
    // Ogni camera porta il SUO prezzo × notti (non si divide il totale in parti uguali).
    const flat: { roomTypeId: string; amount: number }[] = [];
    lines.forEach((l) => { for (let k = 0; k < Math.max(1, l.qty); k++) flat.push({ roomTypeId: l.roomTypeId, amount: Math.round(l.price * nn) }); });
    const nRooms = Math.max(1, flat.length);
    // Più camere → prenotazione di gruppo: N prenotazioni collegate dallo stesso groupId.
    const groupId = nRooms > 1 ? ((typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())) : undefined;
    const dist = (tot: number, i: number) => Math.floor(tot / nRooms) + (i < tot % nRooms ? 1 : 0);
    // Assegnazione automatica della camera: se c'è una unità libera della tipologia per quelle date, la assegno
    // (calendario "vuoto"); se non ce n'è (servirebbero spostamenti), lascio da assegnare (unitId null).
    const usedUnitIds = new Set<string>();
    const freeUnitFor = (roomTypeId: string): string | null => {
      const u = units.find((x) => x.roomTypeId === roomTypeId && !x.outOfService && !usedUnitIds.has(x.id)
        && !bookings.some((b) => b.status !== "cancelled" && b.unitId === x.id && b.checkIn < q.checkOut && b.checkOut > q.checkIn));
      if (u) { usedUnitIds.add(u.id); return u.id; }
      return null;
    };
    let ci = 0;
    flat.forEach((r, i) => {
      const kidCount = nRooms > 1 ? dist(q.children, i) : q.children;
      const ages = (q.childAges ?? []).slice(ci, ci + kidCount); ci += kidCount;
      addBooking({ groupId, structureId: q.structureId, roomTypeId: r.roomTypeId, unitId: freeUnitFor(r.roomTypeId), guestId: gid, channel: "direct", status: "confirmed", checkIn: q.checkIn, checkOut: q.checkOut, adults: nRooms > 1 ? dist(q.adults, i) : q.adults, children: kidCount, childAges: ages.length ? ages : undefined, total: r.amount, cleaningFee: 0, paid: collectDeposit ? Math.round(r.amount * pct / 100) : 0 });
    });
    setSaved((prev) => prev.map((x) => (x.id === q.id ? { ...x, status: "confermato" as const } : x)));
    setConfirming((c) => (c ? { ...c, q: { ...c.q, status: "confermato" } } : c));
  };

  const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  return (
    <div>
      <PageHeader title={t("Preventivi")} subtitle={t("Crea un preventivo e invialo su WhatsApp o via email")} />

      {/* Sezioni: Nuovo preventivo · Archivio */}
      <div className="mb-4 inline-flex rounded-lg border border-line bg-surface p-0.5">
        <button onClick={() => setTab("nuovo")} className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === "nuovo" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{t("Nuovo preventivo")}</button>
        <button onClick={() => setTab("archivio")} className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === "archivio" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{t("Archivio")} {saved.length > 0 ? `(${saved.length})` : ""}</button>
      </div>

      {tab === "nuovo" && (
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* Form */}
        <Card>
          <SectionTitle>{t("Dati preventivo")}</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("Cognome *")}><input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inp} placeholder={t("Cognome")} /></Field>
            <Field label={t("Nome")}><input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inp} placeholder={t("Nome")} /></Field>
            <Field label={t("Email")}><input value={email} onChange={(e) => setEmail(e.target.value)} className={inp} placeholder={t("opzionale")} /></Field>
            <Field label={t("Telefono")}><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inp} placeholder="+39…" /></Field>
            {structures.length > 1 && (
              <Field label={t("Struttura")}>
                <select value={structureId} onChange={(e) => { const sid = e.target.value; setStructureId(sid); const rt0 = roomTypes.find((r) => r.structureId === sid); setRoomLines(rt0 ? [{ roomTypeId: rt0.id, qty: 1, price: autoPrice(rt0.id) }] : []); }} className={inp}>
                  {structures.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
              </Field>
            )}
            {structures.length > 1 && <div className="hidden sm:block" />}
            <Field label={t("Check-in")}><input type="date" value={checkIn} onChange={(e) => { setCheckIn(e.target.value); if (e.target.value >= checkOut) setCheckOut(shiftISO(e.target.value, 1)); }} className={inp} /></Field>
            <Field label={t("Check-out")}><input type="date" value={checkOut} min={shiftISO(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} className={inp} /></Field>
            <Field label={t("Adulti")}><input type="number" min={1} value={adults} onChange={(e) => setAdults(Math.max(1, Number(e.target.value)))} className={inp} /></Field>
            <Field label={t("Bambini")}><input type="number" min={0} value={children} onChange={(e) => { const v = Math.max(0, Number(e.target.value)); setChildren(v); setChildAges((prev) => { const next = prev.slice(0, v); while (next.length < v) next.push(8); return next; }); }} className={inp} /></Field>
            {children > 0 && (
              <div className="sm:col-span-2">
                <div className="mb-1 text-xs font-medium text-dim">{t("Età dei bambini")} <span className="font-normal text-faint">({t("sotto i 15 anni esenti dalla tassa")})</span></div>
                <div className="flex flex-wrap gap-2">
                  {childAges.map((age, i) => (
                    <div key={i} className="flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1.5">
                      <span className="text-[11px] text-faint">{t("Bimbo")} {i + 1}</span>
                      <input type="number" min={0} max={17} value={age} onChange={(e) => setChildAges((prev) => prev.map((a, j) => (j === i ? Math.max(0, Math.min(17, Number(e.target.value))) : a)))} className="w-14 rounded border border-line bg-surface px-1.5 py-0.5 text-sm text-txt outline-none focus:border-focus" />
                      <span className="text-[10px] font-semibold" style={{ color: age >= 15 ? "var(--warn)" : "var(--ok)" }}>{age >= 15 ? t("paga") : t("esente")}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1.5">
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={cot} onChange={(e) => setCot(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" /><span className="text-[11px] text-faint">{t("Culla")}</span></label>
                    {cot && <span className="text-[10px] font-semibold text-[color:var(--ok)]">{t("gratis")}</span>}
                  </div>
                </div>
              </div>
            )}
            <div className="sm:col-span-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-sm">
              <span className="text-dim">{t("Persone soggette a tassa")} <span className="text-faint">({t("automatico")})</span></span>
              <b className="ml-auto font-mono text-txt">{taxPersons}</b>
              <span className="text-[11px] text-faint">= {adults} {t("adulti")}{taxKids > 0 ? ` + ${taxKids} ${t("bambini ≥15")}` : ""}</span>
            </div>

            {/* Piano tariffario: applica lo scarto al prezzo del calendario */}
            {plans.filter((p) => p.enabled !== false).length > 0 && (
              <div className="sm:col-span-2">
                <div className="mb-1 text-xs font-medium text-dim">{t("Piano tariffario")} <span className="font-normal text-faint">({t("parte dal prezzo del calendario")})</span></div>
                <div className="flex flex-wrap gap-2">
                  {plans.filter((p) => planApplies(p, { checkIn, nights: n })).map((p) => {
                    const on = p.id === planId;
                    return (
                      <button key={p.id} type="button" onClick={() => { setPlanId(p.id); setAcconto(planDepositPct(p)); }} className={`rounded-lg border px-3 py-1.5 text-sm transition ${on ? "font-semibold" : "text-dim hover:bg-wash"}`} style={on ? { borderColor: "var(--focus)", backgroundColor: "color-mix(in srgb, var(--focus) 8%, transparent)", color: "var(--focus)" } : { borderColor: "var(--line)" }}>
                        {p.name}{p.adjPct !== 0 && <span className="ml-1 text-[11px] font-bold">{p.adjPct > 0 ? "+" : ""}{p.adjPct}%</span>}
                      </button>
                    );
                  })}
                </div>
                {activePlan && (
                  <p className="mt-1 text-[11px] text-faint">{t(activePlan.board)} · {cancelText(activePlan)}{activePlan.minStay > 1 ? ` · ${t("min")} ${activePlan.minStay} ${t("notti")}` : ""} · {planDepositPct(activePlan) === 0 ? t("nessun anticipo") : planDepositPct(activePlan) === 100 ? t("prepagato") : `${t("acconto")} ${planDepositPct(activePlan)}%`}</p>
                )}
              </div>
            )}

            {/* Camere del preventivo — multi-camera con disponibilità reale nel periodo */}
            <div className="sm:col-span-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-faint">{t("Camere del preventivo")} · {roomsTotal}</span>
                <button type="button" onClick={addLine} className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash">+ {t("Aggiungi camera")}</button>
              </div>
              <div className="space-y-2">
                {roomLines.map((l, i) => { const av = datesOk ? availOf(l.roomTypeId) : null; const soldout = av === 0; return (
                  <div key={i} className="rounded-lg border border-line bg-paper p-2.5">
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="min-w-[8rem] flex-1 text-[11px] font-medium text-dim">{t("Tipologia")}
                        <select value={l.roomTypeId} onChange={(e) => updateLine(i, { roomTypeId: e.target.value, price: autoPrice(e.target.value) })} className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus">
                          {typesOf.map((rt2) => (<option key={rt2.id} value={rt2.id}>{rt2.name}</option>))}
                        </select>
                      </label>
                      <label className="w-14 text-[11px] font-medium text-dim">{t("Q.tà")}
                        <input type="number" min={1} value={l.qty} onChange={(e) => updateLine(i, { qty: Math.max(1, Number(e.target.value)) })} className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt outline-none focus:border-focus" />
                      </label>
                      <label className="w-24 text-[11px] font-medium text-dim">{t("€/notte")}
                        <input type="number" min={0} value={l.price} onChange={(e) => updateLine(i, { price: Math.max(0, Number(e.target.value)) })} className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt outline-none focus:border-focus" />
                      </label>
                      {roomLines.length > 1 && <button type="button" onClick={() => removeLine(i)} title={t("Rimuovi")} className="pb-1.5 text-faint hover:text-[color:var(--err)]">✕</button>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                      {av === null ? <span className="text-faint">{t("Imposta le date per vedere la disponibilità")}</span>
                        : soldout ? <span className="inline-block rounded-full px-2 py-0.5 font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--err) 14%, transparent)", color: "var(--err)" }}>{t("Esaurita nel periodo")}</span>
                        : <span className="inline-block rounded-full px-2 py-0.5 font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 15%, transparent)", color: "var(--ok)" }}>✓ {av} {av === 1 ? t("disponibile") : t("disponibili")}</span>}
                      {av !== null && !soldout && l.qty > av && <span className="rounded-full px-2 py-0.5 font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{t("richieste")} {l.qty} · {t("solo")} {av} {t("disp.")}</span>}
                      <span className="ml-auto text-dim">{t("Subtotale")}: <b className="text-txt">{eur(l.qty * l.price * n)}</b></span>
                    </div>
                  </div>
                ); })}
              </div>
            </div>
            <Field label={`${t("Totale complessivo")} (${n} ${t("notti")})`}><div className="rounded-lg bg-wash px-3 py-2 font-mono text-sm font-bold text-txt">{eur(total)}</div></Field>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-4 rounded-lg border border-line bg-paper px-3 py-2">
              <label className="flex items-center gap-2 text-sm font-medium text-txt"><input type="checkbox" checked={parking} onChange={(e) => setParking(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" /> {t("Parcheggio")}</label>
              {parking && (
                <label className="flex items-center gap-2 text-xs text-dim">{t("€/notte (0 = incluso)")}
                  <input type="number" min={0} value={parkingPrice} onChange={(e) => setParkingPrice(Number(e.target.value))} className="w-20 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus" />
                </label>
              )}
              <label className="ml-auto flex items-center gap-2 text-sm font-medium text-txt"><input type="checkbox" checked={breakfast} onChange={(e) => setBreakfast(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" /> {t("Colazione")}</label>
              {breakfast && (
                <label className="flex items-center gap-2 text-xs text-dim">{t("€/notte (0 = inclusa)")}
                  <input type="number" min={0} value={breakfastPrice} onChange={(e) => setBreakfastPrice(Number(e.target.value))} className="w-20 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus" />
                </label>
              )}
            </div>
            {structExtras.length > 0 && (
              <label className="sm:col-span-2 flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-sm font-medium text-txt">
                <input type="checkbox" checked={extrasPage} onChange={(e) => setExtrasPage(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" />
                {t("Includi 2ª pagina: servizi extra")} <span className="font-normal text-faint">({structExtras.length})</span>
              </label>
            )}
            <div className="sm:col-span-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-dim">{t("Acconto per confermare")}</span>
                <span className="text-[11px] text-faint">{acconto > 0 && acconto < 100 ? `${eur(deposit)} ${t("ora")} · ${eur(balance)} ${t("al check-in")}` : ""}</span>
              </div>
              <div className="flex items-center rounded-lg border border-line p-0.5">
                {([[0, t("Nessuno")], [structPct, `${structPct}% (${t("saldo prima")})`], [100, "100%"]] as [number, string][]).map(([v, lab]) => (
                  <button key={v} onClick={() => setAcconto(v)} className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${acconto === v ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{lab}</button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2 rounded-lg border border-line bg-paper p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{t("Dati di pagamento")}</div>
              {(structure?.iban || structure?.ibanHolder) ? (
                <div className="rounded-lg border border-line bg-wash p-2.5 text-xs text-dim">
                  <div className="mb-0.5 font-semibold text-txt">{t("IBAN dalla scheda struttura")}</div>
                  {structure?.ibanHolder && <div>{t("Intestatario:")} <b className="text-txt">{structure.ibanHolder}</b></div>}
                  {structure?.iban && <div>IBAN: <span className="font-mono text-txt">{structure.iban}</span></div>}
                  <div className="mt-1 text-[11px] text-faint">{t("Usato in automatico sul preventivo. Cambialo nella")} <span className="text-focus">{t("scheda struttura")}</span>.</div>
                </div>
              ) : (
                <>
                  <div className="mb-2 text-[11px] text-faint">{t("Nessun IBAN sulla struttura: inserisci qui i dati (salvati nel browser). Suggerito: impostarlo nella scheda struttura.")}</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Field label={t("Intestatario")}><input value={payHolder} onChange={(e) => setPayHolder(e.target.value)} className={inp} placeholder={t("Nome Cognome")} /></Field>
                    <Field label="IBAN"><input value={payIban} onChange={(e) => setPayIban(e.target.value)} className={inp} placeholder="IT…" /></Field>
                  </div>
                </>
              )}
              <div className="mt-2"><Field label={t("Altri metodi (facoltativo)")}><input value={payExtra} onChange={(e) => setPayExtra(e.target.value)} className={inp} /></Field></div>
            </div>
            <div className="sm:col-span-2"><Field label={t("Note (opzionale)")}><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={`${inp} resize-none`} placeholder={t("Es. offerta valida 3 giorni, richieste particolari…")} /></Field></div>
          </div>
        </Card>

        {/* Anteprima PDF + invio */}
        <Card className="flex h-full flex-col">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>{t("Anteprima PDF")}</SectionTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-lg border border-line bg-paper p-0.5">
                {LANGS.map(([l, nm]) => (
                  <button key={l} onClick={() => setLang(l)} title={nm} aria-label={nm} className={`rounded-md px-1.5 py-1 text-lg leading-none transition ${lang === l ? "scale-110 bg-wash ring-1 ring-[color:var(--focus)]" : "opacity-45 grayscale hover:opacity-90 hover:grayscale-0"}`}>{FLAG[l]}</button>
                ))}
              </div>
              {(extrasPage && structExtras.length > 0) && (
                <div className="flex items-center gap-1 rounded-lg border border-line bg-paper p-0.5">
                  <button onClick={() => flipTo(0)} disabled={previewPage === 0} title={t("Pagina precedente")} className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-wash disabled:opacity-30">‹</button>
                  <span className="px-1 text-xs font-semibold text-txt">{t("Pag.")} {previewPage + 1}<span className="text-faint">/2</span></span>
                  <button onClick={() => flipTo(1)} disabled={previewPage === 1} title={t("Pagina successiva")} className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-wash disabled:opacity-30">›</button>
                </div>
              )}
            </div>
          </div>
          <div ref={previewRef} className="flex-1 overflow-y-auto overflow-x-hidden rounded-lg border border-line bg-wash p-2" style={{ minHeight: 340 }}>
            <style>{`@keyframes qpSlideNext{from{transform:translateX(34px);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes qpSlidePrev{from{transform:translateX(-34px);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
            <div key={previewPage} style={{ animation: `${flipDir >= 0 ? "qpSlideNext" : "qpSlidePrev"} .8s cubic-bezier(.2,.7,.3,1)` }}>
            <QuoteDoc scale={pw / 794} page={(extrasPage && structExtras.length > 0) ? previewPage : 0}
              accent={structure?.photoColor || "#BE5D38"} logo={structure?.logo}
              structureName={structureName} address={stAddress} contacts={stContacts} legal={stLegal} socials={stSocials}
              L={QL[lang]} quoteNo={quoteRef} date={todayStr} guest={name}
              checkIn={fmt(checkIn)} checkOut={fmt(checkOut)} nights={n} nWord={n === 1 ? QL[lang].notte : QL[lang].notti}
              roomLines={mergedLines.map((l) => ({ label: `${l.qty} ${rtName(l.roomTypeId) || QL[lang].room}`, sub: `${eur(l.price)} ${QL[lang].aNotte} × ${n} ${n === 1 ? QL[lang].notte : QL[lang].notti}`, amount: eur(l.qty * l.price * n) }))}
              breakfast={breakfast} breakfastText={breakfastPrice > 0 ? `${eur(breakfastPrice)} ${QL[lang].aNotte}` : QL[lang].inclusa} parking={parking} parkText={parkingPrice > 0 ? `${eur(parkingPrice)} ${QL[lang].aNotte}` : QL[lang].parkIncl}
              cot={wantsCot} cotText={QL[lang].cullaIncl}
              extras={extrasPage ? structExtras.map((e) => ({ name: e.name, desc: e.desc, price: eur(e.price), per: perLabel(e.per, QL[lang]) })) : []} extrasTitle={QL[lang].extrasTitle} extrasNote={QL[lang].extrasNote}
              cityTax={eur(cityTax)} taxPersons={taxPersons} total={eur(total)}
              accText={acconto === 0 ? QL[lang].accNone.replace("{tot}", eur(total)) : acconto === 100 ? QL[lang].accFull.replace("{tot}", eur(total)) : QL[lang].accPart.replace("{dep}", eur(deposit)).replace("{bal}", eur(balance)).replace("{pct}", String(acconto))}
              payHolder={docHolder} payIban={docIban} payExtra={payExtra}
              causale={`${(name || "").trim()} ${fmt(checkIn)}-${fmt(checkOut)}`.trim()} note={note}
            />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={sendQuoteEmail} disabled={mailState.sending} className="flex items-center gap-1.5 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"><Icon name="mail" size={15} /> {mailState.sending ? t("Invio…") : t("Invia via email")}</button>
            <button onClick={printPdf} title={t("Scarica il preventivo in PDF")} aria-label={t("Scarica PDF")} className="grid h-9 w-9 place-items-center rounded-lg border border-line text-dim transition hover:bg-wash hover:text-txt"><Icon name="fileText" size={16} /></button>
            {(mailState.sending || mailState.msg) && <span className={`text-xs ${mailState.sending ? "text-dim" : mailState.ok ? "text-[color:var(--ok)]" : "text-[color:var(--err)]"}`}>{mailState.sending ? t("Invio…") : (mailState.ok ? "✓ " : "⚠ ") + mailState.msg}</span>}
          </div>
        </Card>
      </div>
      )}

      {/* Archivio */}
      {tab === "archivio" && saved.length === 0 && (
        <Card><div className="py-12 text-center text-sm text-faint">{t("Nessun preventivo in archivio.")}<br />{t("Crea e invia un preventivo per ritrovarlo qui.")}</div></Card>
      )}
      {tab === "archivio" && saved.length > 0 && (
        <div>
          <SectionTitle>{t("Preventivi salvati")} ({saved.length})</SectionTitle>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-3 py-2 font-semibold">{t("N°")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Data")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Ospite")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Struttura")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Check-in")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Check-out")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Notti")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Totale")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Stato")}</th>
                  <th className="px-3 py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {saved.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5 font-mono font-semibold text-txt">{p.number ? `${p.number}/${new Date(p.createdAt).getFullYear()}` : "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-dim">{fmt(p.createdAt)}</td>
                    <td className="px-3 py-2.5 font-medium text-txt">{p.name}</td>
                    <td className="px-3 py-2.5 text-dim">{p.structure}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-dim">{fmt(p.checkIn)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-dim">{fmt(p.checkOut)}</td>
                    <td className="px-3 py-2.5 font-mono text-dim">{nights(p.checkIn, p.checkOut)}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-txt">{eur(p.total)}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: p.status === "confermato" ? "var(--ok)" : "var(--warn)" }}>
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.status === "confermato" ? "var(--ok)" : "var(--warn)" }} />
                        {p.status === "confermato" ? t("Confermato") : t("Inviato")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => loadQuote(p)} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-dim hover:bg-wash hover:text-txt">{t("Modifica")}</button>
                        {p.status === "confermato"
                          ? <span className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold text-[color:var(--ok)]" style={{ borderColor: "color-mix(in srgb, var(--ok) 40%, var(--line))", backgroundColor: "color-mix(in srgb, var(--ok) 10%, transparent)" }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>{t("Prenotazione creata")}</span>
                          : <button onClick={() => { setConfMail({}); setConfirming({ q: p, pct: 50 }); }} className="rounded-md bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">{t("Conferma")}</button>}
                        <button onClick={() => delQuote(p)} title={t("Elimina preventivo")} aria-label={t("Elimina preventivo")} className="rounded-md border border-line px-2 py-1.5 text-xs font-medium text-[color:var(--err)] hover:bg-wash">✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modale conferma prenotazione dal preventivo */}
      {confirming && (() => {
        const { q, pct } = confirming;
        const deposit = Math.round(q.total * pct / 100);
        const balance = q.total - deposit;
        const confMsg = buildConfirm(q, pct);
        const digits = (q.phone ?? "").replace(/\D/g, "");
        const wa = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(confMsg)}` : "#";
        const mail = `mailto:${q.email ?? ""}?subject=${encodeURIComponent("Conferma prenotazione — " + q.structure)}&body=${encodeURIComponent(confMsg)}`;
        const confirmed = q.status === "confermato";
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[6vh]">
            <button aria-label={t("Chiudi")} onClick={() => setConfirming(null)} className="absolute inset-0 bg-black/40" />
            <div className="relative w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-display text-lg font-bold text-txt">{t("Conferma prenotazione")}</span>
                <button onClick={() => setConfirming(null)} className="rounded px-2 py-1 text-dim hover:bg-wash hover:text-txt">✕</button>
              </div>
              <div className="mb-3 text-sm text-dim">{q.name} · {q.structure} · <span className="font-mono">{fmt(q.checkIn)} → {fmt(q.checkOut)}</span> · <b className="text-txt">{eur(q.total)}</b></div>

              <div className="text-xs font-medium text-dim">{t("Anticipo")}</div>
              <div className="mt-1 flex items-center rounded-lg border border-line p-0.5">
                {[0, 50, 100].map((v) => (
                  <button key={v} onClick={() => setConfirming({ q, pct: v })} className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${pct === v ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{v}%</button>
                ))}
              </div>
              <div className="mt-3 rounded-lg border border-line bg-paper p-3 text-sm">
                <div className="flex justify-between"><span className="text-dim">{t("Anticipo")} ({pct}%)</span><span className="font-mono font-semibold text-txt">{eur(deposit)}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-dim">{t("Saldo al check-in")}</span><span className="font-mono text-txt">{eur(balance)}</span></div>
              </div>

              <div className="mt-3 text-xs font-medium text-dim">{t("Messaggio di conferma")} ({LANGS.find(([l]) => l === q.lang)?.[1]})</div>
              <textarea readOnly value={confMsg} rows={9} className="mt-1 w-full resize-none rounded-lg border border-line bg-paper p-3 text-xs text-txt" />

              {confirmed && (
                <div className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-[color:var(--ok)]" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)" }}>{t("Prenotazione creata")} ✓ — {t("invia la conferma all'ospite:")}</div>
              )}

              <div className="mt-3 flex flex-nowrap items-center gap-1.5">
                {!confirmed && <button onClick={() => confirmBooking(false)} className="whitespace-nowrap rounded-lg bg-focus px-2.5 py-2 text-xs font-semibold text-white hover:opacity-90">{t("Crea prenotazione")}</button>}
                <button disabled={confMail.sending} onClick={async () => {
                  if (!q.email) { setConfMail({ ok: false, msg: t("Email destinatario mancante") }); return; }
                  setConfMail({ sending: true, msg: t("Invio…") });
                  try {
                    const r = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "quote", to: q.email, subject: "Conferma prenotazione — " + q.structure, text: confMsg }) });
                    const j = await r.json().catch(() => ({}));
                    if (r.ok && j?.ok) setConfMail({ ok: true, msg: t("Email inviata a") + " " + q.email });
                    else { setConfMail({ ok: false, msg: j?.error || t("Invio non riuscito") }); window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(q.email)}&su=${encodeURIComponent("Conferma prenotazione — " + q.structure)}&body=${encodeURIComponent(confMsg)}`, "_blank"); }
                  } catch (e) { setConfMail({ ok: false, msg: e instanceof Error ? e.message : t("Rete non disponibile") }); }
                }} className="whitespace-nowrap rounded-lg border border-line px-2.5 py-2 text-xs font-medium text-txt hover:bg-wash disabled:opacity-50">{confMail.sending ? t("Invio…") : t("Email")}</button>
                <a href={wa} target="_blank" rel="noreferrer" className={`whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-semibold text-white ${digits ? "" : "pointer-events-none opacity-40"}`} style={{ backgroundColor: "#25D366" }}>WhatsApp</a>
                <button onClick={() => navigator.clipboard?.writeText(confMsg)} className="whitespace-nowrap rounded-lg border border-line px-2.5 py-2 text-xs font-medium text-txt hover:bg-wash">{t("Copia")}</button>
              </div>
              {confMail.msg && <div className={`mt-2 rounded-lg px-3 py-2 text-xs font-medium ${confMail.ok ? "text-[color:var(--ok)]" : confMail.sending ? "text-dim" : "text-[color:var(--err)]"}`} style={{ backgroundColor: confMail.ok ? "color-mix(in srgb, var(--ok) 12%, transparent)" : confMail.sending ? "var(--wash)" : "color-mix(in srgb, var(--err) 10%, transparent)" }}>{confMail.ok ? "✓ " : ""}{confMail.msg}</div>}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-dim">{label}<div className="mt-1">{children}</div></label>;
}

// Documento PDF visivo (foglio bianco) mostrato in anteprima. Colori fissi = come stampato.
// Foglio A4 in scala: canvas fisso 794×1123 (A4 @96dpi) scalato per riempire la larghezza disponibile.
// Entrambe le pagine hanno così identiche dimensioni A4 nell'anteprima.
function A4Page({ scale, accent, children }: { scale: number; accent: string; children: React.ReactNode }) {
  return (
    <div style={{ width: "100%", aspectRatio: "794 / 1123", overflow: "hidden", borderRadius: 10, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.08), 0 12px 30px -14px rgba(0,0,0,.2)", marginBottom: 14 }}>
      <div style={{ width: 794, height: 1123, transform: `scale(${scale})`, transformOrigin: "top left", position: "relative", overflow: "hidden", fontFamily: "Arial, Helvetica, sans-serif", color: "#2b2b2b" }}>
        <div style={{ height: 6, background: accent }} />
        {children}
      </div>
    </div>
  );
}

function QuoteDoc(p: {
  scale: number;
  accent: string; logo?: string; structureName: string; address: string; contacts: string; legal: string; socials: { k: string; url: string }[]; L: QLabels;
  quoteNo: string; date: string; guest: string; checkIn: string; checkOut: string; nights: number; nWord: string;
  roomLines: { label: string; sub: string; amount: string }[]; breakfast: boolean; breakfastText?: string; parking: boolean; parkText: string; cot?: boolean; cotText?: string;
  cityTax: string; taxPersons: number; total: string; accText: string; payHolder: string; payIban: string; payExtra: string; causale: string; note: string;
  extras?: { name: string; desc?: string; price: string; per: string }[]; extrasTitle?: string; extrasNote?: string; extrasIntro?: string;
  page?: number; // se definito: mostra solo quella pagina (0 = principale, 1 = extra)
}) {
  const muted = "#726b62", hair = "#ece7df";
  const showP1 = p.page === undefined || p.page === 0;
  const showP2 = p.page === undefined || p.page === 1;
  const row = { display: "flex", justifyContent: "space-between", padding: "9px 2px", borderBottom: `1px solid ${hair}`, fontSize: 14 } as const;
  return (
    <>
    {showP1 && (
    <A4Page scale={p.scale} accent={p.accent}>
      <div style={{ padding: "28px 30px 0" }}>
        {/* Intestazione */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, borderBottom: `1px solid ${hair}`, paddingBottom: 20 }}>
          {p.logo
            ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={p.logo} alt="" style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 12, background: "#fff", border: `1px solid ${hair}` }} />)
            : <div style={{ width: 64, height: 64, borderRadius: 12, background: p.accent, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 30 }}>{(p.structureName || "S").slice(0, 1).toUpperCase()}</div>}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.4px" }}>{p.structureName || "La tua struttura"}</div>
            {p.address && <div style={{ fontSize: 13, color: muted, marginTop: 3 }}>{p.address}</div>}
            {p.contacts && <div style={{ fontSize: 12, color: muted, marginTop: 1 }}>{p.contacts}</div>}
          </div>
          <div style={{ textAlign: "right", flex: "none" }}>
            <div style={{ fontSize: 11, letterSpacing: ".13em", color: muted, textTransform: "uppercase", fontWeight: 700 }}>{p.L.quoteNo}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: p.accent }}>{p.quoteNo}</div>
            <div style={{ fontSize: 12.5, color: muted }}>{p.date}</div>
          </div>
        </div>

        <div style={{ padding: "22px 0 30px" }}>
          <p style={{ margin: "0 0 5px", fontSize: 16 }}>{p.L.hi} <b>{p.guest || p.L.guest}</b>,</p>
          <p style={{ margin: "0 0 20px", fontSize: 14, color: muted, lineHeight: 1.55 }}>{p.L.avail}.</p>

          {/* Periodo */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            {[[p.L.ci, p.checkIn], [p.L.co, p.checkOut], [p.L.durata, `${p.nights} ${p.nWord}`]].map(([k, v], i) => (
              <div key={i} style={{ flex: 1, border: `1px solid ${hair}`, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 10.5, letterSpacing: ".08em", color: muted, textTransform: "uppercase", fontWeight: 700 }}>{k}</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Riepilogo */}
          <div style={{ fontSize: 11.5, letterSpacing: ".1em", color: muted, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>{p.L.riepilogo}</div>
          {p.roomLines.map((r, i) => (<div key={i} style={row}><span>{r.label} <span style={{ color: muted }}>· {r.sub}</span></span><b>{r.amount}</b></div>))}
          {p.breakfast && <div style={row}><span>{p.L.colazione}</span><span style={{ color: muted }}>{p.breakfastText ?? p.L.inclusa}</span></div>}
          {p.parking && <div style={row}><span>{p.L.parcheggio}</span><span style={{ color: muted }}>{p.parkText}</span></div>}
          {p.cot && <div style={row}><span>{p.L.culla}</span><span style={{ color: muted }}>{p.cotText}</span></div>}
          <div style={row}><span>{p.L.tassa} <span style={{ color: muted }}>({p.taxPersons} {p.L.persone})</span></span><span>{p.cityTax}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 18px", marginTop: 14, background: `color-mix(in srgb, ${p.accent} 9%, #fff)`, borderRadius: 10 }}>
            <b style={{ fontSize: 13.5, letterSpacing: ".04em" }}>{p.L.totale}</b><b style={{ fontSize: 22, color: p.accent }}>{p.total}</b>
          </div>

          {/* Condizioni & pagamento */}
          <div style={{ fontSize: 11.5, letterSpacing: ".1em", color: muted, textTransform: "uppercase", fontWeight: 700, margin: "22px 0 6px" }}>{p.L.condizioni}</div>
          <p style={{ margin: "0 0 5px", fontSize: 13.5, lineHeight: 1.55 }}>{p.accText}</p>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: muted }}>{p.L.cancLabel}: {p.L.cancText}</p>
          {(p.payHolder || p.payIban) && (
            <div style={{ fontSize: 13.5, lineHeight: 1.7, border: `1px solid ${hair}`, borderRadius: 10, padding: "11px 14px" }}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>{p.L.modalita}</div>
              {p.payHolder && <div>{p.L.intest}: <b>{p.payHolder}</b></div>}
              {p.payIban && <div>IBAN: <span style={{ fontFamily: "monospace" }}>{p.payIban}</span></div>}
              <div style={{ color: muted }}>{p.L.causale}: {p.causale}</div>
              {p.payExtra && <div style={{ color: muted, marginTop: 2 }}>{p.payExtra}</div>}
            </div>
          )}
          {p.note && <p style={{ margin: "14px 0 0", fontSize: 13, fontStyle: "italic", color: muted }}>{p.note}</p>}
          <p style={{ margin: "22px 0 0", fontSize: 14 }}>{p.L.closing}</p>
          <p style={{ margin: "3px 0 0", fontSize: 14, fontWeight: 700 }}>{p.structureName}</p>

          {/* Piè di pagina fissato in fondo al foglio A4 (come pagina 2) */}
          <div style={{ position: "absolute", left: 30, right: 30, bottom: 24, paddingTop: 12, borderTop: `1px solid ${hair}`, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 10.5, color: "#b3a99c", lineHeight: 1.5, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: muted }}>{p.structureName}</div>
              {p.address && <div>{p.address}</div>}
              {(p.contacts || p.legal) && <div>{[p.contacts, p.legal].filter(Boolean).join("  ·  ")}</div>}
            </div>
            {p.socials.length > 0 && (
              <div style={{ display: "flex", gap: 7, flex: "none" }}>
                {p.socials.map((s) => (
                  <a key={s.k} href={s.url} target="_blank" rel="noreferrer" title={s.k} style={{ width: 26, height: 26, borderRadius: 999, background: p.accent, color: "#fff", display: "grid", placeItems: "center" }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d={SOCIAL_PATH[s.k]} /></svg>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </A4Page>
    )}
    {showP2 && p.extras && p.extras.length ? (
      <A4Page scale={p.scale} accent={p.accent}>
        <div style={{ padding: "28px 30px 0" }}>
          {/* Intestazione identica alla pagina 1 */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, borderBottom: `1px solid ${hair}`, paddingBottom: 20 }}>
            {p.logo
              ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={p.logo} alt="" style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 12, background: "#fff", border: `1px solid ${hair}` }} />)
              : <div style={{ width: 64, height: 64, borderRadius: 12, background: p.accent, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 30 }}>{(p.structureName || "S").slice(0, 1).toUpperCase()}</div>}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.4px" }}>{p.structureName || "La tua struttura"}</div>
              {p.address && <div style={{ fontSize: 13, color: muted, marginTop: 3 }}>{p.address}</div>}
              {p.contacts && <div style={{ fontSize: 12, color: muted, marginTop: 1 }}>{p.contacts}</div>}
            </div>
            <div style={{ textAlign: "right", flex: "none" }}>
              <div style={{ fontSize: 11, letterSpacing: ".13em", color: muted, textTransform: "uppercase", fontWeight: 700 }}>{p.L.quoteNo}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: p.accent }}>{p.quoteNo}</div>
              <div style={{ fontSize: 12.5, color: muted }}>{p.date}</div>
            </div>
          </div>

          <div style={{ padding: "22px 0 30px" }}>
            <div style={{ fontSize: 11.5, letterSpacing: ".1em", color: muted, textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>{p.extrasTitle}</div>
            {p.extrasIntro && <p style={{ margin: "0 0 18px", fontSize: 14, color: muted, lineHeight: 1.6 }}>{p.extrasIntro}</p>}
            {p.extras.map((e, i) => (
              <div key={i} style={{ ...row, alignItems: "flex-start" }}>
                <span style={{ minWidth: 0 }}><b>{e.name}</b>{e.desc ? <span style={{ display: "block", color: muted, fontWeight: 400, fontSize: 12 }}>{e.desc}</span> : null}</span>
                <span style={{ whiteSpace: "nowrap", paddingLeft: 12 }}><b>{e.price}</b> <span style={{ color: muted }}>{e.per}</span></span>
              </div>
            ))}
            {p.extrasNote && <p style={{ margin: "12px 0 0", fontSize: 12, fontStyle: "italic", color: muted }}>{p.extrasNote}</p>}

            {/* Piè di pagina fissato in fondo al foglio A4 */}
            <div style={{ position: "absolute", left: 30, right: 30, bottom: 24, paddingTop: 12, borderTop: `1px solid ${hair}`, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 10.5, color: "#b3a99c", lineHeight: 1.5, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: muted }}>{p.structureName}</div>
                {p.address && <div>{p.address}</div>}
                {(p.contacts || p.legal) && <div>{[p.contacts, p.legal].filter(Boolean).join("  ·  ")}</div>}
              </div>
              {p.socials.length > 0 && (
                <div style={{ display: "flex", gap: 7, flex: "none" }}>
                  {p.socials.map((s) => (
                    <a key={s.k} href={s.url} target="_blank" rel="noreferrer" title={s.k} style={{ width: 26, height: 26, borderRadius: 999, background: p.accent, color: "#fff", display: "grid", placeItems: "center" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d={SOCIAL_PATH[s.k]} /></svg>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </A4Page>
    ) : null}
    </>
  );
}
