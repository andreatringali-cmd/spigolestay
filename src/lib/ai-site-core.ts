// [parte pura] Xenosite leggibile dagli ASSISTENTI AI (ChatGPT, Gemini, Perplexity, Claude…) e dai motori di ricerca.
// Il mini-sito pubblico si costruisce nel browser: chi non esegue JavaScript (quasi tutti i crawler) vedeva una pagina vuota.
// Qui, dallo stesso snapshot pubblico (tabella public_sites), si ricavano — LATO SERVER — tre cose:
//   1) una scheda strutturata (schema.org JSON-LD) e un riepilogo testuale, inseriti nella pagina;
//   2) un file llms.txt e un'API JSON con la scheda della struttura;
//   3) un preventivo: per date e ospiti, quali camere sono libere e quanto costano (con link diretto per prenotare).
// REGOLA: si espongono SOLO campi pubblici scelti uno per uno (mai l'oggetto intero della struttura: contiene codici d'accesso,
// dati fiscali e riferimenti di pagamento). L'assistente non prenota al posto dell'ospite: lo manda al link di prenotazione.
import type { RoomType } from "./types";

/** Le funzioni di prezzo dell'app: si passano da fuori (ai-site.ts) così questo file resta puro e collaudabile. */
export interface PricingDeps {
  effectiveBase(rt: RoomType, all: RoomType[]): number;
  effectiveClosed(rt: RoomType, all: RoomType[]): boolean;
  weekendPctFromRaw(raw: string | null | undefined, structureId?: string): number;
}

const DATA_KEY = "spigolestay:data:v1";
type Json = Record<string, unknown>;
const str = (v: unknown, max = 600): string | undefined => { const s = typeof v === "string" ? v.trim() : ""; return s ? s.slice(0, max) : undefined; };
const num = (v: unknown): number | undefined => (typeof v === "number" && isFinite(v) ? v : undefined);
const httpUrl = (v: unknown): string | undefined => { const s = str(v, 300); return s && /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : undefined; };
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

export interface AiRoom { id: string; name: string; description?: string; maxGuests?: number; beds?: number; sizeSqm?: number; bedConfig?: string; amenities: string[]; fromPrice?: number; minStay?: number }
export interface AiSite {
  slug: string; name: string; type?: string; tagline?: string; description?: string;
  city?: string; zone?: string; province?: string; region?: string; country?: string; postalCode?: string; address?: string;
  lat?: number; lng?: number; phone?: string; email?: string; website?: string; whatsapp?: string; sameAs: string[];
  checkInFrom?: string; checkInTo?: string; checkOutBy?: string; selfCheckin?: boolean;
  services: string[]; currency: string; languages: string[];
  policies: { cancellation: string; pets?: boolean; smoking?: boolean; minAge?: number; depositPct?: number; cityTax?: string; payMethods: string[] };
  rooms: AiRoom[]; rating?: { value5: number; count: number };
  bookingUrl: string;
}
export interface AiQuoteData { structureId: string; roomTypes: RoomType[]; units: Json[]; bookings: Json[]; rateOverrides: Record<string, number>; rulesRaw?: string; site: AiSite; deps: PricingDeps }

const CANCEL_TEXT: Record<string, string> = {
  flessibile: "Cancellazione gratuita fino a 1 giorno prima dell'arrivo.",
  moderata: "Cancellazione gratuita fino a 5 giorni prima dell'arrivo.",
  rigida: "Tariffa non rimborsabile o con penale: vedi le condizioni al momento della prenotazione.",
};

export function isoCurrency(raw?: string): string {
  const s = (raw || "").trim();
  if (!s) return "EUR";
  if (/eur|€/i.test(s)) return "EUR";
  if (/usd|\$/i.test(s)) return "USD";
  if (/gbp|£/i.test(s)) return "GBP";
  if (/chf/i.test(s)) return "CHF";
  const a = s.replace(/[^a-z]/gi, "").toUpperCase();
  return /^[A-Z]{3}$/.test(a) ? a : "EUR";
}

const isWeekendISO = (iso: string) => { const d = new Date(iso + "T00:00:00Z").getUTCDay(); return d === 5 || d === 6 || d === 0; };
const addDaysISO = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** Dalla riga di public_sites ai soli dati pubblici (testabile senza database). */
export function buildAiSite(slug: string, rowData: Record<string, string>, row: { structure_id?: string; structure_name?: string }, origin: string, deps: PricingDeps): AiQuoteData | null {
  const { effectiveBase, effectiveClosed, weekendPctFromRaw } = deps;
  let blob: Json = {};
  try { blob = JSON.parse(rowData[DATA_KEY] || "{}") as Json; } catch { return null; }
  const structs = arr(blob.structures);
  const st = structs.find((s) => s.id === row.structure_id) || structs[0];
  if (!st) return null;
  const sid = String(st.id || row.structure_id || "");
  const allTypes = arr(blob.roomTypes) as unknown as RoomType[];
  const overrides = (blob.rateOverrides && typeof blob.rateOverrides === "object" ? blob.rateOverrides : {}) as Record<string, number>;
  const rulesRaw = rowData["spigolestay:pricerules"];
  const currency = isoCurrency(str(st.currency, 10));
  let cfg: Json = {};
  try { cfg = JSON.parse(rowData["spigolestay:sito"] || "{}") as Json; } catch { cfg = {}; }

  const sellable = allTypes.filter((rt) => rt.structureId === sid && !effectiveClosed(rt, allTypes) && (rt as { showSite?: boolean }).showSite !== false);
  const masters = sellable.filter((rt) => !rt.deriveFrom || !sellable.some((x) => x.id === rt.deriveFrom));
  const weekendPct = weekendPctFromRaw(rulesRaw, sid);
  const base = (rt: RoomType, iso: string) => {
    const raw = overrides[`${rt.id}|${iso}`] ?? overrides[iso] ?? Math.round(effectiveBase(rt, allTypes) * (isWeekendISO(iso) ? 1 + weekendPct / 100 : 1));
    return Math.max(0, Math.round(raw));
  };
  const rooms: AiRoom[] = masters.map((rt) => ({
    id: rt.id, name: rt.name, description: str(rt.description), maxGuests: num(rt.maxOccupancy), beds: num(rt.beds), sizeSqm: num(rt.size),
    bedConfig: str(rt.bedConfig, 80), amenities: (rt.amenities ?? []).filter((x) => typeof x === "string").slice(0, 20), minStay: num(rt.minStay),
    fromPrice: (() => { const p = effectiveBase(rt, allTypes); return p > 0 ? Math.round(p) : undefined; })(),
  }));

  const reviews = arr(blob.directReviews).filter((r) => r.structureId === sid && typeof r.rating === "number");
  const rating = reviews.length ? { value5: Math.round((reviews.reduce((a, r) => a + (r.rating as number), 0) / reviews.length / 2) * 10) / 10, count: reviews.length } : undefined;

  let cityTax: string | undefined;
  if (st.cityTax) {
    const cap = num(st.cityTaxMaxNights);
    cityTax = st.cityTaxMode === "percent"
      ? `Tassa di soggiorno non inclusa: ${num(st.cityTaxPercent) ?? 0}% del pernottamento a persona a notte${num(st.cityTaxCap) ? `, massimo ${num(st.cityTaxCap)} € a notte` : ""}${cap ? `, per un massimo di ${cap} notti` : ""}.`
      : `Tassa di soggiorno non inclusa: ${num(st.cityTaxAmount) ?? 0} € a persona a notte${cap ? `, per un massimo di ${cap} notti` : ""}.`;
  }
  const lang = str(st.language, 10);
  const name = str(cfg.nome, 120) || str(st.name, 120) || row.structure_name || slug;
  const site: AiSite = {
    slug, name, type: str(st.type, 60), tagline: str(cfg.tagline, 200), description: str(st.description, 1500),
    city: str(st.city, 80), zone: str(st.zone, 80), province: str(st.province, 40), region: str(st.region, 60), country: str(st.country, 60) || "Italia",
    postalCode: str(st.postalCode, 12), address: [str(st.address, 120), str(st.streetNumber, 12)].filter(Boolean).join(" ") || undefined,
    lat: num(st.lat), lng: num(st.lng), phone: str(st.phone, 40), email: str(st.email, 120), website: httpUrl(st.website), whatsapp: str(st.whatsapp, 40),
    sameAs: [httpUrl(st.website), httpUrl(st.facebook), httpUrl(st.instagram), httpUrl(st.tiktok)].filter((x): x is string => !!x),
    checkInFrom: str(st.checkInFrom, 8), checkInTo: str(st.checkInTo, 8), checkOutBy: str(st.checkOutBy, 8),
    selfCheckin: typeof st.selfCheckin === "boolean" ? st.selfCheckin : undefined,
    services: (Array.isArray(st.services) ? st.services : []).filter((x): x is string => typeof x === "string").slice(0, 30),
    currency, languages: lang ? [lang] : ["it"],
    policies: {
      cancellation: CANCEL_TEXT[String(st.cancelPolicy || "flessibile")] ?? CANCEL_TEXT.flessibile,
      pets: typeof st.pets === "boolean" ? st.pets : undefined, smoking: typeof st.smoking === "boolean" ? st.smoking : undefined,
      minAge: num(st.minAge), depositPct: num(st.depositPct), cityTax,
      payMethods: (Array.isArray(st.payMethods) ? st.payMethods : []).filter((x): x is string => typeof x === "string").slice(0, 8),
    },
    rooms, rating, bookingUrl: `${origin}/prenota?site=${encodeURIComponent(slug)}`,
  };
  return { structureId: sid, roomTypes: allTypes, units: arr(blob.units), bookings: arr(blob.bookings), rateOverrides: overrides, rulesRaw, site, deps };
}

export interface QuoteOption { roomTypeId: string; name: string; availableRooms: number; total: number; averagePerNight: number; currency: string; nightly: { date: string; price: number }[]; cancellation: string; bookingUrl: string }
export interface QuoteResult { slug: string; checkIn: string; checkOut: string; nights: number; adults: number; children: number; currency: string; options: QuoteOption[]; unavailable: { roomTypeId: string; name: string; reason: string }[]; notes: string[]; generatedAt: string }

/** Preventivo indicativo per date e ospiti: camere libere (blocchi e manutenzioni contano come occupato) e prezzo del soggiorno, con link per prenotare. */
export function buildQuote(d: AiQuoteData, ci: string, co: string, adults: number, children: number, origin: string): QuoteResult {
  const { effectiveBase, weekendPctFromRaw } = d.deps;
  const nights: string[] = [];
  for (let t = ci; t < co && nights.length < 90; t = addDaysISO(t, 1)) nights.push(t);
  const weekendPct = weekendPctFromRaw(d.rulesRaw, d.structureId);
  const priceOf = (rt: RoomType, iso: string) => {
    const raw = d.rateOverrides[`${rt.id}|${iso}`] ?? d.rateOverrides[iso] ?? Math.round(effectiveBase(rt, d.roomTypes) * (isWeekendISO(iso) ? 1 + weekendPct / 100 : 1));
    return Math.max(0, Math.round(raw));
  };
  const options: QuoteOption[] = [];
  const unavailable: QuoteResult["unavailable"] = [];
  const guests = adults + children;
  for (const room of d.site.rooms) {
    const rt = d.roomTypes.find((x) => x.id === room.id);
    if (!rt) continue;
    if (room.maxGuests && guests > room.maxGuests) { unavailable.push({ roomTypeId: rt.id, name: rt.name, reason: `Ospiti massimi: ${room.maxGuests}` }); continue; }
    if (room.minStay && nights.length < room.minStay) { unavailable.push({ roomTypeId: rt.id, name: rt.name, reason: `Soggiorno minimo: ${room.minStay} notti` }); continue; }
    const ofType = d.units.filter((u) => u.roomTypeId === rt.id && !u.outOfService);
    const busyFor = (uid: unknown) => d.bookings.some((b) => b.unitId === uid && b.status !== "cancelled" && String(b.checkIn) < co && String(b.checkOut) > ci);
    if (ofType.length > 0 && !ofType.some((u) => !busyFor(u.id))) { unavailable.push({ roomTypeId: rt.id, name: rt.name, reason: "Nessuna camera libera nelle date richieste" }); continue; }
    const prices = nights.map((date) => ({ date, price: priceOf(rt, date) }));
    const total = prices.reduce((a, p) => a + p.price, 0);
    if (total <= 0) { unavailable.push({ roomTypeId: rt.id, name: rt.name, reason: "Prezzo non disponibile online: contatta la struttura" }); continue; }
    const availableRooms = ofType.filter((u) => !busyFor(u.id)).length;
    options.push({
      roomTypeId: rt.id, name: rt.name, availableRooms, total, averagePerNight: Math.round(total / nights.length), currency: d.site.currency, nightly: prices,
      cancellation: d.site.policies.cancellation,
      bookingUrl: `${origin}/prenota?site=${encodeURIComponent(d.site.slug)}&checkin=${ci}&checkout=${co}&rt=${encodeURIComponent(rt.id)}&adults=${adults}&children=${children}`,
    });
  }
  options.sort((a, b) => a.total - b.total);
  const notes = ["Prezzi indicativi del soggiorno, tassa di soggiorno esclusa: il prezzo definitivo si conferma nella pagina di prenotazione.", "La prenotazione si completa sul sito della struttura, non tramite questa interfaccia."];
  if (d.site.policies.cityTax) notes.push(d.site.policies.cityTax);
  return { slug: d.site.slug, checkIn: ci, checkOut: co, nights: nights.length, adults, children, currency: d.site.currency, options, unavailable, notes, generatedAt: new Date().toISOString() };
}

/** schema.org per i motori di ricerca e gli assistenti. */
export function buildJsonLd(site: AiSite, origin: string): Json {
  const pageUrl = `${origin}/${site.slug}`;
  const prices = site.rooms.map((r) => r.fromPrice).filter((p): p is number => !!p);
  const ld: Json = {
    "@context": "https://schema.org",
    "@type": /b&b|bed|colazione/i.test(site.type || "") ? "BedAndBreakfast" : "LodgingBusiness",
    "@id": pageUrl, name: site.name, url: pageUrl,
    ...(site.description || site.tagline ? { description: site.description || site.tagline } : {}),
    ...(site.phone ? { telephone: site.phone } : {}), ...(site.email ? { email: site.email } : {}),
    address: { "@type": "PostalAddress", ...(site.address ? { streetAddress: site.address } : {}), ...(site.city ? { addressLocality: site.city } : {}), ...(site.province ? { addressRegion: site.province } : {}), ...(site.postalCode ? { postalCode: site.postalCode } : {}), addressCountry: site.country === "Italia" ? "IT" : (site.country || "IT") },
    ...(site.lat !== undefined && site.lng !== undefined ? { geo: { "@type": "GeoCoordinates", latitude: site.lat, longitude: site.lng } } : {}),
    ...(site.checkInFrom ? { checkinTime: site.checkInFrom } : {}), ...(site.checkOutBy ? { checkoutTime: site.checkOutBy } : {}),
    ...(site.policies.pets !== undefined ? { petsAllowed: site.policies.pets } : {}),
    ...(prices.length ? { priceRange: `da ${site.currency === "EUR" ? "€" : site.currency + " "}${Math.min(...prices)}` } : {}),
    numberOfRooms: site.rooms.length,
    ...(site.services.length ? { amenityFeature: site.services.map((s) => ({ "@type": "LocationFeatureSpecification", name: s, value: true })) } : {}),
    ...(site.sameAs.length ? { sameAs: site.sameAs } : {}),
    ...(site.rating ? { aggregateRating: { "@type": "AggregateRating", ratingValue: site.rating.value5, bestRating: 5, ratingCount: site.rating.count } } : {}),
    containsPlace: site.rooms.map((r) => ({
      "@type": "HotelRoom", name: r.name, ...(r.description ? { description: r.description } : {}),
      ...(r.maxGuests ? { occupancy: { "@type": "QuantitativeValue", maxValue: r.maxGuests } } : {}), ...(r.bedConfig ? { bed: { "@type": "BedDetails", typeOfBed: r.bedConfig } } : {}),
      ...(r.sizeSqm ? { floorSize: { "@type": "QuantitativeValue", value: r.sizeSqm, unitCode: "MTK" } } : {}),
      ...(r.amenities.length ? { amenityFeature: r.amenities.map((a) => ({ "@type": "LocationFeatureSpecification", name: a, value: true })) } : {}),
    })),
    potentialAction: { "@type": "ReserveAction", name: "Prenota", target: { "@type": "EntryPoint", urlTemplate: `${origin}/prenota?site=${encodeURIComponent(site.slug)}&checkin={checkin}&checkout={checkout}&adults={adults}`, actionPlatform: ["http://schema.org/DesktopWebPlatform", "http://schema.org/MobileWebPlatform"] } },
  };
  return ld;
}

/** Riepilogo testuale per i modelli linguistici (llms.txt). */
export function buildLlmsTxt(site: AiSite, origin: string): string {
  const L: string[] = [];
  const pageUrl = `${origin}/${site.slug}`;
  L.push(`# ${site.name}`, "");
  if (site.tagline || site.description) L.push(`> ${site.tagline || site.description}`, "");
  const where = [site.address, site.postalCode, site.city, site.province, site.country].filter(Boolean).join(", ");
  L.push("## Dove", where || "Indirizzo non indicato", "");
  const contact = [site.phone && `Telefono: ${site.phone}`, site.email && `Email: ${site.email}`, site.whatsapp && `WhatsApp: ${site.whatsapp}`, site.website && `Sito: ${site.website}`].filter(Boolean);
  if (contact.length) L.push("## Contatti", ...contact.map((c) => `- ${c}`), "");
  const times = [site.checkInFrom && `Check-in dalle ${site.checkInFrom}${site.checkInTo ? ` alle ${site.checkInTo}` : ""}`, site.checkOutBy && `Check-out entro le ${site.checkOutBy}`, site.selfCheckin ? "Self check-in disponibile" : ""].filter(Boolean);
  if (times.length) L.push("## Orari", ...times.map((c) => `- ${c}`), "");
  if (site.services.length) L.push("## Servizi", site.services.join(", "), "");
  if (site.rooms.length) {
    L.push("## Camere");
    for (const r of site.rooms) L.push(`- **${r.name}**${r.maxGuests ? ` · fino a ${r.maxGuests} ospiti` : ""}${r.bedConfig ? ` · ${r.bedConfig}` : ""}${r.sizeSqm ? ` · ${r.sizeSqm} mq` : ""}${r.fromPrice ? ` · da ${r.fromPrice} ${site.currency} a notte` : ""}${r.description ? `: ${r.description}` : ""}`);
    L.push("");
  }
  L.push("## Condizioni", `- ${site.policies.cancellation}`);
  if (site.policies.cityTax) L.push(`- ${site.policies.cityTax}`);
  if (site.policies.pets !== undefined) L.push(`- Animali: ${site.policies.pets ? "ammessi" : "non ammessi"}`);
  if (site.policies.smoking !== undefined) L.push(`- Fumo: ${site.policies.smoking ? "consentito" : "vietato"}`);
  if (site.policies.minAge) L.push(`- Età minima per il check-in: ${site.policies.minAge} anni`);
  if (site.policies.payMethods.length) L.push(`- Pagamenti: ${site.policies.payMethods.join(", ")}`);
  if (site.rating) L.push("", "## Recensioni", `Valutazione media ${site.rating.value5}/5 su ${site.rating.count} recensioni dirette.`);
  L.push("", "## Come prenotare (senza commissioni)",
    `Prenotazione diretta: ${site.bookingUrl}`,
    `Scheda strutturata (JSON): ${origin}/api/ai/${site.slug}`,
    `Disponibilità e prezzo per date e ospiti (JSON): ${origin}/api/ai/${site.slug}/quote?checkin=AAAA-MM-GG&checkout=AAAA-MM-GG&adults=2`,
    "La prenotazione si completa sempre sul sito della struttura: i prezzi dell'interfaccia sono indicativi e si confermano al momento della prenotazione.",
    `Pagina del sito: ${pageUrl}`, "");
  return L.join("\n");
}
