import { cityTaxOf } from "@/lib/booking";
import type { Structure } from "@/lib/types";

// Base di conoscenza del Concierge (tabella concierge_entries).
// - level "shared" = vale per tutta l'area; "property" = specifico di una struttura (property_id).
// - A runtime si uniscono le due liste: se la struttura ha voci in una categoria, quelle SOSTITUISCONO le condivise.
// - Le voci field_type "auto" non contengono testo fisso: il valore ({{value}}) si legge dalla prenotazione dell'ospite.
// - Mappe e telefoni non sono salvati come link: i pulsanti si generano al volo da address / phone.

export type ConciergeLang = "it" | "en";
export type ConciergeCategory = "accesso" | "arrivo" | "checkin" | "regole" | "servizi" | "wifi" | "colazione" | "pagamenti" | "contatti" | "mare" | "cibo" | "cultura" | "dintorni" | "escursioni" | "recensioni";
export type AutoSource = "access_code" | "city_tax" | "checkin_time" | "checkout_time";

export interface ConciergeEntry {
  id?: string;
  level: "shared" | "property";
  property_id: string | null;
  category: ConciergeCategory | string;
  field_type: "editorial" | "auto";
  auto_source: AutoSource | null;
  title: string;
  body: string;
  lang: ConciergeLang;
  sort_order: number;
  phone?: string | null;
  address?: string | null;
  map_url?: string | null;
}

export const CATEGORY_ORDER: string[] = ["accesso", "arrivo", "checkin", "regole", "servizi", "wifi", "colazione", "pagamenti", "contatti", "mare", "cibo", "cultura", "dintorni", "escursioni", "recensioni"];
export const CATEGORY_LABEL: Record<string, string> = {
  accesso: "Accesso", arrivo: "Come arrivare", checkin: "Check-in / Check-out", regole: "Regole della casa", servizi: "Servizi", wifi: "Wi-Fi",
  colazione: "Colazione", pagamenti: "Pagamenti e imposte", contatti: "Contatti e assistenza", mare: "Mare e lidi", cibo: "Mangiare e bere",
  cultura: "Cultura e cosa vedere", dintorni: "Dintorni", escursioni: "Escursioni", recensioni: "Recensioni",
};
// Categorie riservate: mai a chi non ha una prenotazione in corso.
export const SENSITIVE_CATEGORIES = new Set<string>(["accesso", "wifi"]);

const T = {
  it: { map: "Apri la mappa", call: "Chiama", wa: "WhatsApp", pending: "ti verrà comunicato la mattina del check-in", taxPending: "calcolata sulla tua prenotazione", times: "orario da concordare", from: "dalle", to: "alle", by: "entro le" },
  en: { map: "Open map", call: "Call", wa: "WhatsApp", pending: "will be sent to you on the morning of check-in", taxPending: "calculated on your booking", times: "time to be agreed", from: "from", to: "to", by: "by" },
} as const;

// Italiano o inglese: altre lingue rispondono in inglese.
export function kbLang(guestLanguage?: string, text?: string): ConciergeLang {
  const g = (guestLanguage || "").toLowerCase();
  if (g === "it") return "it";
  if (g) return "en";
  if (text) {
    const en = (text.toLowerCase().match(/\b(the|what|where|how|when|is|are|do you|can i|could|please|check|wifi|password|breakfast|parking|thanks?|hello|hi)\b/g) || []).length;
    const it = (text.toLowerCase().match(/\b(il|la|che|dove|come|quando|posso|per favore|grazie|ciao|buongiorno|buonasera|colazione|parcheggio|chiave|ora|orario)\b/g) || []).length;
    if (en > it) return "en";
  }
  return "it";
}

// Unisce condiviso + struttura nella lingua richiesta (ripiego sull'italiano per gruppo/categoria mancante)
// e applica l'override: una categoria presente nella struttura nasconde la stessa categoria condivisa.
export function resolveEntries(all: ConciergeEntry[], propertyId: string, lang: ConciergeLang): ConciergeEntry[] {
  const groups = new Map<string, ConciergeEntry[]>();
  for (const e of all) {
    if (e.level === "property" && e.property_id !== propertyId) continue;
    const k = `${e.level}|${e.category}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
  }
  const chosen: ConciergeEntry[] = [];
  const propCats = new Set<string>();
  for (const [k, list] of groups) {
    const inLang = list.filter((e) => e.lang === lang);
    const pick = inLang.length ? inLang : list.filter((e) => e.lang === "it");
    if (!pick.length) continue;
    if (k.startsWith("property|")) propCats.add(pick[0].category);
    chosen.push(...pick);
  }
  return chosen
    .filter((e) => e.level === "property" || !propCats.has(e.category))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.sort_order - b.sort_order);
}

export interface AutoCtx {
  structure?: Structure;
  booking?: { checkIn: string; checkOut: string; adults?: number; total?: number; cityTaxExempt?: boolean };
  accessCode?: string; // codici della camera della prenotazione (vedi accessCodeOf)
}

const fmtDate = (iso: string) => { const [y, m, d] = (iso || "").split("-"); return y && m && d ? `${d}/${m}/${y}` : iso; };
const nightsOf = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));

// Codice d'accesso dalla prenotazione: stessa regola della guida (primi 3 codici della camera, filtrati per parcheggio).
export function accessCodeOf(roomAccessRaw: string | undefined, unitId: string | null | undefined, hasParking: boolean): string {
  try {
    const ra = JSON.parse(roomAccessRaw || "{}") as Record<string, { value?: string; cond?: string }[]>;
    const list = unitId ? ra[unitId] : null;
    if (!Array.isArray(list)) return "";
    return list
      .filter((c) => (c.cond === "parking" ? hasParking : c.cond === "noparking" ? !hasParking : true))
      .slice(0, 3).map((c) => (c.value || "").trim()).filter(Boolean).join("-");
  } catch { return ""; }
}

function autoValue(src: AutoSource, lang: ConciergeLang, ctx: AutoCtx): string {
  const t = T[lang];
  const st = ctx.structure, b = ctx.booking;
  if (src === "access_code") return ctx.accessCode || t.pending;
  if (src === "city_tax") {
    if (!st || !b) return t.taxPending;
    const eur = cityTaxOf(st, b.adults ?? 1, nightsOf(b.checkIn, b.checkOut), b.total ?? 0, b.cityTaxExempt);
    return `€ ${eur}`;
  }
  if (src === "checkin_time") {
    const fr = st?.checkInFrom, to = st?.checkInTo;
    const hours = fr ? `${t.from} ${fr}${to ? ` ${t.to} ${to}` : ""}` : "";
    const day = b ? fmtDate(b.checkIn) : "";
    return [day, hours].filter(Boolean).join(", ") || t.times;
  }
  const by = st?.checkOutBy;
  const hours = by ? `${t.by} ${by}` : "";
  const day = b ? fmtDate(b.checkOut) : "";
  return [day, hours].filter(Boolean).join(", ") || t.times;
}

export interface RenderedEntry { category: string; title: string; text: string; mapUrl: string; tel: string; waUrl: string; auto: boolean }

export function mapUrlOf(e: Pick<ConciergeEntry, "address" | "map_url">): string {
  if (e.map_url && e.map_url.trim()) return e.map_url.trim();
  if (e.address && e.address.trim()) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.address.trim())}`;
  return "";
}

export function renderEntry(e: ConciergeEntry, ctx: AutoCtx, lang: ConciergeLang): RenderedEntry {
  const value = e.field_type === "auto" && e.auto_source ? autoValue(e.auto_source, lang, ctx) : "";
  const text = e.field_type === "auto" ? e.body.replace(/\{\{\s*value\s*\}\}/g, value) : e.body;
  const digits = (e.phone || "").replace(/\D/g, "");
  return {
    category: e.category, title: e.title, text, auto: e.field_type === "auto",
    mapUrl: mapUrlOf(e),
    tel: digits ? `tel:+${digits.replace(/^\+/, "")}` : "",
    waUrl: digits ? `https://wa.me/${digits}` : "",
  };
}

const STOP = new Set(["il","lo","la","le","gli","un","una","di","a","da","in","con","su","per","tra","fra","e","o","ma","che","chi","cosa","come","dove","quando","quanto","quanti","posso","potete","puoi","c","ce","è","sono","ho","mi","ti","si","del","della","dei","delle","al","alla","nel","nella","ora","orario","the","a","an","of","to","in","on","at","for","and","or","is","are","do","does","can","i","you","we","what","where","how","when","there","your","my","me","it","be","have","please"]);
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// Tiene solo le voci che parlano di ciò che l'ospite chiede (confronto sulle radici delle parole: "bagagli" ≈ "bagaglio").
// Se nessuna voce combacia restituisce tutto: l'AI decide, un po' più lenta ma senza perdere risposte per sinonimi.
export function selectRelevant<T extends { topic: string; answer: string }>(items: T[], question: string, max = 10): T[] {
  const stems = Array.from(new Set(norm(question).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.slice(0, 4))));
  if (!stems.length) return items;
  const scored = items.map((it) => {
    const hay = norm(it.topic + " " + it.answer);
    const tp = norm(it.topic);
    let s = 0;
    for (const st of stems) { if (tp.includes(st)) s += 3; else if (hay.includes(st)) s += 1; }
    return { it, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.length ? scored.slice(0, max).map((x) => x.it) : items;
}

// Testo per il concierge/WhatsApp: i bottoni diventano righe con link (WhatsApp non ha bottoni nel testo libero).
export function toFaqItems(rendered: RenderedEntry[], lang: ConciergeLang): { topic: string; answer: string }[] {
  const t = T[lang];
  return rendered.map((r) => ({
    topic: r.title,
    answer: [r.text, r.mapUrl ? `📍 ${t.map}: ${r.mapUrl}` : "", r.tel ? `📞 ${t.call}: ${r.tel.replace("tel:", "")}${r.waUrl ? ` · ${t.wa}: ${r.waUrl}` : ""}` : ""].filter(Boolean).join("\n"),
  }));
}
