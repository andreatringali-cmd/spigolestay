// Punteggi per categoria delle recensioni Channex (Reviews Collection API) — moduli PURI, senza
// import con alias "@/" così i test Node li caricano direttamente.
//
// Forme documentate da Channex (docs.channex.io → Reviews Collection):
//  • Review.scores            = array di { category, score }   (es. clean, comfort, facilities, location, staff, value)
//  • GET /scores/:property_id = attributes { count, overall_score, scores: { <categoria>: { count, score } } }
//  • GET /scores/:property_id/detailed = come sopra + relationships.ota_scores[]: data { id, attributes { ota, channel_id, count, overall_score, scores } }
// overall_score ha massimo 10; per le singole categorie la doc NON dichiara la scala (gli esempi
// stanno tra 0 e 10): qui i valori sono tenuti nel range 0..10 e mai riscalati/inventati.
// Mappa categorie (doc): Booking = clean, facilities, location, services, staff, value, comfort;
// Airbnb = cleanliness→clean, location, value, accuracy, communication, checkin. Per Expedia la doc
// non elenca alcuna categoria: se non arriva nulla il dato resta assente (la UI mostra «n/d»).

export type ReviewChannel = "booking" | "airbnb" | "expedia";
export const REVIEW_CHANNELS: ReviewChannel[] = ["booking", "airbnb", "expedia"];

export interface ReviewScore { key: string; label: string; score: number }
export interface CategoryScore { key: string; label: string; score: number; count: number }
export interface ScoreSummary { overall: number | null; count: number; categories: CategoryScore[] }
export interface DetailedScores { property: ScoreSummary | null; byChannel: Partial<Record<ReviewChannel, ScoreSummary>> }

// Ordine di visualizzazione + etichette italiane. Le chiavi sconosciute non vengono scartate:
// finiscono in coda con l'etichetta ricavata dalla chiave.
const CATEGORY_ORDER = ["clean", "location", "staff", "services", "facilities", "comfort", "value", "accuracy", "communication", "checkin"];
const CATEGORY_LABEL: Record<string, string> = {
  clean: "Pulizia",
  location: "Posizione",
  staff: "Personale",
  services: "Servizi",
  facilities: "Strutture e dotazioni",
  comfort: "Comfort",
  value: "Qualità/prezzo",
  accuracy: "Corrispondenza annuncio",
  communication: "Comunicazione",
  checkin: "Check-in",
};
// Sinonimi difensivi verso la chiave Channex (la doc già mappa cleanliness→clean).
const CATEGORY_ALIAS: Record<string, string> = {
  cleanliness: "clean",
  check_in: "checkin", "check-in": "checkin", arrival: "checkin",
  value_for_money: "value", "value-for-money": "value", price: "value",
  facility: "facilities", service: "services",
};

export function normalizeCategoryKey(raw: unknown): string {
  const k = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return CATEGORY_ALIAS[k] ?? k;
}
export function categoryLabel(key: string): string {
  if (CATEGORY_LABEL[key]) return CATEGORY_LABEL[key];
  const t = key.replace(/[_-]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Altro";
}
const orderOf = (key: string) => { const i = CATEGORY_ORDER.indexOf(key); return i < 0 ? CATEGORY_ORDER.length : i; };
const byOrder = (a: { key: string }, b: { key: string }) => orderOf(a.key) - orderOf(b.key) || a.key.localeCompare(b.key);

// Numero valido (anche stringa numerica) → arrotondato a 1 decimale e tenuto in 0..10; altrimenti null.
export function cleanScore(v: unknown): number | null {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;
}
const cleanCount = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// Review.scores → elenco ordinato. Accetta l'array documentato [{category, score}] e, per
// tolleranza, una mappa { categoria: numero | {score} }. Valori nulli/non numerici → scartati
// (nessun «0» inventato); categoria ripetuta → vale l'ultima.
export function normalizeReviewScores(raw: unknown): ReviewScore[] {
  const out = new Map<string, number>();
  const put = (cat: unknown, val: unknown) => {
    const key = normalizeCategoryKey(cat);
    const s = cleanScore(val);
    if (key && s != null) out.set(key, s);
  };
  if (Array.isArray(raw)) {
    for (const it of raw) if (isObj(it)) put(it.category ?? it.name ?? it.key, it.score ?? it.value ?? it.rating);
  } else if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw)) put(k, isObj(v) ? v.score : v);
  }
  return Array.from(out, ([key, score]) => ({ key, label: categoryLabel(key), score })).sort(byOrder);
}

// attributes di /scores/:property_id o di un ota_score → riepilogo. null se non c'è nessun dato.
export function normalizeScoreSummary(raw: unknown): ScoreSummary | null {
  if (!isObj(raw)) return null;
  const overall = cleanScore(raw.overall_score);
  const categories: CategoryScore[] = [];
  const sc = raw.scores;
  if (isObj(sc)) {
    for (const [k, v] of Object.entries(sc)) {
      const key = normalizeCategoryKey(k);
      const score = cleanScore(isObj(v) ? v.score : v);
      if (key && score != null) categories.push({ key, label: categoryLabel(key), score, count: isObj(v) ? cleanCount(v.count) : 0 });
    }
  } else if (Array.isArray(sc)) {
    for (const r of normalizeReviewScores(sc)) categories.push({ ...r, count: 0 });
  }
  categories.sort(byOrder);
  const count = cleanCount(raw.count);
  if (overall == null && categories.length === 0) return null;
  return { overall, count, categories };
}

// Risposta di GET /scores/:property_id/detailed (oggetto «data» della risposta JSON:API).
export function parseDetailedScores(data: unknown): DetailedScores {
  const d = isObj(data) ? data : {};
  const property = normalizeScoreSummary(isObj(d.attributes) ? d.attributes : null);
  const byChannel: Partial<Record<ReviewChannel, ScoreSummary>> = {};
  const rel = isObj(d.relationships) ? d.relationships : {};
  const list = isObj(rel.ota_scores) ? rel.ota_scores.data : rel.ota_scores;
  if (Array.isArray(list)) {
    for (const it of list) {
      // forma documentata: { data: { attributes } } ; tolleriamo anche { attributes }
      const node = isObj(it) ? (isObj(it.data) ? it.data : it) : null;
      const attrs = node && isObj(node.attributes) ? node.attributes : null;
      if (!attrs) continue;
      const ch = channelOfOta(attrs.ota);
      const sum = normalizeScoreSummary(attrs);
      if (ch && sum) byChannel[ch] = mergeSummaries([byChannel[ch], sum]) ?? sum;
    }
  }
  return { property, byChannel };
}

// "BookingCom" | "AirBNB" | "Expedia" → canale (stessa logica di channelFromOta, ma senza dipendenze).
export function channelOfOta(ota: unknown): ReviewChannel | null {
  const s = String(ota ?? "").toLowerCase();
  if (s.includes("book")) return "booking";
  if (s.includes("airbnb")) return "airbnb";
  if (s.includes("expedia") || s.includes("vrbo") || s.includes("homeaway")) return "expedia";
  return null;
}

// Unisce più riepiloghi (es. più property Channex della stessa struttura): medie pesate sui count.
// Se un riepilogo non ha count si conta come 1, così il suo valore non sparisce.
export function mergeSummaries(list: (ScoreSummary | null | undefined)[]): ScoreSummary | null {
  const xs = list.filter((x): x is ScoreSummary => !!x);
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0];
  const w = (n: number) => (n > 0 ? n : 1);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const withOverall = xs.filter((x) => x.overall != null);
  const wSum = withOverall.reduce((a, x) => a + w(x.count), 0);
  const overall = wSum ? r1(withOverall.reduce((a, x) => a + (x.overall as number) * w(x.count), 0) / wSum) : null;
  const acc = new Map<string, { sum: number; wt: number; count: number }>();
  for (const x of xs) for (const c of x.categories) {
    const cur = acc.get(c.key) ?? { sum: 0, wt: 0, count: 0 };
    cur.sum += c.score * w(c.count); cur.wt += w(c.count); cur.count += c.count;
    acc.set(c.key, cur);
  }
  const categories = Array.from(acc, ([key, v]) => ({ key, label: categoryLabel(key), score: r1(v.sum / v.wt), count: v.count })).sort(byOrder);
  return { overall, count: xs.reduce((a, x) => a + x.count, 0), categories };
}

// Media per categoria calcolata dalle singole recensioni scaricate (ripiego quando Channex non
// fornisce il riepilogo ufficiale per quel canale). `count` = n. recensioni che hanno quella categoria.
export function summarizeFromReviews(reviews: { scores?: ReviewScore[] }[]): ScoreSummary | null {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const r of reviews) for (const s of r.scores ?? []) {
    const cur = acc.get(s.key) ?? { sum: 0, n: 0 };
    cur.sum += s.score; cur.n += 1; acc.set(s.key, cur);
  }
  if (!acc.size) return null;
  const categories = Array.from(acc, ([key, v]) => ({ key, label: categoryLabel(key), score: Math.round((v.sum / v.n) * 10) / 10, count: v.n })).sort(byOrder);
  return { overall: null, count: reviews.length, categories };
}
