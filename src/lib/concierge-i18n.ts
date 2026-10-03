// Concierge multilingua (de / fr / es) — logica PURA, senza dipendenze da "@/…": è testata con `node --test` (tests/concierge-i18n.test.ts).
//
// La tabella concierge_entries ammette solo lang 'it' | 'en' (CHECK nel DB di produzione, NON si tocca). Le traduzioni in
// tedesco/francese/spagnolo vivono quindi FUORI dalla tabella, nel blob app_state del tenant (chiave TRANSLATIONS_KEY, scritta
// solo lato server: vedi concierge-translations.ts), indicizzate per id della voce originale + lingua.
import type { ConciergeEntry } from "./concierge-kb";

export type GuestLang = "it" | "en" | "de" | "fr" | "es";
export type TranslateLang = "de" | "fr" | "es";
export const TRANSLATE_LANGS: TranslateLang[] = ["de", "fr", "es"];
export const LANG_LABEL: Record<GuestLang, string> = { it: "Italiano", en: "Inglese", de: "Tedesco", fr: "Francese", es: "Spagnolo" };
export const isTranslateLang = (x: unknown): x is TranslateLang => x === "de" || x === "fr" || x === "es";
export const isGuestLang = (x: unknown): x is GuestLang => x === "it" || x === "en" || isTranslateLang(x);

// Chiave dedicata nel blob app_state. NON deve iniziare con "spigolestay:" né "xenora:" (stesso motivo di UNANSWERED_KEY:
// authsync sincronizza col browser solo quei prefissi e per le chiavi in comune "vince il locale", sovrascrivendo il server).
export const TRANSLATIONS_KEY = "concierge:translations:v1";

// ---------------------------------------------------------------------------------------------------------------------
// Lingua dell'ospite
// ---------------------------------------------------------------------------------------------------------------------
const NAMES: Record<string, GuestLang> = {
  ita: "it", italiano: "it", italian: "it", italiana: "it",
  eng: "en", english: "en", inglese: "en",
  deu: "de", ger: "de", german: "de", deutsch: "de", tedesco: "de", allemand: "de", aleman: "de",
  fra: "fr", fre: "fr", french: "fr", francais: "fr", francese: "fr", frances: "fr",
  spa: "es", spanish: "es", espanol: "es", spagnolo: "es", castellano: "es", espagnol: "es",
};
const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Codice/nome lingua dell'anagrafica ospite → lingua supportata. "other" = lingua nota ma non supportata (es. "ru"); "" = non indicata.
export function normalizeLang(raw?: string | null): GuestLang | "other" | "" {
  const g = strip(String(raw ?? "")).trim();
  if (!g) return "";
  if (isGuestLang(g)) return g;
  const pre = g.match(/^([a-z]{2})[-_ ]/)?.[1];
  if (pre && isGuestLang(pre)) return pre;
  if (NAMES[g]) return NAMES[g];
  return "other";
}

// Parole molto indicative (senza accenti), una lista per lingua; si evitano le parole condivise tra lingue.
const WORDS: Record<GuestLang, string[]> = {
  it: ["il", "gli", "che", "dove", "quando", "posso", "possiamo", "grazie", "ciao", "buongiorno", "buonasera", "colazione", "parcheggio", "chiave", "chiavi", "orario", "vorrei", "siamo", "abbiamo", "della", "nel", "nella", "anche", "non", "per", "favore", "camera", "arrivo", "quanto", "come", "ora"],
  en: ["the", "what", "where", "how", "when", "is", "are", "do", "does", "you", "can", "could", "please", "check", "password", "breakfast", "parking", "thanks", "thank", "hello", "hi", "we", "our", "there", "have", "any", "with", "your", "my", "to", "and"],
  de: ["der", "die", "das", "und", "ist", "wie", "wo", "wann", "ich", "wir", "haben", "konnen", "kann", "bitte", "danke", "hallo", "guten", "fruhstuck", "parkplatz", "schlussel", "wlan", "zimmer", "gibt", "nicht", "mit", "fur", "uhr", "eine", "einen", "zum", "zur", "welche", "passwort", "uns", "ihr", "sie"],
  fr: ["les", "des", "du", "est", "et", "ou", "comment", "quand", "je", "nous", "avons", "pouvons", "peut", "bonjour", "bonsoir", "merci", "vous", "plait", "dejeuner", "petit", "cle", "chambre", "pour", "avec", "quel", "quelle", "mot", "passe", "avez", "pouvez", "voudrais", "aimerions"],
  es: ["el", "los", "las", "y", "donde", "como", "cuando", "hola", "buenos", "dias", "gracias", "favor", "tenemos", "puedo", "podemos", "desayuno", "aparcamiento", "llave", "habitacion", "hay", "que", "para", "contrasena", "cual", "quiero", "queremos", "tienen", "puede"],
};
const WORD_SETS = (Object.keys(WORDS) as GuestLang[]).map((l) => [l, new Set(WORDS[l])] as const);

export interface LangDetection { lang: GuestLang | null; score: number; second: number; strong: boolean }
export function detectLang(text?: string | null): LangDetection {
  const words = strip(String(text ?? "")).split(/[^a-z0-9]+/).filter(Boolean);
  const scores = WORD_SETS.map(([l, set]) => ({ l, s: words.reduce((a, w) => a + (set.has(w) ? 1 : 0), 0) })).sort((a, b) => b.s - a.s);
  const top = scores[0], sec = scores[1];
  if (!top || top.s === 0 || top.s === sec.s) return { lang: null, score: top?.s ?? 0, second: sec?.s ?? 0, strong: false };
  return { lang: top.l, score: top.s, second: sec.s, strong: top.s >= 2 && top.s >= sec.s * 2 };
}

// Lingua in cui rispondere. Priorità: testo scritto con chiarezza in una lingua (>= 2 parole indicative e netto vantaggio),
// poi lingua indicata nell'anagrafica ospite (it/en/de/fr/es; altre lingue → inglese), poi indizi deboli dal testo, poi italiano.
// (L'anagrafica ha "it" come valore predefinito: se l'ospite scrive chiaramente in un'altra lingua, vince il testo.)
export function pickGuestLang(guestLanguage?: string | null, text?: string | null): GuestLang {
  const g = normalizeLang(guestLanguage);
  const det = detectLang(text);
  if (det.strong && det.lang && det.lang !== g) return det.lang;
  if (g === "other") return "en";
  if (g) return g;
  if (det.lang) return det.lang;
  return "it";
}

// ---------------------------------------------------------------------------------------------------------------------
// Impronta della voce originale (per segnalare "da aggiornare")
// ---------------------------------------------------------------------------------------------------------------------
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
type Src = Pick<ConciergeEntry, "title" | "body" | "field_type" | "auto_source">;
export const srcHashOf = (e: Src): string => cyrb53([e.title.trim(), e.body.trim(), e.field_type, e.auto_source ?? ""].join("\u0001"));

// ---------------------------------------------------------------------------------------------------------------------
// Elementi che NON si traducono mai + controllo
// ---------------------------------------------------------------------------------------------------------------------
const PH_RE = /\{\{\s*value\s*\}\}/g;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/gi;
const MAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LABEL_RE = /\b(?:password|pwd|psw|pin|ssid|passcode)\s*[:=]\s*["“«']?([^\s"”»',;]+)/gi;
const trimEnd = (s: string) => s.replace(/[.,;:!?)»”]+$/g, "");

export interface Tokens { placeholders: number; urls: string[]; emails: string[]; nums: string[]; codes: string[] }
const uniq = (a: string[]) => Array.from(new Set(a));

export function protectedTokens(text: string): Tokens {
  let t = text;
  const placeholders = (t.match(PH_RE) || []).length;
  t = t.replace(PH_RE, " ");
  const urls = uniq((t.match(URL_RE) || []).map(trimEnd));
  t = t.replace(URL_RE, " ");
  const emails = uniq((t.match(MAIL_RE) || []).map(trimEnd));
  t = t.replace(MAIL_RE, " ");
  const codes: string[] = [];
  for (const m of t.matchAll(LABEL_RE)) { const w = trimEnd(m[1]); if (w) codes.push(w); }
  for (const raw of t.split(/\s+/)) {
    const w = raw.replace(/^[^\w#@]+|[^\w#@]+$/g, "");
    if (w.length < 2) continue;
    if ((/[A-Z]/.test(w) && /\d/.test(w)) || /[_@#]/.test(w)) codes.push(w);
  }
  const nums = uniq(t.match(/\d+/g) || []);
  return { placeholders, urls, emails, nums, codes: uniq(codes) };
}

export interface ValidationResult { ok: boolean; errors: string[] }

// Controlla che nella traduzione compaiano IDENTICI tutti i token dell'originale (segnaposto, link, email, numeri/telefoni/orari,
// codici/password) e che non ne siano comparsi di nuovi (link, email, numeri lunghi). Se fallisce, la traduzione si scarta.
export function validateTranslation(src: { title: string; body: string }, tr: { title: string; body: string }): ValidationResult {
  const errors: string[] = [];
  if (!tr.title?.trim()) errors.push("titolo vuoto");
  if (!tr.body?.trim()) errors.push("testo vuoto");
  if (errors.length) return { ok: false, errors };
  const a = protectedTokens(`${src.title}\n${src.body}`);
  const trText = `${tr.title}\n${tr.body}`;
  const b = protectedTokens(trText);
  if (a.placeholders !== b.placeholders) errors.push(`segnaposto {{value}}: nell'originale ${a.placeholders}, nella traduzione ${b.placeholders}`);
  if (/\{\{/.test(trText.replace(PH_RE, ""))) errors.push("segnaposto {{…}} non valido nella traduzione");
  const miss = (label: string, need: string[], have: string[], inText = false) => {
    const lost = need.filter((x) => (inText ? !trText.includes(x) : !have.includes(x)));
    if (lost.length) errors.push(`${label} mancante o modificato: ${lost.slice(0, 4).join(", ")}`);
  };
  miss("link", a.urls, b.urls);
  miss("email", a.emails, b.emails);
  miss("numero/orario", a.nums, b.nums);
  miss("codice/password", a.codes, [], true);
  const added = (label: string, have: string[], need: string[]) => {
    const extra = have.filter((x) => !need.includes(x));
    if (extra.length) errors.push(`${label} non presente nell'originale: ${extra.slice(0, 3).join(", ")}`);
  };
  added("link", b.urls, a.urls);
  added("email", b.emails, a.emails);
  added("numero", b.nums.filter((n) => n.length >= 4), a.nums);
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------------------------------------------------
// Traduzioni salvate
// ---------------------------------------------------------------------------------------------------------------------
export interface TranslationItem {
  id: string;            // id della voce ORIGINALE (concierge_entries.id)
  lang: TranslateLang;
  title: string;
  body: string;
  ts: number;            // data della traduzione (epoch ms)
  reviewed: boolean;     // approvata/modificata a mano dal gestore
  srcHash: string;       // impronta dell'originale al momento della traduzione (se cambia → "da aggiornare")
  srcLang: "it" | "en";  // lingua della voce da cui si è tradotto
}
export const tKey = (id: string, lang: string) => `${id}|${lang}`;

export function parseTranslations(raw: unknown): TranslationItem[] {
  try {
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    const list = Array.isArray(p) ? p : Array.isArray((p as { items?: unknown })?.items) ? (p as { items: unknown[] }).items : [];
    return (list as Partial<TranslationItem>[]).filter((x): x is TranslationItem =>
      !!x && typeof x.id === "string" && isTranslateLang(x.lang) && typeof x.title === "string" && typeof x.body === "string" && typeof x.srcHash === "string");
  } catch { return []; }
}
export const toTranslationMap = (items: TranslationItem[]): Map<string, TranslationItem> => new Map(items.map((i) => [tKey(i.id, i.lang), i]));

export type TranslationState = "missing" | "draft" | "reviewed" | "stale";
export function translationState(master: Src, item?: TranslationItem | null): TranslationState {
  if (!item) return "missing";
  if (item.srcHash !== srcHashOf(master)) return "stale";
  return item.reviewed ? "reviewed" : "draft";
}

// Voci "sorgente" da tradurre: l'italiano è la lingua madre della base; una voce inglese entra solo se non ha il gemello italiano
// (stesso gruppo livello/struttura/categoria, stesso tipo e stessa sorgente automatica).
export function pickMasters<E extends ConciergeEntry>(list: E[]): E[] {
  const gk = (e: E) => `${e.level}|${e.property_id ?? ""}|${e.category}`;
  const itByGroup = new Map<string, E[]>();
  for (const e of list) if (e.lang === "it") (itByGroup.get(gk(e)) ?? itByGroup.set(gk(e), []).get(gk(e))!).push(e);
  return list.filter((e) => e.id && (e.lang === "it" || (e.lang === "en" && !(itByGroup.get(gk(e)) ?? []).some((i) => i.field_type === e.field_type && i.auto_source === e.auto_source))));
}

// Gemello inglese di una voce italiana: stesso gruppo, tipo e sorgente automatica; si abbinano per stesso sort_order, altrimenti
// per posizione ma SOLO se le voci italiane e inglesi di quel tipo sono in egual numero (mai abbinamenti incerti).
export function enTwinOf<E extends ConciergeEntry>(master: E, group: E[]): E | undefined {
  const same = (e: E) => e.field_type === master.field_type && e.auto_source === master.auto_source;
  const byOrder = (x: E, y: E) => x.sort_order - y.sort_order;
  const en = group.filter((e) => e.lang === "en" && same(e)).sort(byOrder);
  const it = group.filter((e) => e.lang === "it" && same(e)).sort(byOrder);
  const exact = en.find((e) => e.sort_order === master.sort_order);
  if (exact) return exact;
  if (en.length && en.length === it.length) return en[it.indexOf(master)];
  return undefined;
}

// Per un gruppo (stessa categoria e livello) nella lingua `lang` (de/fr/es): per ogni voce sorgente usa la traduzione se è
// aggiornata (una traduzione "da aggiornare" NON si usa: potrebbe contenere dati vecchi); altrimenti ripiega sull'inglese, poi
// sull'italiano. Restituisce voci con titolo/testo già nella lingua scelta, le altre proprietà (categoria, telefono…) restano
// quelle dell'originale: telefono, indirizzo e mappa non si traducono mai.
export function pickTranslatedGroup<E extends ConciergeEntry>(group: E[], lang: TranslateLang, tr: Map<string, TranslationItem>): E[] {
  return pickMasters(group).map((m) => {
    const t = m.id ? tr.get(tKey(m.id, lang)) : undefined;
    if (t && t.srcHash === srcHashOf(m)) return { ...m, title: t.title, body: t.body };
    if (m.lang === "it") { const tw = enTwinOf(m, group); if (tw) return tw; }
    return m;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Risposta dell'AI di traduzione
// ---------------------------------------------------------------------------------------------------------------------
export const chunk = <T,>(a: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

// Estrae {"items":[{id,title,body}]} dal testo dell'AI. Ignora id non richiesti; gli id mancanti restano fuori dalla mappa.
export function parseTranslateResponse(text: string, wantedIds: string[]): Map<string, { title: string; body: string }> {
  const out = new Map<string, { title: string; body: string }>();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return out;
  let j: unknown;
  try { j = JSON.parse(m[0]); } catch { return out; }
  const items = Array.isArray((j as { items?: unknown })?.items) ? (j as { items: unknown[] }).items : [];
  const want = new Set(wantedIds);
  for (const it of items as { id?: unknown; title?: unknown; body?: unknown }[]) {
    if (typeof it?.id === "string" && want.has(it.id) && typeof it.title === "string" && typeof it.body === "string") out.set(it.id, { title: it.title.trim(), body: it.body.trim() });
  }
  return out;
}
