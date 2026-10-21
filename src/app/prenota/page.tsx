"use client";

import { useEffect, useMemo, useState } from "react";
import { DataProvider, useData } from "@/lib/store";
import type { RoomType, ExtraService } from "@/lib/types";
import { DEFAULT_EXTRAS } from "@/lib/types";
import { getImages } from "@/lib/images";
import MediaImg from "@/components/MediaImg";
import { eur } from "@/lib/format";
import { effectiveClosed, rateForDay, loadWeekendPct } from "@/lib/pricing";
import { cityTaxOfBookingRaw } from "@/lib/booking";
import { loadPlans, planApplies, planDepositPct, type RatePlan } from "@/lib/rate-plans";
import { amenityIcon } from "@/lib/amenities";
import { loadPromos } from "@/lib/promos";
import { inScope } from "@/lib/scope";
import { bookingErrorMessage, BOOKING_NETWORK_ERROR } from "@/lib/booking-errors";
import AdsConsent from "@/components/AdsConsent";
import { GUEST_DEFAULT_ACCENT } from "@/lib/guest-brand";
import DateField from "@/components/DateField";
import { GuestLangPicker, useGuestLang } from "@/components/GuestLang";
import { fmtDate, shiftISO, toISO } from "@/lib/dates";
import { trackBookingConversion, resolveAdsConfig } from "@/lib/ads";
import { loadPublicSite, isPublicMode, publicSlug, findAvailableSibling, findNetworkSuggestions, type SiblingSuggestion } from "@/lib/publicdata";

// ---- pricing helpers --------------------------------------------------------
// Codice prenotazione casuale (maiuscole e cifre senza caratteri ambigui: niente 0/O/1/I).
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 caratteri: nessun bias con byte & 31
const randomBookingCode = (len: number): string => {
  const bytes = new Uint8Array(len);
  try { globalThis.crypto.getRandomValues(bytes); } catch { for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256); }
  return Array.from(bytes, (b) => CODE_CHARS[b & 31]).join("");
};
// Date SEMPRE in calendario locale (toISO/shiftISO di lib/dates): con toISOString() il giorno slitta di ora legale / fuso (es. 29.03 + 1 = 29.03).
const addDays = shiftISO;
const nightsBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));

// Prefisso del codice prenotazione dalla struttura (prime lettere del nome o dello slug): ogni struttura ha il suo, non uno fisso.
const codePrefixOf = (name?: string, slug?: string): string => {
  const letters = (name || slug || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3);
  return letters.length >= 2 ? letters : "BKG";
};
// Email: controllo di forma (il server rifà i suoi controlli).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Riepilogo mostrato nella conferma; dopo il ritorno da Stripe può essere parziale (vedi la risposta di /api/stripe/book/confirm).
type DoneSummary = { code?: string; structureName?: string; roomName?: string; ci?: string; co?: string; total?: number; cityTax?: number; deposit?: number; guestFirst?: string; guestLast?: string; adults?: number; children?: number; email?: string };
const numOr = (v: unknown): number | undefined => (typeof v === "number" && isFinite(v) ? v : undefined);
const strOr = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Plan = RatePlan;
const DEFAULT_PLANS: Plan[] = [
  { id: "flex", name: "Flessibile", adjPct: 0, refundable: true, board: "Colazione", minStay: 1, cancelDays: 3, deposit: "none" },
  { id: "nonref", name: "Non rimborsabile", adjPct: -10, refundable: false, board: "Colazione", minStay: 1, deposit: "prepaid" },
  { id: "long", name: "Lunga permanenza", adjPct: -12, refundable: true, board: "Colazione", minStay: 5, cancelDays: 7, deposit: "deposit", depositPct: 30 },
];

const box = "rounded-xl border border-line bg-surface";
const field = "min-h-11 w-full rounded-lg border border-line bg-paper px-3 py-2 text-base text-txt outline-none focus:border-focus focus-visible:ring-2 focus-visible:ring-focus/40 sm:min-h-0 sm:text-sm";
const fieldErr = "border-[color:var(--err)] focus:border-[color:var(--err)] focus-visible:ring-[color:var(--err)]/30"; // campo non valido

// Slug del sito pubblico (?site=<slug>) della pagina aperta.
const siteFromUrl = (): string => { try { return (new URLSearchParams(window.location.search).get("site") || "").trim(); } catch { return ""; } };

// Avviso cookie di Google Ads: compare solo se la struttura di questo sito ha un account Google Ads (Impostazioni → Google Ads; per Spigolehouse anche i valori storici).
function AdsGate() {
  const { structures } = useData();
  return <AdsConsent config={resolveAdsConfig(siteFromUrl(), structures)} />;
}

export default function PrenotaPage() {
  // Se si arriva da un Xenosite pubblico (xenora.it/<slug> → ?site=<slug>), carica
  // i dati pubblicati dal server prima di montare lo store.
  const [ready, setReady] = useState(false);
  const [embed, setEmbed] = useState(false);
  const [accent, setAccent] = useState<string | null>(null);
  useEffect(() => {
    let slug: string | null = null;
    let em = false;
    try {
      const sp = new URLSearchParams(window.location.search);
      slug = sp.get("site"); em = sp.get("embed") === "1";
      const a = sp.get("accent"); if (a && /^#?[0-9a-fA-F]{3,8}$/.test(a)) setAccent(a.startsWith("#") ? a : `#${a}`);
    } catch {}
    setEmbed(em);
    if (slug) loadPublicSite(slug).finally(() => setReady(true));
    else setReady(true);
  }, []);
  if (!ready) return null;
  const engine = <Engine embed={embed} />;
  return <DataProvider>{accent ? <div style={{ ["--focus" as string]: accent } as React.CSSProperties}>{engine}</div> : engine}{!embed && <AdsGate />}</DataProvider>;
}

// `embed`: versione compatta per l'iframe incorporato sul sito del gestore
// (niente header/footer, sfondo trasparente, comunica l'altezza al parent).
export function Engine({ embed = false }: { embed?: boolean }) {
  const { structures, roomTypes, units, bookings, guests, rateOverrides, addGuest, updateGuest, addBooking, addActivity, getStructure } = useData();
  // Lingua della pagina: scelta a mano > ?lang= > lingua del browser > italiano.
  const { lang, setLang, t } = useGuestLang();
  const adultsTxt = (n: number) => `${n} ${n === 1 ? t("adulto") : t("adulti")}`;
  const childrenTxt = (n: number) => `${n} ${n === 1 ? t("bambino") : t("bambini")}`;
  const nightsTxt = (n: number) => `${n} ${n === 1 ? t("notte") : t("notti")}`;
  const cancelLabel = (p: { refundable?: boolean; cancelDays?: number }) => !p.refundable ? t("Non rimborsabile") : p.cancelDays === 1 ? t("Cancellazione gratuita fino a 1 giorno prima") : p.cancelDays && p.cancelDays > 0 ? t("Cancellazione gratuita fino a {n} giorni prima", { n: p.cancelDays }) : t("Cancellazione gratuita");

  // Config salvata (piani, weekend) — fallback ai default.
  const plans = useMemo<Plan[]>(() => { const p = loadPlans(); return p.length ? p : DEFAULT_PLANS; }, []);
  // % weekend di default (0 se l'host ha spento la maggiorazione); le regole per struttura le applica rateForDay.
  const weekendPct = useMemo(() => loadWeekendPct(), []);
  const allPromos = useMemo(() => { try { return loadPromos(); } catch { return []; } }, []);

  const qp = (k: string) => { try { return new URLSearchParams(window.location.search).get(k); } catch { return null; } };
  // Deep link dai comparatori (Meta Search): ?rt=<id>&checkin=&checkout=. Se manca la
  // struttura (?s), la ricavo dalla tipologia richiesta così la camera è già visibile.
  const rtParam = qp("rt");
  const [structureId, setStructureId] = useState(() => qp("s") || (rtParam ? roomTypes.find((r) => r.id === rtParam)?.structureId : "") || structures[0]?.id || "");
  // Offerte della struttura selezionata (+ quelle valide per tutte).
  const promos = useMemo(() => allPromos.filter((p) => inScope(p.structureId, structureId)), [allPromos, structureId]);
  // Nel motore pubblico (mini-sito / embed) i dati arrivano DOPO il mount: appena compaiono le
  // strutture, se non ne ho una valida selezionata la imposto (da ?s, da ?rt, o la prima).
  useEffect(() => {
    if (structureId && structures.some((s) => s.id === structureId)) return;
    const next = qp("s") || (rtParam ? roomTypes.find((r) => r.id === rtParam)?.structureId : "") || structures[0]?.id || "";
    if (next && next !== structureId) setStructureId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structures, roomTypes]);
  const structure = getStructure(structureId);
  const extras: ExtraService[] = (structure?.extras && structure.extras.length ? structure.extras : DEFAULT_EXTRAS).filter((e) => e.active !== false);

  const today = toISO(new Date());
  // Accetta sia gli alias brevi (?ci/?co, mini-sito) sia quelli lunghi (?checkin/?checkout,
  // deep link dei comparatori Meta Search).
  // Date dal link: un formato strano, una data già passata o una partenza non dopo l'arrivo (link vecchio o scritto a mano) tornano a valori sensati.
  const isoOk = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v).getTime());
  const [checkIn, setCheckIn] = useState(() => { const v = qp("ci") || qp("checkin"); return isoOk(v) && (v as string) >= today ? (v as string) : today; });
  const [checkOut, setCheckOut] = useState(() => {
    const ci0 = qp("ci") || qp("checkin"); const ci = isoOk(ci0) && (ci0 as string) >= today ? (ci0 as string) : today;
    const v = qp("co") || qp("checkout"); return isoOk(v) && (v as string) > ci ? (v as string) : addDays(ci, 1);
  });
  // Le camere compaiono SOLO dopo "Verifica disponibilità" (come Octorate). Se il link porta
  // già date esplicite (?ci&co o ?checkin&checkout) o una tipologia (?rt, deep link
  // metasearch), mostra subito i risultati.
  const [searched, setSearched] = useState<boolean>(() => !!((qp("ci") || qp("checkin")) && (qp("co") || qp("checkout"))) || !!rtParam);
  const [processing, setProcessing] = useState(false); // invio prenotazione / redirect pagamento
  const [noOnlinePayment, setNoOnlinePayment] = useState(false); // prenotazione registrata senza pagamento online (Stripe non collegato): nessun acconto incassato
  const [bookError, setBookError] = useState<string | null>(null); // esito negativo dell'invio: la conferma NON va mostrata
  // Riepilogo per la schermata di conferma dopo il ritorno dal pagamento Stripe (lo stato
  // del form si perde nel redirect: lo ripristiniamo da sessionStorage).
  const [doneSummary, setDoneSummary] = useState<null | DoneSummary>(null);
  // Ritorno da Stripe: "checking" = sto verificando il pagamento col server, "error" = la verifica non è riuscita (mai la conferma senza esito positivo).
  const [ret, setRet] = useState<null | { phase: "checking" } | { phase: "error"; ref: string; err: string }>(null);
  const [canceledNotice, setCanceledNotice] = useState(false);
  // Numeri dal link ripuliti: un ?ad=-5 o ?ch=999 non deve creare ospiti negativi o centinaia di caselle età.
  const [adults, setAdults] = useState(() => Math.min(20, Math.max(1, Math.round(Number(qp("ad")) || 2))));
  const [children, setChildren] = useState(() => Math.min(10, Math.max(0, Math.round(Number(qp("ch")) || 0))));
  const [childAges, setChildAges] = useState<number[]>(() => {
    const n = Math.min(10, Math.max(0, Math.round(Number(qp("ch")) || 0)));
    const raw = (qp("ages") || "").split(",").map((x) => Number(x)).filter((x) => !isNaN(x));
    return Array.from({ length: n }, (_, i) => (raw[i] ?? 8));
  });
  const [wantsCot, setWantsCot] = useState(() => qp("cot") === "1");
  const setChildrenN = (n: number) => { setChildren(n); if (n === 0) setWantsCot(false); setChildAges((prev) => { const next = prev.slice(0, n); while (next.length < n) next.push(8); return next; }); };
  const nights = nightsBetween(checkIn, checkOut);

  const [step, setStep] = useState<"rooms" | "checkout" | "done">("rooms");
  useEffect(() => { setBookError(null); }, [step]); // l'errore dell'invio precedente non resta quando si cambia schermata
  const [sel, setSel] = useState<{ rtId: string; planId: string } | null>(null);
  const [extraQty, setExtraQty] = useState<Record<string, number>>({});
  const [guest, setGuest] = useState({ firstName: "", lastName: "", email: "", phone: "", address: "", city: "", country: "Italia", arrival: "Non lo so", requests: "" });
  const [countryTouched, setCountryTouched] = useState(false); // il Paese "Italia" è solo il valore iniziale: se l'ospite non lo tocca non dice nulla sulla sua lingua
  const [privacy, setPrivacy] = useState(false);
  const [code, setCode] = useState("");
  // Codice sconto / promo
  const [promoInput, setPromoInput] = useState(() => (qp("promo") || "").toUpperCase());
  const [appliedPromo, setAppliedPromo] = useState<{ name?: string; code: string; pct: number } | null>(null);
  const [promoErr, setPromoErr] = useState("");
  const applyPromoCode = (raw?: string) => {
    const c = (raw ?? promoInput).trim().toUpperCase();
    setPromoErr("");
    if (!c) { setAppliedPromo(null); return; }
    const p = promos.find((x) => (x.code || "").toUpperCase() === c && !!x.discountPct);
    if (!p) { setAppliedPromo(null); setPromoErr(t("Codice non valido.")); return; }
    if (p.validUntil && today > p.validUntil) { setAppliedPromo(null); setPromoErr(t("Offerta scaduta.")); return; }
    if (p.validFrom && checkIn < p.validFrom) { setAppliedPromo(null); setPromoErr(t("Valida per soggiorni dal {date}.", { date: fmtDate(p.validFrom) })); return; }
    if (p.validTo && checkIn > p.validTo) { setAppliedPromo(null); setPromoErr(t("Valida per soggiorni fino al {date}.", { date: fmtDate(p.validTo) })); return; }
    setAppliedPromo({ name: p.name, code: (p.code || "").toUpperCase(), pct: p.discountPct! });
  };
  // Applica automaticamente il codice arrivato dall'offerta (?promo=).
  useEffect(() => { const c = (qp("promo") || "").trim(); if (c && promos.length) applyPromoCode(c); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [promos.length]);

  const types = roomTypes.filter((rt) => rt.structureId === structureId && !effectiveClosed(rt, roomTypes));
  const availUnits = (rt: RoomType) => units.filter((u) => u.roomTypeId === rt.id && !u.outOfService && !bookings.some((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.unitId === u.id && b.checkIn < checkOut && b.checkOut > checkIn));
  // Le tariffe derivate condividono le camere fisiche della tipologia madre: risalgo alla radice per la disponibilità.
  const rootType = (rt: RoomType): RoomType => { let cur = rt; const seen = new Set<string>(); while (cur.deriveFrom && !seen.has(cur.id)) { seen.add(cur.id); const p = roomTypes.find((x) => x.id === cur.deriveFrom); if (!p) break; cur = p; } return cur; };
  const availUnitsFor = (rt: RoomType) => availUnits(rootType(rt));
  const descendantsOf = (id: string): RoomType[] => { const out: RoomType[] = []; const walk = (pid: string) => types.filter((x) => x.deriveFrom === pid).forEach((c) => { out.push(c); walk(c.id); }); walk(id); return out; };
  // Solo le tipologie "madre" fanno da camera nel mini-sito; le derivate compaiono come opzioni sotto la madre.
  const masters = types.filter((rt) => !rt.deriveFrom || !types.some((x) => x.id === rt.deriveFrom));

  const dayPrice = (rt: RoomType, iso: string, plan: Plan) => {
    // Stessa tariffa del Calendario e dei canali: override giornalieri (anche della madre per le derivate), weekend sab/dom e interruttore weekend; poi lo sconto/aumento del piano.
    const raw = rateForDay(rt.id, iso, roomTypes, rateOverrides, weekendPct);
    return Math.max(0, Math.round(raw * (1 + plan.adjPct / 100)));
  };
  const stayPrice = (rt: RoomType, plan: Plan) => { let t = 0; for (let i = 0; i < nights; i++) t += dayPrice(rt, addDays(checkIn, i), plan); return t; };

  // Risultati calcolati una volta sola per ogni tipologia "madre" cercata: usati sia per
  // il rendering sia per capire se la struttura è COMPLETAMENTE al completo per le
  // date/ospiti scelti (nessuna tipologia prenotabile) — serve al suggerimento di rete
  // tra strutture dello stesso proprietario, più sotto.
  const pax = adults + children;
  const roomResults = useMemo(() => {
    if (!searched) return [] as { rt: RoomType; free: number; hasDeriv: boolean; cheapest: number; sellable: { v: RoomType; offers: { p: Plan; price: number }[] }[]; tooSmall: boolean; noRate: boolean; bookable: boolean }[];
    return masters.map((rt) => {
      const free = availUnitsFor(rt).length;
      // Varianti = madre + tariffe derivate; ognuna con i suoi piani applicabili.
      const variants = [rt, ...descendantsOf(rt.id)].map((v) => ({
        v,
        fits: (v.maxOccupancy ?? v.beds) >= pax,
        offers: plans.filter((p) => planApplies(p, { roomTypeId: v.id, checkIn, nights, structureId })).map((p) => ({ p, price: stayPrice(v, p) })).filter((x) => x.price > 0),
      })).filter((x) => x.offers.length > 0);
      const sellable = variants.filter((x) => x.fits);
      const hasDeriv = variants.length > 1;
      const cheapest = sellable.reduce((min, x) => Math.min(min, ...x.offers.map((o) => o.price)), Infinity);
      const tooSmall = variants.length > 0 && sellable.length === 0; // esistono tariffe ma nessuna adatta agli ospiti
      const noRate = variants.length === 0;
      const bookable = free > 0 && !tooSmall && !noRate && sellable.length > 0;
      return { rt, free, hasDeriv, cheapest, sellable, tooSmall, noRate, bookable };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, masters, pax, checkIn, checkOut, nights, plans, roomTypes, units, bookings]);

  // Nessuna tipologia prenotabile per le date/ospiti scelti → la struttura è "al completo".
  const allSoldOut = searched && roomResults.every((r) => !r.bookable);

  // Suggerimento di rete tra strutture dello STESSO proprietario (stesso account Xenora):
  // se questa struttura è al completo, cerca un'ALTRA struttura pubblicata dallo stesso
  // proprietario con disponibilità VERA per le stesse date/ospiti, e la propone
  // all'ospite invece di lasciarlo senza alternative. Solo sui siti pubblici
  // (Xenosite/embed) e solo se l'host non l'ha disattivato nelle Impostazioni struttura.
  const [sibling, setSibling] = useState<SiblingSuggestion | null>(null);
  // Rete di passaggio Xenora TRA ACCOUNT DIVERSI (V2): se non c'è un'alternativa dello
  // stesso proprietario, e QUESTA struttura ha attivato esplicitamente `networkOptIn`,
  // cerca strutture di ALTRI account nella stessa città che hanno anch'esse attivato
  // l'opt-in e hanno disponibilità vera. Doppio opt-in: nessuna struttura mostra o
  // compare in suggerimenti altrui senza averlo scelto esplicitamente (default OFF).
  const [networkAlts, setNetworkAlts] = useState<SiblingSuggestion[]>([]);
  useEffect(() => {
    setSibling(null);
    setNetworkAlts([]);
    const slug = publicSlug();
    if (!allSoldOut || !isPublicMode() || !slug) return;
    let alive = true;
    (async () => {
      if (structure?.crossSuggestEnabled !== false) {
        const s = await findAvailableSibling({ currentSlug: slug, currentStructureId: structureId, checkIn, checkOut, guests: pax });
        if (!alive) return;
        if (s) { setSibling(s); return; } // alternativa dello stesso gestore: priorità sulla rete tra account diversi
      }
      if (!alive || structure?.networkOptIn !== true) return;
      const list = await findNetworkSuggestions({ currentSlug: slug, city: structure?.city, checkIn, checkOut, guests: pax });
      if (alive) setNetworkAlts(list);
    })();
    return () => { alive = false; };
  }, [allSoldOut, checkIn, checkOut, pax, structureId, structure?.crossSuggestEnabled, structure?.networkOptIn, structure?.city]);

  const selRt = sel ? types.find((t) => t.id === sel.rtId) : null;
  const selPlan = sel ? plans.find((p) => p.id === sel.planId) ?? plans[0] : null;
  const accommodation = selRt && selPlan ? stayPrice(selRt, selPlan) : 0;
  const extraPrice = (x: ExtraService) => x.per === "night" ? x.price * nights : x.per === "person" ? x.price * adults : x.price;
  const extrasTotal = extras.reduce((a, x) => a + (extraQty[x.id] ?? 0) * extraPrice(x), 0);
  // Tassa di soggiorno: 0 finché non è selezionata una camera; poi logica unica (@/lib/booking).
  const cityTax = selRt ? cityTaxOfBookingRaw(structure, { adults, children, childAges, checkIn, checkOut, total: accommodation }) : 0; // stessa formula del gestionale: paganti = adulti + minori sopra soglia, divisore = tutti gli ospiti
  const discount = appliedPromo ? Math.round(accommodation * appliedPromo.pct / 100) : 0;
  const total = accommodation + extrasTotal + cityTax - discount;
  const depositPct = selPlan ? planDepositPct(selPlan) : 0; // acconto secondo la politica di incasso del piano
  // "Da pagare adesso" = % del piano su (soggiorno al netto dello sconto + extra), ai CENTESIMI. La tassa di soggiorno NON si addebita online: si paga in struttura
  // (e' dentro "Totale" ma fuori da questa cifra). E' la stessa regola con cui /api/stripe/book calcola l'addebito, cosi' pagina e carta coincidono.
  const payBase = Math.max(0, accommodation - discount) + extrasTotal;
  const deposit = Math.round(payBase * depositPct) / 100;

  const privacyHref = (() => { const u = (structure as { privacyUrl?: string } | undefined)?.privacyUrl; return u && /^https?:\/\//i.test(u) ? u : "/privacy"; })();
  const emailOk = EMAIL_RE.test(guest.email.trim());
  const phoneOk = guest.phone.replace(/\D/g, "").length >= 6;
  const guestValid = !!(guest.firstName.trim() && guest.lastName.trim() && emailOk && phoneOk && privacy);

  // Stripe Checkout non si apre dentro un iframe: nella versione incorporata si naviga la finestra principale.
  const goToCheckout = (url: string) => {
    if (embed) {
      try { if (window.top && window.top !== window.self) { window.top.location.href = url; return; } } catch { /* iframe con sandbox: si prova con _top */ }
      try { if (window.open(url, "_top")) return; } catch { /* niente */ }
    }
    window.location.href = url;
  };

  const confirm = async () => {
    if (!selRt || !guestValid || processing) return;
    setBookError(null);
    const unit = availUnitsFor(selRt)[0]; // le derivate usano le camere della tipologia madre
    // Evita doppioni in anagrafica: riusa l'ospite esistente (stessa email, o stesso nome con telefono compatibile).
    const norm = (s?: string) => (s ?? "").trim().toLowerCase();
    const full = `${guest.firstName.trim()} ${guest.lastName.trim()}`.trim();
    const found = guests.find((g) => {
      if (norm(guest.email) && norm(g.email) === norm(guest.email)) return true;
      if (norm(full) && norm(g.fullName) === norm(full) && (!norm(g.phone) || !norm(guest.phone) || norm(g.phone) === norm(guest.phone))) return true;
      return false;
    });
    let gid: string;
    if (found) {
      gid = found.id;
      updateGuest(found.id, { firstName: found.firstName || guest.firstName.trim(), lastName: found.lastName || guest.lastName.trim(), fullName: found.fullName || full, email: found.email || guest.email.trim() || undefined, phone: found.phone || guest.phone.trim() || undefined, country: found.country || guest.country });
    } else {
      gid = addGuest({ firstName: guest.firstName.trim(), lastName: guest.lastName.trim(), email: guest.email.trim(), phone: guest.phone.trim(), country: guest.country });
    }
    const chosenExtras = extras.filter((x) => (extraQty[x.id] ?? 0) > 0).map((x) => `${extraQty[x.id]}× ${x.name}`);
    const note = [`Sito diretto · ${selPlan?.name}`, appliedPromo ? `Promo ${appliedPromo.code} (−${appliedPromo.pct}%)` : "", chosenExtras.length ? `Extra: ${chosenExtras.join(", ")}` : "", wantsCot ? "🍼 Culla richiesta" : "", guest.arrival !== "Non lo so" ? `Arrivo ~${guest.arrival}` : "", guest.requests.trim()].filter(Boolean).join(" · ");
    const bkCode = `${codePrefixOf(structure?.name, publicSlug() || undefined)}-${new Date().getFullYear()}-${randomBookingCode(8)}`; // prefisso dalla struttura; parte casuale: la vecchia somma dei caratteri produceva molte collisioni
    // Sito PUBBLICO: prima si tenta il PAGAMENTO online (Stripe della struttura); la
    // prenotazione si registra solo dopo l'incasso. Se Stripe non è collegato o non è
    // previsto un importo, si registra direttamente ("paga in struttura").
    if (isPublicMode() && publicSlug()) {
      const token = (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
      // Lingua delle email: quella della pagina. Se il Paese è ancora il valore iniziale "Italia" e l'ospite usa un'altra lingua, non lo mando (direbbe "italiano").
      const guestBody = { firstName: guest.firstName.trim(), lastName: guest.lastName.trim(), email: guest.email.trim(), phone: guest.phone.trim(), country: !countryTouched && lang !== "it" ? "" : guest.country.trim(), language: lang };
      // Dati dell'ordine: il server ricalcola i prezzi e verifica extra (id/quantità sul listino del proprietario) e codice promo; qui passo solo ciò che l'ospite ha scelto.
      const orderExtras = extras.filter((x) => (extraQty[x.id] ?? 0) > 0).map((x) => ({ id: x.id, name: x.name, qty: extraQty[x.id] ?? 0, unitPrice: extraPrice(x), price: (extraQty[x.id] ?? 0) * extraPrice(x) }));
      const order = { accommodation, discount, promoCode: appliedPromo?.code, extras: orderExtras, cityTax, grandTotal: total };
      const stayTotal = Math.max(0, accommodation - discount); // soggiorno al netto dello sconto (extra e tassa viaggiano a parte)
      try { sessionStorage.setItem("xn-lastbooking", JSON.stringify({ code: bkCode, structureName: structure?.name, roomName: `${selRt.name}${selPlan ? " · " + selPlan.name : ""}`, ci: checkIn, co: checkOut, total, cityTax, deposit, guestFirst: guest.firstName.trim(), guestLast: guest.lastName.trim(), adults, children, email: guest.email.trim() })); } catch {}
      setProcessing(true);
      let failure: string | null = null;
      try {
        const policy = { planName: selPlan?.name, refundable: !!selPlan?.refundable, cancelDays: selPlan?.cancelDays ?? 0 };
        const r = await fetch("/api/stripe/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: publicSlug(), s: structureId, rt: selRt.id, ci: checkIn, co: checkOut, adults, children, childAges: children > 0 ? childAges : [], total: stayTotal, deposit, note, code: bkCode, token, guest: guestBody, lang, ...order, ...policy }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j?.ok === false) failure = bookingErrorMessage(r.status, j?.error);
        else if (j?.payment && j?.url) { goToCheckout(j.url as string); return; } // → Stripe
        else {
          const r2 = await fetch("/api/public-booking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: publicSlug(), token, rt: selRt.id, ci: checkIn, co: checkOut, adults, children, childAges: children > 0 ? childAges : [], total: stayTotal, deposit, note, code: bkCode, guest: guestBody, lang, ...order, ...policy }) });
          const j2 = await r2.json().catch(() => ({}));
          if (!r2.ok || j2?.ok === false) failure = bookingErrorMessage(r2.status, j2?.error);
          else setNoOnlinePayment(true); // registrata senza incasso online: la conferma non deve dire "acconto pagato"
        }
      } catch { failure = BOOKING_NETWORK_ERROR; }
      setProcessing(false);
      if (failure) {
        try { sessionStorage.removeItem("xn-lastbooking"); } catch {}
        setBookError(failure);
        return; // niente schermata di conferma: la prenotazione non è stata registrata
      }
    } else {
      addBooking({ structureId, roomTypeId: selRt.id, unitId: unit?.id ?? null, guestId: gid, channel: "direct", status: "confirmed", checkIn, checkOut, adults, children, childAges: childAges.length ? childAges : undefined, total: accommodation, cleaningFee: 0, paid: deposit, cityTaxPaid: false, note, source: "sito" });
      addActivity("booking", `Prenotazione dal sito — ${guest.firstName} ${guest.lastName}`);
    }
    setCode(bkCode);
    setStep("done");
    window.scrollTo(0, 0);
  };

  // Ritorno dal pagamento Stripe: la conferma compare SOLO dopo l'esito positivo di /api/stripe/book/confirm
  // (che verifica l'incasso e registra la prenotazione). Riepilogo e codice arrivano dalla risposta del server; il sessionStorage è solo un ripiego.
  const confirmReturn = async (sessId: string, slug: string) => {
    setRet({ phase: "checking" });
    let err = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch("/api/stripe/book/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: sessId, slug }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j?.ok === true) {
          let saved: DoneSummary = {};
          try { const x = JSON.parse(sessionStorage.getItem("xn-lastbooking") || "null"); if (x && typeof x === "object") saved = x as DoneSummary; } catch {}
          const bk = (j.booking && typeof j.booking === "object" ? j.booking : {}) as Record<string, unknown>;
          const srvCode = strOr(bk.code) ?? strOr(j.code);
          if (srvCode && saved.code && saved.code !== srvCode) saved = {}; // il riepilogo salvato è di un altro tentativo
          const merged: DoneSummary = {
            code: srvCode ?? saved.code,
            structureName: strOr(bk.structureName) ?? saved.structureName,
            roomName: strOr(bk.roomName) ?? saved.roomName,
            ci: strOr(bk.ci) ?? strOr(bk.checkIn) ?? saved.ci,
            co: strOr(bk.co) ?? strOr(bk.checkOut) ?? saved.co,
            total: numOr(bk.grandTotal) ?? saved.total ?? numOr(bk.total),
            cityTax: numOr(bk.cityTax) ?? saved.cityTax,
            deposit: numOr(bk.paid) ?? numOr(bk.deposit) ?? saved.deposit,
            guestFirst: strOr(bk.guestFirst) ?? saved.guestFirst,
            guestLast: strOr(bk.guestLast) ?? saved.guestLast,
            adults: numOr(bk.adults) ?? saved.adults,
            children: numOr(bk.children) ?? saved.children,
            email: strOr(bk.email) ?? saved.email,
          };
          setDoneSummary(merged);
          if (merged.code) setCode(merged.code);
          setRet(null); setStep("done"); window.scrollTo(0, 0);
          try { sessionStorage.removeItem("xn-lastbooking"); } catch {}
          try { window.history.replaceState({}, "", `/prenota?site=${encodeURIComponent(slug)}`); } catch {}
          return;
        }
        err = String(j?.error || r.status);
        if (j?.error === "not_paid" && attempt < 3) { await sleep(2500); continue; } // l'incasso può arrivare qualche secondo dopo il ritorno
        if (!r.ok && (r.status >= 500 || r.status === 409) && attempt < 3) { await sleep(2000); continue; } // guasto transitorio (5xx, 409 write_conflict): si ritenta
        break;
      } catch {
        err = "network";
        if (attempt < 3) { await sleep(2000); continue; }
      }
    }
    setRet({ phase: "error", ref: sessId.slice(-8), err });
  };
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get("canceled") === "1") setCanceledNotice(true);
    if (u.searchParams.get("paid") === "1" && u.searchParams.get("session_id")) {
      void confirmReturn(u.searchParams.get("session_id") as string, u.searchParams.get("site") || publicSlug() || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Conversione Google Ads: prenotazione diretta confermata (solo con consenso, una volta per codice; vedi lib/ads.ts).
  useEffect(() => {
    if (step !== "done") return;
    const c = doneSummary?.code || code;
    // Valore della conversione = ricavo della struttura: il totale mostrato all'ospite senza la tassa di soggiorno (non è un ricavo, si riscuote per il Comune).
    const v = (Number(doneSummary?.total ?? total) || 0) - (Number(doneSummary?.cityTax ?? cityTax) || 0);
    if (c) trackBookingConversion(resolveAdsConfig(siteFromUrl(), structures), { value: Math.max(0, v), transactionId: c });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, doneSummary, code]);

  // Deep link Meta Search con ?rt=<id>: porta la tipologia richiesta in vista.
  useEffect(() => {
    if (!rtParam || !searched || step !== "rooms") return;
    const timer = setTimeout(() => { try { document.getElementById(`rt-${rtParam}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); } catch {} }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, step]);

  // Modalità EMBED: comunica l'altezza del contenuto al sito ospite, così lo
  // script /embed.js adatta l'iframe senza scrollbar interne (ResizeObserver +
  // qualche invio ritardato per attendere font/immagini).
  useEffect(() => {
    if (!embed) return;
    const send = () => {
      try {
        const h = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
        window.parent?.postMessage({ type: "xenora-embed-height", height: h }, "*");
      } catch {}
    };
    send();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(send) : null;
    ro?.observe(document.body);
    const timers = [120, 400, 900, 1600].map((ms) => window.setTimeout(send, ms));
    window.addEventListener("resize", send);
    return () => { ro?.disconnect(); timers.forEach((t) => window.clearTimeout(t)); window.removeEventListener("resize", send); };
  }, [embed]);

  // Riepilogo prenotazione (per PDF).
  // Dopo il ritorno da Stripe il modulo è perso: i valori vengono SOLO dal riepilogo (risposta del server), come nella schermata finale.
  const bookingLines = () => {
    const ds = doneSummary;
    const bCode = ds ? ds.code : code;
    const bTotal = ds ? ds.total ?? 0 : total;
    const bDeposit = noOnlinePayment ? 0 : (ds ? ds.deposit ?? 0 : deposit);
    const bPayable = Math.max(0, bTotal - (ds ? ds.cityTax ?? 0 : cityTax)); // quanto si puo' pagare online: la tassa di soggiorno si salda in struttura
    const bAdults = ds ? ds.adults ?? adults : adults, bChildren = ds ? ds.children ?? 0 : children;
    const bGuest = ds ? `${ds.guestFirst ?? ""} ${ds.guestLast ?? ""}`.trim() : `${guest.firstName} ${guest.lastName}`.trim();
    return ([
      [t("Codice prenotazione"), bCode ?? ""],
      [t("Struttura"), (ds ? ds.structureName : undefined) || structure?.name || ""],
      [t("Camera"), ds ? ds.roomName || "" : `${selRt?.name ?? ""}${selPlan ? " · " + selPlan.name : ""}`],
      [t("Ospite"), bGuest],
      [t("Check-in"), fmtDate(ds ? ds.ci : checkIn)],
      [t("Check-out"), fmtDate(ds ? ds.co : checkOut)],
      [t("Ospiti"), `${adultsTxt(bAdults)}${bChildren ? ` · ${childrenTxt(bChildren)}` : ""}`],
      [t("Totale"), eur(bTotal)],
      ...((bDeposit > 0 && bDeposit < bPayable
        ? [[t("Acconto versato"), eur(bDeposit)], [t("Saldo in struttura"), eur(bTotal - bDeposit)]]
        : bDeposit > 0
          ? [[t("Importo pagato"), eur(bDeposit)], ...(bTotal - bDeposit > 0.005 ? [[t("Saldo in struttura"), eur(bTotal - bDeposit)]] : [])]
          : [[t("Saldo in struttura"), eur(bTotal)]]) as [string, string][]),
    ] as [string, string][]);
  };

  const printPdf = () => {
    const w = window.open("", "_blank", "width=820,height=940");
    if (!w) return;
    const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
    const rows = bookingLines().map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join("");
    w.document.write(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(t("Prenotazione"))} ${esc(doneSummary ? doneSummary.code : code)}</title>
      <style>*{box-sizing:border-box}body{font-family:Georgia,'Times New Roman',serif;color:#1a2131;margin:0;padding:48px 54px;font-size:14px;line-height:1.55}
      .brand{font-size:24px;font-weight:700;color:#4f46e5;border-bottom:3px solid #4f46e5;padding-bottom:14px;margin-bottom:24px}
      h1{font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#5c6479;margin:0 0 16px}
      table{width:100%;border-collapse:collapse}td{padding:10px 4px;border-bottom:1px solid #e3e6ef}td.k{color:#5c6479}td.v{text-align:right;font-weight:600}
      .note{margin-top:28px;font-size:11px;color:#9aa2b6;border-top:1px solid #e3e6ef;padding-top:14px}
      @media print{body{padding:24px 30px}}</style></head><body>
      <div class="brand">${esc((doneSummary ? doneSummary.structureName : undefined) || structure?.name || "Xenora")}</div>
      <h1>${esc(t("Conferma di prenotazione"))}</h1>
      <table>${rows}</table>
      <div class="note">${esc(t("Documento di riepilogo prenotazione. Prenotazione diretta · Xenora."))}</div>
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  };

  // Link "Torna alla home":
  //  1) se il link lo specifica (?home=<url>) → torna lì (es. il tuo sito WordPress ufficiale);
  //  2) altrimenti il sito ufficiale impostato sulla struttura (structure.website);
  //  3) altrimenti il mini-sito pubblico /<slug>.
  const homeOverride = (() => { const h = qp("home"); return h && /^https?:\/\//i.test(h) ? h : ""; })();
  const structWebsite = (() => { const w = (structure as { website?: string } | undefined)?.website; return w && /^https?:\/\//i.test(w) ? w : ""; })();
  const homeHref = homeOverride || structWebsite || (isPublicMode() && publicSlug() ? `/${publicSlug()}` : `/sito-web?s=${structureId}`);

  // ---- Header ----
  const header = (
    <div className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
        <a href={homeHref} className="flex min-h-11 items-center gap-2 rounded-lg transition hover:opacity-80" title={t("Torna alla home")}>
          <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg text-sm font-bold text-white" style={{ backgroundColor: structure?.photoColor ?? GUEST_DEFAULT_ACCENT }}>{structure?.logo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={structure.logo} alt="" className="h-full w-full bg-white object-contain" /> : (structure?.name ?? "XN").slice(0, 2).toUpperCase()}</div>
          <div className="leading-tight"><div className="text-sm font-bold text-txt">{structure?.name ?? "Xenora"}</div><div className="text-xs text-dim">← {t("Torna alla home")}</div></div>
        </a>
        {structures.length > 1 && step === "rooms" && (
          <select value={structureId} onChange={(e) => { setStructureId(e.target.value); setSel(null); }} className="min-h-11 rounded-lg border border-line bg-paper px-2 py-1.5 text-base text-txt outline-none focus:border-focus focus-visible:ring-2 focus-visible:ring-focus/40 sm:min-h-0 sm:text-sm">
            {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div className="ml-auto flex items-center gap-2 rounded-full bg-wash px-3 py-1.5 text-sm"><span className="text-txt">{t("Totale")}</span><span className="font-mono font-bold text-txt">{eur(total)}</span></div>
      </div>
    </div>
  );

  // ---- Footer ----
  const footer = (
    <footer className="mt-12 border-t border-line bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a href={homeHref} className="flex min-h-11 items-center gap-2 text-sm font-bold text-txt hover:opacity-80">
            <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md text-xs font-bold text-white" style={{ backgroundColor: structure?.photoColor ?? GUEST_DEFAULT_ACCENT }}>{structure?.logo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={structure.logo} alt="" className="h-full w-full bg-white object-contain" /> : (structure?.name ?? "XN").slice(0, 2).toUpperCase()}</span>
            {structure?.name ?? "Xenora"}
          </a>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dim">
            {structure?.email && <a href={`mailto:${structure.email}`} className="inline-flex min-h-11 items-center hover:text-txt sm:min-h-0">{structure.email}</a>}
            {structure?.phone && <a href={`tel:${structure.phone}`} className="inline-flex min-h-11 items-center hover:text-txt sm:min-h-0">{structure.phone}</a>}
            {structure?.cin && <span>CIN {structure.cin}</span>}
            <div className="flex items-center gap-2">
              {structure?.phone && <a href={`https://wa.me/${structure.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" title="WhatsApp" aria-label="WhatsApp" className="grid h-11 w-11 place-items-center rounded-full bg-wash sm:h-8 sm:w-8" style={{ color: "#25D366" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1-.4-.1-.9-.3-1.6-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.3.7-2 .9-2.2.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.6-.3.3c-.2.2-.3.3-.1.6.2.3.9 1.4 1.9 2.3 1.3 1.1 2.3 1.5 2.6 1.6.3.1.5.1.7-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.1.1.5-.1 1Z" /></svg></a>}
              {structure?.instagram && <a href={structure.instagram.startsWith("http") ? structure.instagram : `https://instagram.com/${structure.instagram.replace(/^@/, "")}`} target="_blank" rel="noreferrer" title="Instagram" aria-label="Instagram" className="grid h-11 w-11 place-items-center rounded-full bg-wash sm:h-8 sm:w-8" style={{ color: "#C13584" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg></a>}
              {structure?.facebook && <a href={structure.facebook.startsWith("http") ? structure.facebook : `https://facebook.com/${structure.facebook}`} target="_blank" rel="noreferrer" title="Facebook" aria-label="Facebook" className="grid h-11 w-11 place-items-center rounded-full bg-wash sm:h-8 sm:w-8" style={{ color: "#1877F2" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" /></svg></a>}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-dim">
          <span>{t("© {year} {name}. Tutti i diritti riservati.", { year: new Date().getFullYear(), name: structure?.name ?? "Xenora" })}</span>
          <span>{t("Sito creato dal gruppo")} <b className="text-txt">Xenora</b> · {t("Prenotazione online sicura")}</span>
        </div>
      </div>
    </footer>
  );

  // ---- Search bar ----
  const searchBar = (
    <div className={`${box} mb-4 p-3`}>
      <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]">
        <label className="block text-xs font-medium text-dim">{t("Arrivo")}<DateField lang={lang} value={checkIn} min={today} onChange={(v) => { setCheckIn(v); if (v >= checkOut) setCheckOut(addDays(v, 1)); setSearched(false); }} className={`${field} mt-1 w-full text-left`} /></label>
        <label className="block text-xs font-medium text-dim">{t("Partenza")}<DateField lang={lang} value={checkOut} min={addDays(checkIn, 1)} onChange={(v) => { setCheckOut(v); setSearched(false); }} className={`${field} mt-1 w-full text-left`} /></label>
        <label className="block text-xs font-medium text-dim">{t("Adulti")}<Stepper label={t("Adulti")} value={adults} min={1} onChange={(v) => { setAdults(v); setSearched(false); }} /></label>
        <label className="block text-xs font-medium text-dim">{t("Bambini")}<Stepper label={t("Bambini")} value={children} min={0} onChange={(v) => { setChildrenN(v); setSearched(false); }} /></label>
        <button onClick={() => setSearched(true)} className={`min-h-11 whitespace-nowrap rounded-lg px-5 text-sm font-semibold transition ${searched ? "border border-line bg-surface text-focus hover:bg-wash" : "bg-focus text-white shadow-sm hover:opacity-90"}`}>{t("Verifica disponibilità")}</button>
      </div>
      {children > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-xs font-medium text-dim">{t("Età dei bambini")} <span className="font-normal">{t("(per la tassa di soggiorno e la sistemazione)")}</span></div>
          <div className="flex flex-wrap gap-2">
            {childAges.map((age, i) => (
              <label key={i} className="flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs text-dim">{t("Bimbo {n}", { n: i + 1 })}
                <input type="number" inputMode="numeric" min={0} max={17} value={age} onChange={(e) => setChildAges((prev) => prev.map((a, j) => (j === i ? Math.max(0, Math.min(17, Number(e.target.value))) : a)))} className="min-h-11 w-16 rounded border border-line bg-surface px-1.5 py-0.5 text-base text-txt outline-none focus:border-focus focus-visible:ring-2 focus-visible:ring-focus/40 sm:min-h-0 sm:w-14 sm:text-sm" />
              </label>
            ))}
          </div>
          <label className="mt-2 flex w-fit items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs font-medium text-txt">
            <input type="checkbox" checked={wantsCot} onChange={(e) => setWantsCot(e.target.checked)} className="h-5 w-5 accent-[color:var(--focus)]" /> {t("Culla per il bimbo")} <span className="font-normal text-dim">{t("(gratuita, su richiesta)")}</span>
          </label>
        </div>
      )}
      <div className="mt-2 text-xs text-dim">{nightsTxt(nights)} · {adultsTxt(adults)}{children ? ` · ${childrenTxt(children)}` : ""}</div>
    </div>
  );

  // Ritorno da Stripe: finché il server non conferma l'incasso NON si mostra "Prenotazione confermata".
  if (ret) {
    return (
      <div className={embed ? "flex flex-col" : "flex min-h-dvh flex-col bg-wash"}>
        {!embed && header}
        <div className={`mx-auto w-full max-w-2xl flex-1 ${embed ? "px-3 py-5" : "px-4 py-10"}`}>
          <div className="mb-3 flex justify-end"><GuestLangPicker lang={lang} setLang={setLang} label={t("Lingua")} /></div>
          {ret.phase === "checking" ? (
            <div className={`${box} p-8 text-center`} role="status">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[color:var(--line)] border-t-[color:var(--focus)]" aria-hidden />
              <h1 className="font-display text-xl font-bold text-txt">{t("Stiamo verificando il pagamento…")}</h1>
              <p className="mt-1 text-sm text-dim">{t("Ci vuole qualche secondo: non chiudere questa pagina.")}</p>
            </div>
          ) : (
            <div className={`${box} p-8 text-center`} role="alert">
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full text-2xl font-bold text-white" style={{ backgroundColor: "var(--warn)" }}>!</div>
              <h1 className="font-display text-xl font-bold text-txt">{t("Non riusciamo ancora a confermare la prenotazione")}</h1>
              <p className="mt-2 text-sm text-dim">{t("Il pagamento potrebbe essere andato a buon fine, ma non abbiamo ancora potuto registrare la prenotazione. Non pagare di nuovo: riprova tra un istante oppure contatta la struttura indicando questo riferimento.")}</p>
              <p className="mt-2 font-mono text-sm font-bold text-txt">{ret.ref}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button onClick={() => { const u = new URL(window.location.href); const sid = u.searchParams.get("session_id"); if (sid) void confirmReturn(sid, u.searchParams.get("site") || publicSlug() || ""); }} className="min-h-11 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">{t("Riprova")}</button>
                {structure?.phone && <a href={`tel:${structure.phone}`} className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt">{structure.phone}</a>}
                {structure?.email && <a href={`mailto:${structure.email}`} className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt">{structure.email}</a>}
              </div>
            </div>
          )}
        </div>
        {!embed && footer}
      </div>
    );
  }

  if (step === "done") {
    // Dopo Stripe contano SOLO i dati del riepilogo (risposta del server / sessionStorage): lo stato del form è perso e non va mai mostrato come se fosse la prenotazione.
    const ds = doneSummary;
    const dCode = ds ? ds.code : code;
    const dStruct = (ds ? ds.structureName : undefined) || structure?.name;
    const dRoom = ds ? ds.roomName : selRt?.name;
    const dCi = ds ? ds.ci : checkIn, dCo = ds ? ds.co : checkOut;
    const dTotal = ds ? ds.total ?? 0 : total;
    const dDeposit = noOnlinePayment ? 0 : (ds ? ds.deposit ?? 0 : deposit);
    const dPayable = Math.max(0, dTotal - (ds ? ds.cityTax ?? 0 : cityTax)); // tassa di soggiorno esclusa: si salda in struttura
    const dFirst = ((ds ? ds.guestFirst : guest.firstName) || "").trim();
    const dEmail = (ds ? ds.email : guest.email) || "";
    const hasDetails = !!(dCode && dCi && dCo && dTotal > 0);
    return (
      <div className={embed ? "flex flex-col" : "flex min-h-dvh flex-col bg-wash"}>
        {!embed && header}
        <div className={`mx-auto w-full max-w-2xl flex-1 ${embed ? "px-3 py-5" : "px-4 py-10"}`}>
          <div className="mb-3 flex justify-end"><GuestLangPicker lang={lang} setLang={setLang} label={t("Lingua")} /></div>
          <div className={`${box} p-8 text-center`}>
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full text-white" style={{ backgroundColor: "var(--ok)" }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg></div>
            <h1 className="font-display text-2xl font-bold text-txt">{hasDetails ? t("Prenotazione confermata!") : t("Pagamento ricevuto")}</h1>
            <p className="mt-1 text-sm text-dim">{hasDetails && dFirst && dEmail
              ? <>{t("Grazie {name}. Ti abbiamo inviato la conferma a", { name: dFirst })} <b className="text-txt">{dEmail}</b>.</>
              : t("Grazie! Ti abbiamo inviato la conferma via email. Se non la trovi, controlla la posta indesiderata o contatta la struttura.")}</p>
            {hasDetails && (
              <div className="mx-auto mt-5 max-w-sm rounded-xl border border-line bg-wash p-4 text-left text-sm">
                <div className="flex justify-between gap-3"><span className="text-dim">{t("Codice")}</span><span className="font-mono font-bold text-txt">{dCode}</span></div>
                {dStruct && <div className="mt-1 flex justify-between gap-3"><span className="text-dim">{t("Struttura")}</span><span className="text-right text-txt">{dStruct}</span></div>}
                {dRoom && <div className="mt-1 flex justify-between gap-3"><span className="text-dim">{t("Camera")}</span><span className="text-right text-txt">{dRoom}</span></div>}
                <div className="mt-1 flex justify-between gap-3"><span className="text-dim">{t("Soggiorno")}</span><span className="text-txt">{fmtDate(dCi)} → {fmtDate(dCo)}</span></div>
                <div className="mt-2 flex justify-between border-t border-line pt-2"><span className="font-semibold text-txt">{t("Totale")}</span><span className="font-mono font-bold text-txt">{eur(dTotal)}</span></div>
                {dDeposit > 0 && <div className="mt-1 flex justify-between"><span className="text-dim">{dDeposit < dPayable ? t("Acconto pagato") : t("Importo pagato")}</span><span className="font-mono text-txt">{eur(dDeposit)}</span></div>}
                {dTotal - dDeposit > 0 && <div className="mt-1 flex justify-between"><span className="text-dim">{t("Saldo in struttura")}</span><span className="font-mono text-txt">{eur(dTotal - dDeposit)}</span></div>}
              </div>
            )}
            {hasDetails && (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button onClick={printPdf} className="flex min-h-11 items-center gap-1.5 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" /></svg> {t("Scarica PDF")}</button>
              </div>
            )}
            <p className="mt-4 text-xs text-dim">{hasDetails ? t("Conferma inviata via email. Puoi scaricare il PDF con tutti i dettagli della prenotazione.") : t("Per qualsiasi dubbio contatta la struttura.")}</p>
          </div>
        </div>
        {!embed && footer}
      </div>
    );
  }

  return (
    <div className={embed ? "flex flex-col" : "flex min-h-dvh flex-col bg-wash"}>
      {!embed && header}
      <div className={`mx-auto w-full max-w-7xl flex-1 ${embed ? "px-3 py-4" : "px-4 py-6"}`}>
        {step === "rooms" && (
          <>
            <div className="mb-3 flex justify-end"><GuestLangPicker lang={lang} setLang={setLang} label={t("Lingua")} /></div>
            {canceledNotice && <div role="status" className="mb-3 rounded-lg border px-3 py-2 text-sm text-txt" style={{ borderColor: "var(--warn)", backgroundColor: "color-mix(in srgb, var(--warn) 10%, transparent)" }}>{t("Pagamento annullato: la prenotazione non è stata registrata e non è stato addebitato nulla.")}</div>}
            <h1 className="mb-3 font-display text-xl font-bold text-txt">{t("Verifica disponibilità")}</h1>
            {searchBar}
            {!searched && (
              <div className={`${box} p-8 text-center`}>
                <p className="text-sm text-dim">{t("Seleziona date e ospiti, poi premi")} <b className="text-txt">{t("Verifica disponibilità")}</b> {t("per vedere le camere.")}</p>
              </div>
            )}
            {searched && (
            <div className={`${box} mb-3 flex flex-wrap items-center gap-2 p-3`}>
              <span className="text-sm font-medium text-dim">{t("Hai un codice sconto?")}</span>
              <input value={promoInput} onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoErr(""); }} placeholder={t("CODICE")} className="min-h-11 w-40 rounded-lg border border-line bg-paper px-3 py-1.5 text-base uppercase text-txt outline-none focus:border-focus focus-visible:ring-2 focus-visible:ring-focus/40 sm:min-h-0 sm:text-sm" aria-label={t("Hai un codice sconto?")} aria-invalid={!!promoErr || undefined} />
              <button onClick={() => applyPromoCode()} className="min-h-11 rounded-lg border border-line px-4 py-1.5 text-sm font-semibold text-focus hover:bg-wash sm:min-h-0 sm:px-3">{t("Applica")}</button>
              {appliedPromo && <span className="flex items-center gap-2 text-sm font-semibold text-txt"><span style={{ color: "var(--ok)" }} aria-hidden>✓</span> {appliedPromo.name || appliedPromo.code} · −{appliedPromo.pct}%<button onClick={() => { setAppliedPromo(null); setPromoInput(""); }} className="px-2 py-3 text-xs font-normal text-dim underline hover:text-[color:var(--err)] sm:py-1">{t("rimuovi")}</button></span>}
              {promoErr && <span role="alert" className="text-sm font-medium text-txt"><span style={{ color: "var(--err)" }} aria-hidden>!</span> {promoErr}</span>}
            </div>
            )}
            <div className="flex flex-col gap-3">
              {roomResults.map(({ rt, free, hasDeriv, cheapest, sellable, tooSmall, noRate }) => {
                return (
                  <div key={rt.id} id={`rt-${rt.id}`} className={`${box} overflow-hidden`}>
                    <div className="flex flex-col gap-3 p-4 sm:flex-row">
                      {(() => { const cover = getImages(`rt:${rt.id}`)[0]; return cover ? (
                        <MediaImg src={cover} alt={rt.name} className="h-28 w-full shrink-0 rounded-lg object-cover sm:w-40" />
                      ) : (
                        <div className="grid h-28 w-full shrink-0 place-items-center rounded-lg sm:w-40" style={{ background: `linear-gradient(135deg, ${rt.color ?? GUEST_DEFAULT_ACCENT}, color-mix(in srgb, ${rt.color ?? GUEST_DEFAULT_ACCENT} 55%, #000))` }}>
                          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.6" opacity="0.9"><path d="M3 8v11" /><path d="M3 13h18v6" /><path d="M21 19v-4a3 3 0 0 0-3-3h-7v4" /><circle cx="7" cy="11.5" r="1.4" /></svg>
                        </div>
                      ); })()}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-display text-lg font-bold text-txt">{rt.name}</div>
                            <div className="text-xs text-dim">{rt.beds} {rt.beds === 1 ? t("letto") : t("letti")} · {t("fino a")} {rt.maxOccupancy ?? rt.beds} {(rt.maxOccupancy ?? rt.beds) === 1 ? t("ospite") : t("ospiti")}{rt.size ? ` · ${rt.size} m²` : ""}</div>
                            {(rt.amenities ?? []).length > 0 && <div className="mt-1.5 flex flex-wrap items-center gap-2 text-dim">{(rt.amenities ?? []).slice(0, 8).map((a) => <span key={a} title={a} aria-label={a}>{amenityIcon(a)}</span>)}</div>}
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-dim">{t("da")}</div>
                            <div className="font-mono text-xl font-bold text-txt">{Number.isFinite(cheapest) ? eur(cheapest) : "—"}</div>
                            <div className="text-xs text-dim">{nightsTxt(nights)}</div>
                          </div>
                        </div>
                        {/* Opzioni: varianti (madre + derivate) × piani */}
                        {free > 0 && !tooSmall && !noRate ? (
                          <div className="mt-3 flex flex-col gap-2.5">
                            {sellable.map(({ v, offers }) => (
                              <div key={v.id} className="overflow-hidden rounded-lg border border-line">
                                {hasDeriv && (
                                  <div className="flex items-center justify-between gap-2 bg-wash px-3 py-1.5">
                                    <span className="text-xs font-semibold text-txt">{v.deriveFrom ? v.name : "Standard"} <span className="font-normal text-dim">· {t("fino a")} {v.maxOccupancy ?? v.beds} {(v.maxOccupancy ?? v.beds) === 1 ? t("ospite") : t("ospiti")}</span></span>
                                    {v.deriveFrom && <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>{t("variante")}</span>}
                                  </div>
                                )}
                                <div className="flex flex-col divide-y divide-[color:var(--line)]">
                                  {offers.map(({ p, price }) => (
                                    <div key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2">
                                      <div><span className="text-sm font-medium text-txt">{t(p.name)}</span> <span className="text-xs text-dim">· {t(p.board)} · {cancelLabel(p)}{planDepositPct(p) === 0 ? ` · ${t("nessun anticipo")}` : planDepositPct(p) === 100 ? ` · ${t("prepagato")}` : ` · ${t("acconto {pct}%", { pct: planDepositPct(p) })}`}</span></div>
                                      <div className="flex items-center gap-3">
                                        <span className="font-mono text-sm font-bold text-txt">{eur(price)}</span>
                                        <button onClick={() => { setSel({ rtId: v.id, planId: p.id }); setStep("checkout"); window.scrollTo(0, 0); }} className="min-h-11 rounded-lg bg-focus px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90 sm:min-h-9">{t("Scegli")}</button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-3 rounded-lg border border-line bg-wash px-3 py-2 text-sm text-dim">{tooSmall ? t("Capienza insufficiente per il numero di ospiti.") : noRate ? t("Tariffa non ancora disponibile per queste date.") : t("Non disponibile per le date scelte.")}</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {types.length === 0 && <div className={`${box} p-6 text-center text-sm text-dim`}>{t("Nessuna camera configurata per questa struttura.")}</div>}
              {allSoldOut && sibling && (
                <div className={`${box} overflow-hidden`} style={{ borderColor: "var(--focus)", borderWidth: 2 }}>
                  <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)" }}>🏠</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-txt">{t("{name} è al completo per queste date", { name: structure?.name ?? t("Questa struttura") })}</div>
                      <div className="mt-0.5 text-sm text-dim">
                        {t("Ma")} <b className="text-txt">{sibling.name}</b>{sibling.zone ? ` (${sibling.zone})` : sibling.city ? ` (${sibling.city})` : ""}, {t("un'altra struttura dello stesso gestore, ha disponibilità per le stesse date.")}
                      </div>
                    </div>
                    <a
                      href={`/prenota?site=${encodeURIComponent(sibling.slug)}&ci=${checkIn}&co=${checkOut}&ad=${adults}${children ? `&ch=${children}&ages=${childAges.join(",")}` : ""}`}
                      target={embed ? "_top" : undefined}
                      rel={embed ? "noreferrer" : undefined}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-focus px-4 py-2 text-center text-sm font-semibold text-white hover:opacity-90"
                    >
                      {t("Vedi disponibilità →")}
                    </a>
                  </div>
                </div>
              )}
              {allSoldOut && !sibling && networkAlts.length > 0 && (
                <div className={`${box} overflow-hidden`} style={{ borderColor: "var(--focus)", borderWidth: 2 }}>
                  <div className="flex items-start gap-3 p-4">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)" }}>🏠</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-txt">{t("{name} è al completo per queste date", { name: structure?.name ?? t("Questa struttura") })}</div>
                      <div className="mt-0.5 text-sm text-dim">{t("Altre strutture su Xenora hanno disponibilità per le stesse date:")}</div>
                      <div className="mt-3 flex flex-col gap-2">
                        {networkAlts.map((alt) => (
                          <div key={alt.slug} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-wash px-3 py-2">
                            <span className="text-sm text-txt"><b>{alt.name}</b>{alt.zone ? ` (${alt.zone})` : alt.city ? ` (${alt.city})` : ""}</span>
                            <a
                              href={`/prenota?site=${encodeURIComponent(alt.slug)}&ci=${checkIn}&co=${checkOut}&ad=${adults}${children ? `&ch=${children}&ages=${childAges.join(",")}` : ""}`}
                              target={embed ? "_top" : undefined}
                              rel={embed ? "noreferrer" : undefined}
                              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-focus px-4 py-1.5 text-center text-sm font-semibold text-white hover:opacity-90"
                            >
                              {t("Vedi disponibilità →")}
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {step === "checkout" && selRt && selPlan && (
          <div>
            <button onClick={() => setStep("rooms")} className="mb-3 inline-flex min-h-11 items-center text-sm font-medium text-txt underline hover:no-underline">← {t("Cambia camera")}</button>
            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-4">

              {/* Dati ospite */}
              <div className={`${box} p-4`}>
                <div className="mb-3 flex justify-end"><GuestLangPicker lang={lang} setLang={setLang} label={t("Lingua")} /></div>
                <h2 className="mb-3 font-display text-lg font-bold text-txt">{t("Dettagli ospite")}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-dim">{t("Nome")} *<input value={guest.firstName} maxLength={60} autoComplete="given-name" onChange={(e) => setGuest({ ...guest, firstName: e.target.value })} className={`${field} mt-1`} /></label>
                  <label className="block text-xs font-medium text-dim">{t("Cognome")} *<input value={guest.lastName} maxLength={60} autoComplete="family-name" onChange={(e) => setGuest({ ...guest, lastName: e.target.value })} className={`${field} mt-1`} /></label>
                  <label className="block text-xs font-medium text-dim">{t("Telefono")} *<input type="tel" inputMode="tel" autoComplete="tel" maxLength={30} value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} aria-invalid={(!!guest.phone.trim() && !phoneOk) || undefined} className={`${field} mt-1 ${guest.phone.trim() && !phoneOk ? fieldErr : ""}`} placeholder="+39…" />{guest.phone.trim() && !phoneOk && <span role="alert" className="mt-1 block text-xs font-medium text-txt"><span style={{ color: "var(--err)" }} aria-hidden>!</span> {t("Inserisci un numero di telefono valido.")}</span>}</label>
                  <label className="block text-xs font-medium text-dim">Email *<input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" maxLength={120} value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} aria-invalid={(!!guest.email.trim() && !emailOk) || undefined} className={`${field} mt-1 ${guest.email.trim() && !emailOk ? fieldErr : ""}`} />{guest.email.trim() && !emailOk && <span role="alert" className="mt-1 block text-xs font-medium text-txt"><span style={{ color: "var(--err)" }} aria-hidden>!</span> {t("Inserisci un indirizzo email valido.")}</span>}</label>
                  <label className="block text-xs font-medium text-dim">{t("Città")}<input value={guest.city} maxLength={60} autoComplete="address-level2" onChange={(e) => setGuest({ ...guest, city: e.target.value })} className={`${field} mt-1`} /></label>
                  <label className="block text-xs font-medium text-dim">{t("Nazione")}<input value={guest.country} maxLength={60} autoComplete="country-name" onChange={(e) => { setCountryTouched(true); setGuest({ ...guest, country: e.target.value }); }} className={`${field} mt-1`} /></label>
                </div>
                <label className="mt-3 block text-xs font-medium text-dim">{t("Orario di arrivo previsto")}<select value={guest.arrival} onChange={(e) => setGuest({ ...guest, arrival: e.target.value })} className={`${field} mt-1`}>{["Non lo so", "12:00-14:00", "14:00-16:00", "16:00-18:00", "18:00-20:00", "dopo le 20:00"].map((o) => <option key={o} value={o}>{o === "Non lo so" ? t("Non lo so") : o === "dopo le 20:00" ? t("dopo le 20:00") : o}</option>)}</select></label>
                <label className="mt-3 block text-xs font-medium text-dim">{t("Richieste speciali")}<textarea value={guest.requests} maxLength={500} onChange={(e) => setGuest({ ...guest, requests: e.target.value })} rows={2} className={`${field} mt-1 resize-y`} placeholder={t("Le richieste non sono garantite ma faremo il possibile.")} /></label>
              </div>

              {/* Servizi extra */}
              <div className={`${box} p-4`}>
                <h2 className="mb-1 font-display text-lg font-bold text-txt">{t("Servizi extra")}</h2>
                <p className="mb-3 text-xs text-dim">{t("Migliora il soggiorno aggiungendo i nostri servizi.")}</p>
                <div className="flex flex-col divide-y divide-[color:var(--line)]">
                  {extras.map((x) => (
                    <div key={x.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-txt">{x.name}</div>
                        {x.desc && <div className="text-xs text-dim">{x.desc}</div>}
                        <div className="mt-0.5 text-xs text-dim">{eur(x.price)} {x.per === "night" ? t("a notte") : x.per === "person" ? t("a persona") : x.per === "day" ? t("a giornata") : t("a soggiorno")}</div>
                      </div>
                      <Stepper label={x.name} value={extraQty[x.id] ?? 0} min={0} compact onChange={(v) => setExtraQty((q) => ({ ...q, [x.id]: v }))} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Pagamento */}
              <div className={`${box} p-4`}>
                <h2 className="mb-3 font-display text-lg font-bold text-txt">{t("Pagamento")}</h2>
                <p className="text-xs text-dim">{deposit <= 0
                  ? t("Nessun acconto richiesto: l'intero importo si salda in struttura.")
                  : deposit < total
                    ? t("Per confermare è richiesto un acconto di {amount}. Il saldo di {balance} si versa in struttura.", { amount: eur(deposit), balance: eur(total - deposit) })
                    : `${t("Per confermare è richiesto il pagamento dell'intero importo di {amount}.", { amount: eur(total) })}${selPlan.refundable ? "" : ` (${t("tariffa non rimborsabile")})`}`
                } {t("Il pagamento è gestito in modo sicuro da Stripe.")}</p>
                {deposit > 0 && (
                  <div className="mt-2 rounded-lg border border-line bg-wash px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-dim"><span>💳 {t("Carta")}</span><span aria-hidden>·</span><span>Google Pay / Apple Pay</span><span aria-hidden>·</span><span>PayPal</span><span aria-hidden>·</span><span>Klarna</span></div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 12%, transparent)", color: "var(--focus)" }}>
                      <span>🛍️</span><span>{t("Con Klarna puoi pagare in 3 rate senza interessi")}</span><span className="font-normal text-dim">{t("(dove disponibile)")}</span>
                    </div>
                  </div>
                )}
                <label className="mt-3 flex items-start gap-2 text-xs text-dim"><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[color:var(--focus)]" /> <span>{t("Dichiaro di aver preso visione dell'informativa privacy e accetto i termini di prenotazione.")} <a href={privacyHref} target="_blank" rel="noreferrer" className="font-medium text-focus underline">{t("Leggi l'informativa privacy")}</a></span></label>
              </div>
            </div>

            {/* Riepilogo */}
            <div className="lg:sticky lg:top-20 lg:self-start">
              <div className={`${box} p-4`}>
                <div className="mb-2 text-sm font-semibold text-txt">{fmtDate(checkIn)} → {fmtDate(checkOut)}</div>
                <div className="text-xs text-dim">{nightsTxt(nights)} · {adultsTxt(adults)}{children ? ` · ${childrenTxt(children)}` : ""}</div>
                <div className="my-3 border-t border-line" />
                <Line label={`${selRt.name} · ${t(selPlan.name)}`} value={eur(accommodation)} />
                {extras.filter((x) => (extraQty[x.id] ?? 0) > 0).map((x) => <Line key={x.id} label={`${extraQty[x.id]}× ${x.name}`} value={eur((extraQty[x.id] ?? 0) * extraPrice(x))} sub />)}
                {cityTax > 0 && <Line label={structure?.cityTaxMode === "percent" ? `${t("Tassa di soggiorno")} (${structure.cityTaxPercent ?? 0}%)` : t("Tassa di soggiorno")} value={eur(cityTax)} sub />}
                {discount > 0 && <div className="mt-1 flex items-baseline justify-between gap-3 text-xs font-medium text-txt"><span className="min-w-0">{t("Sconto")}{appliedPromo?.code ? ` ${appliedPromo.code}` : ""} (−{appliedPromo?.pct}%)</span><span className="shrink-0 font-mono">−{eur(discount)}</span></div>}
                <div className="my-2 border-t border-line" />
                <div className="flex items-baseline justify-between"><span className="text-sm font-semibold text-txt">{t("Totale")}</span><span className="font-mono text-xl font-bold text-txt">{eur(total)}</span></div>
                {deposit > 0 && <div className="mt-1 flex items-baseline justify-between text-xs"><span className="text-dim">{deposit < payBase ? t("Acconto adesso") : t("Da pagare adesso")}</span><span className="font-mono font-semibold text-txt">{eur(deposit)}</span></div>}
                {cityTax > 0 && deposit > 0 && <div className="mt-1 text-xs text-dim">{t("La tassa di soggiorno ({amount}) non si paga adesso: si salda in struttura.", { amount: eur(cityTax) })}</div>}
                <div className="mt-1 text-xs font-medium text-dim"><span style={{ color: selPlan.refundable ? "var(--ok)" : "var(--warn)" }} aria-hidden>●</span> {cancelLabel(selPlan)}</div>
                {bookError && <div role="alert" className="mt-3 rounded-lg border px-3 py-2 text-sm font-medium text-txt" style={{ borderColor: "var(--err)", backgroundColor: "color-mix(in srgb, var(--err) 8%, transparent)" }}>{t(bookError)}</div>}
                <button onClick={confirm} disabled={!guestValid || processing} className="mt-3 min-h-11 w-full rounded-lg bg-focus py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{processing ? t("Invio in corso…") : t("Conferma prenotazione")}</button>
                {!guestValid && <div className="mt-2 text-center text-xs text-dim">{t("Compila nome, cognome, telefono, email e accetta la privacy.")}</div>}
              </div>
            </div>
          </div>
          </div>
        )}
      </div>
      {!embed && footer}
    </div>
  );
}

function Stepper({ value, min = 0, onChange, compact, label }: { value: number; min?: number; onChange: (v: number) => void; compact?: boolean; label?: string }) {
  return (
    <div className={`mt-1 flex items-center ${compact ? "" : "w-full"} overflow-hidden rounded-lg border border-line`}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label={`${label ?? ""} −`.trim()} className="min-h-11 min-w-11 px-4 py-1.5 text-dim hover:bg-wash sm:min-h-0 sm:min-w-0 sm:px-3">−</button>
      <span className={`${compact ? "w-8" : "flex-1"} bg-paper py-1.5 text-center font-mono text-sm font-bold text-txt`}>{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} aria-label={`${label ?? ""} +`.trim()} className="min-h-11 min-w-11 px-4 py-1.5 text-dim hover:bg-wash sm:min-h-0 sm:min-w-0 sm:px-3">+</button>
    </div>
  );
}
function Line({ label, value, sub }: { label: string; value: string; sub?: boolean }) {
  return <div className={`flex items-baseline justify-between gap-3 ${sub ? "mt-1 text-xs text-dim" : "text-sm text-txt"}`}><span className="min-w-0">{label}</span><span className={`shrink-0 font-mono ${sub ? "" : "font-semibold"}`}>{value}</span></div>;
}
