// Difese della Guida ospiti contro la perdita di contenuti. Logica PURA (niente browser né rete), usata dalla pagina, dalla fusione dei dati tra dispositivi e provata dai test.
//
// PERCHÉ: la guida di una struttura è un record JSON dentro la chiave piatta `spigolestay:guides` (mappa id struttura → guida). Una guida PIENA poteva essere sostituita da una più VUOTA in tre modi:
//  1) la pagina caricava la mappa UNA volta all'apertura e a ogni salvataggio riscriveva la mappa INTERA dalla copia in memoria (anche se nel frattempo un'altra scheda o la sincronizzazione
//     aveva aggiornato la chiave): chi salvava per ultimo cancellava il lavoro altrui;
//  2) se nella mappa locale la struttura non c'era (locale arrivato da un altro account, lettura fallita, struttura non ancora caricata), l'allineamento automatico con i dati struttura creava
//     una guida NUOVA con lo scaffold vuoto (nome, indirizzo, telefono, email, mappa, social, logo e le sezioni senza testi) e la sincronizzazione la portava sul server sopra quella piena;
//  3) la fusione tra dispositivi trattava `guides` come un blocco unico: vinceva una copia intera, anche la più povera.
// REGOLA unica delle difese: un campo PIENO non viene mai sostituito da un campo VUOTO, a meno di un'azione esplicita (il titolare che modifica quel campo, «Parti dall'esempio», «Copia da…»).

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

export const GUIDES_KEY = "spigolestay:guides";

// ── Vuoto / pieno ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Vuoto = undefined, null, testo senza lettere, array vuoto, oggetto con tutti i campi vuoti. Numeri e booleani NON sono mai vuoti (un interruttore spento è una scelta, non un vuoto). */
export function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0 || v.every(isEmptyValue);
  if (isRec(v)) return Object.values(v).every(isEmptyValue);
  return false;
}

// Campi che non sono "contenuto" ma struttura (id, icona, tipo, codice): non contano per misurare quanto testo c'è.
const NON_TEXT_KEYS = new Set(["id", "icon", "type", "code", "href", "tel", "bg", "target"]);
function collectText(v: unknown, out: string[], key = ""): void {
  if (typeof v === "string") { if (!NON_TEXT_KEYS.has(key) && v.trim()) out.push(v.trim()); return; }
  if (Array.isArray(v)) { for (const x of v) collectText(x, out, key); return; }
  if (isRec(v)) for (const [k, x] of Object.entries(v)) collectText(x, out, k);
}
/** Quantità di testo (caratteri) di un contenuto guida: serve a dire quale di due versioni è la più ricca. */
export function contentTextSize(content: unknown): number {
  const parts: string[] = []; collectText(content, parts);
  return parts.reduce((n, p) => n + p.length, 0);
}
/** Parole di testo di un contenuto guida (per il messaggio di conferma). */
export function contentWords(content: unknown): number {
  const parts: string[] = []; collectText(content, parts);
  return parts.join(" ").split(/\s+/).filter(Boolean).length;
}
// Il contenuto ha qualcosa di scritto davvero (non solo lo scaffold di titoli)? Stessa idea di «hasRealContent» della pagina e di guideHasText (guide-copy.ts), ma senza dipendenze.
export function contentHasText(content: unknown): boolean {
  const c = content as { home?: { welcomeTitle?: string; welcomeSub?: string; welcome?: string[] }; sections?: { intro?: string; photos?: unknown[]; amenities?: unknown[]; items?: { h?: string; p?: string; list?: unknown[] }[]; steps?: { h?: string; p?: string }[] }[] } | null | undefined;
  if (!c || !isRec(c)) return false;
  const h = c.home;
  if (h && (h.welcomeTitle?.trim() || h.welcomeSub?.trim() || (Array.isArray(h.welcome) ? h.welcome : []).join("").trim())) return true;
  return (Array.isArray(c.sections) ? c.sections : []).some((s) =>
    !!s?.intro?.trim() || !!s?.photos?.length || !!s?.amenities?.length ||
    !!s?.items?.some((it) => it.h?.trim() || it.p?.trim() || (it.list?.length ?? 0) > 0) ||
    !!s?.steps?.some((st) => st.h?.trim() || st.p?.trim()));
}

// ── Confronto per contenuto ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "undefined";
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const o = v as Rec;
  return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
}
const eq = (a: unknown, b: unknown): boolean => a === b || canon(a) === canon(b);

// ── Scrittura protetta ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Calcola la guida da salvare partendo da quella già salvata (`prev`) e da quella nuova (`next`): ogni campo che era PIENO in `prev` e in `next` è VUOTO (o manca) resta com'era,
 * a meno che sia tra i campi `explicit` (percorsi come "wifiPassword" o "social"; un percorso copre anche i suoi sotto-campi). `restored` elenca i percorsi ripristinati.
 *  - `content`: protetto in blocco (se il nuovo contenuto non ha alcun testo e il vecchio sì, resta il vecchio);
 *  - `i18n` (traduzioni): protetto lingua per lingua;
 *  - oggetti semplici (social, tv, roomTypes…): campo per campo;
 *  - liste e testi: per intero.
 */
export function protectGuideWrite(prev: unknown, next: Rec, explicit: readonly string[] = []): { guide: Rec; restored: string[] } {
  const restored: string[] = [];
  if (!isRec(prev)) return { guide: next, restored };
  const isExplicit = (path: string) => explicit.some((e) => path === e || path.startsWith(e + "."));
  const walk = (path: string, p: unknown, n: unknown): unknown => {
    if (isExplicit(path)) return n;
    if (path === "content") return contentHasText(p) && !contentHasText(n) ? (restored.push(path), p) : n;
    if (path === "i18n" && isRec(p)) {
      if (!isRec(n) && !isEmptyValue(p)) { restored.push(path); return p; }
      const out: Rec = isRec(n) ? { ...n } : {};
      for (const lang of Object.keys(p)) {
        if (contentHasText(p[lang]) && !contentHasText(out[lang]) && !isExplicit("i18n." + lang)) { out[lang] = p[lang]; restored.push("i18n." + lang); }
      }
      return out;
    }
    if (!isEmptyValue(p) && isEmptyValue(n)) { restored.push(path); return p; }
    if (isRec(p) && isRec(n)) {
      const out: Rec = {};
      for (const k of new Set([...Object.keys(p), ...Object.keys(n)])) { const v = walk(path + "." + k, p[k], n[k]); if (v !== undefined) out[k] = v; }
      return out;
    }
    return n;
  };
  const out: Rec = {};
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { const v = walk(k, prev[k], next[k]); if (v !== undefined) out[k] = v; }
  return { guide: out, restored };
}

/**
 * Applica una modifica alla mappa delle guide LETTA ORA da `stored` (mai dalla copia in memoria della pagina): cambia solo la guida di `sid`, le altre restano com'erano.
 * `patch` = campi cambiati; `explicit` = quali di questi sono una scelta del titolare (di solito tutte le chiavi di `patch`).
 */
export function commitGuidePatch(stored: Record<string, unknown> | null | undefined, sid: string, patch: Rec, explicit: readonly string[], fallback: Rec): { map: Record<string, unknown>; guide: Rec; restored: string[] } {
  const map = isRec(stored) ? stored : {};
  const prev = isRec(map[sid]) ? (map[sid] as Rec) : undefined;
  const next: Rec = { ...(prev ?? fallback), ...patch, id: sid };
  const { guide, restored } = protectGuideWrite(prev, next, explicit);
  return { map: { ...map, [sid]: guide }, guide, restored };
}

/**
 * Percorsi «espliciti» dei dati che la pagina allinea dalla struttura: SOLO quelli con un valore (per `social` le sole sotto-chiavi piene).
 * Un dato struttura vuoto non è una scelta del titolare (la struttura può non essere ancora caricata o compilata): non deve svuotare il campo pieno della guida.
 */
export function structExplicitKeys(fields: Rec): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (isRec(v)) { for (const [k2, v2] of Object.entries(v)) if (!isEmptyValue(v2)) out.push(k + "." + k2); }
    else if (!isEmptyValue(v)) out.push(k);
  }
  return out;
}

// ── Fusione tra dispositivi ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Fonde le due versioni (locale e server) della guida di UNA struttura. Il vincitore si sceglie come per le altre chiavi piatte (a 3 vie con la base: locale invariato → server; server invariato →
 * locale; entrambi cambiati → locale; senza base → server); poi i campi che il vincitore ha VUOTI e il perdente PIENI vengono rimessi, se la perdita è sospetta:
 *  - senza base (non si può sapere se è voluta): sempre;
 *  - con base: se si perdono 3 o più campi, o il contenuto, o le traduzioni (una guida che si svuota tutta insieme non è mai una scelta: è uno scaffold sovrascritto).
 * Un campo solo svuotato (es. la password del Wi-Fi tolta di proposito) passa, quindi i valori si possono ancora cancellare.
 */
export function mergeGuideRecords(base: unknown, local: unknown, server: unknown): unknown {
  if (!isRec(local) || !isRec(server)) return server !== undefined ? server : local;
  if (eq(local, server)) return local;
  const hasBase = isRec(base);
  let winner: Rec, loser: Rec;
  if (hasBase && eq(local, base)) { winner = server; loser = local; }
  else if (hasBase && eq(server, base)) { winner = local; loser = server; }
  else if (hasBase) { winner = local; loser = server; }
  else { winner = server; loser = local; }
  const { guide, restored } = protectGuideWrite(loser, winner, []);
  if (!restored.length) return winner;
  const counted = restored.filter((p) => p !== "wifiQr" && p !== "wifiQrFor"); // il QR del Wi-Fi si rigenera da solo: non conta come campo perso
  if (!counted.length) return winner;
  const suspicious = !hasBase || counted.length >= 3 || restored.some((p) => p === "content" || p === "i18n" || p.startsWith("i18n."));
  return suspicious ? guide : winner;
}

/**
 * Fonde la mappa `spigolestay:guides` (testo JSON) guida per guida. Ritorna il testo JSON fuso, o null se uno dei due lati non è una mappa valida (allora decide il chiamante).
 * Strutture presenti da una parte sola restano; la fusione non toglie mai una guida.
 */
export function mergeGuidesMap(baseRaw: string | undefined, localRaw: string | undefined, serverRaw: string | undefined): string | null {
  const parse = (r: string | undefined): Rec | null => { if (r === undefined) return null; try { const p = JSON.parse(r); return isRec(p) ? p : null; } catch { return null; } };
  const local = parse(localRaw), server = parse(serverRaw);
  if (!local || !server) return null;
  const base = parse(baseRaw);
  const out: Rec = {};
  for (const id of new Set([...Object.keys(server), ...Object.keys(local)])) {
    const l = local[id], s = server[id];
    out[id] = l === undefined ? s : s === undefined ? l : mergeGuideRecords(base?.[id], l, s);
  }
  return JSON.stringify(out);
}

// ── Riepilogo per il messaggio di conferma ───────────────────────────────────────────────────────────────────────────────────────────
export interface GuideSummary { sections: string[]; sectionCount: number; words: number; languages: string[]; hasTv: boolean }
const LANG_NAMES: Record<string, string> = { en: "inglese", fr: "francese", de: "tedesco", es: "spagnolo" };
/** Cosa c'è di scritto nella guida: sezioni con testi (titoli), parole, lingue già tradotte. */
export function summarizeGuide(guide: unknown): GuideSummary {
  const g = isRec(guide) ? guide : {};
  const c = isRec(g.content) ? g.content : {};
  const secs = (Array.isArray(c.sections) ? c.sections : []).filter((s): s is Rec => isRec(s) && contentHasText({ sections: [s] }));
  const titles = secs.map((s) => (typeof s.title === "string" && s.title.trim() ? s.title.trim() : String(s.id ?? "")));
  const home = contentHasText({ home: c.home, sections: [] });
  const i18n = isRec(g.i18n) ? g.i18n : {};
  return {
    sections: titles, sectionCount: titles.length + (home ? 1 : 0),
    words: contentWords({ home: c.home, sections: secs }),
    languages: Object.keys(i18n).filter((l) => contentHasText(i18n[l])).map((l) => LANG_NAMES[l] ?? l),
    hasTv: isRec(g.tv) && !!(g.tv as Rec).enabled,
  };
}

/** Testo (italiano, chiaro) per chiedere conferma prima di sostituire i testi della guida con quelli dell'esempio o di un'altra struttura. */
export function replaceConfirmMessage(guideName: string, sum: GuideSummary, source: "esempio" | "struttura", sourceName = ""): string {
  const nome = guideName.trim() ? `«${guideName.trim()}»` : "questa struttura";
  const shown = sum.sections.slice(0, 5).join(", ") + (sum.sections.length > 5 ? ` e altre ${sum.sections.length - 5}` : "");
  const righe = [`La guida di ${nome} ha già dei contenuti scritti:`];
  righe.push(`• benvenuto e ${sum.sections.length} ${sum.sections.length === 1 ? "sezione compilata" : "sezioni compilate"}${shown ? ` (${shown})` : ""}`);
  righe.push(`• circa ${sum.words.toLocaleString("it-IT")} parole di testo`);
  if (sum.languages.length) righe.push(`• traduzioni già fatte: ${sum.languages.join(", ")}`);
  const da = source === "esempio" ? "quelli dell'esempio di Siracusa" : `quelli di «${sourceName}»`;
  const traduzioni = source === "esempio" ? "Le traduzioni vengono cancellate e rigenerate." : "Le traduzioni già fatte vengono copiate insieme ai testi.";
  return `${righe.join("\n")}\n\nSe continui, TUTTI questi testi vengono SOSTITUITI con ${da}. ${traduzioni}\nIndirizzo, telefoni, Wi-Fi, orari e link non vengono toccati.\n\nSubito dopo potrai tornare indietro con «Annulla ultima sostituzione» (finché non chiudi la scheda).`;
}

// ── Copia di salvataggio per «Annulla ultima sostituzione» ───────────────────────────────────────────────────────────────────────────
// Per la sessione: in memoria (sempre) e, se c'è spazio, in sessionStorage (sopravvive a un ricaricamento della pagina, non alla chiusura della scheda). NON è una chiave sincronizzata:
// resta su questo dispositivo e non finisce sul server.
export interface UndoSlot { guide: Rec; at: number; label: string }
const undoMem = new Map<string, UndoSlot>();
const UNDO_PREFIX = "xn-guide-undo:";
type SessionLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const session = (): SessionLike | null => { try { return typeof sessionStorage !== "undefined" ? sessionStorage : null; } catch { return null; } };

/** Salva la guida COM'ERA prima di una sostituzione. Sostituisce l'eventuale copia precedente della stessa struttura. */
export function rememberGuideUndo(sid: string, guide: unknown, label: string, now = Date.now(), store: SessionLike | null = session()): boolean {
  if (!sid || !isRec(guide)) return false;
  const slot: UndoSlot = { guide: JSON.parse(JSON.stringify(guide)) as Rec, at: now, label };
  undoMem.set(sid, slot);
  try { store?.setItem(UNDO_PREFIX + sid, JSON.stringify(slot)); } catch { /* sessionStorage pieno: resta la copia in memoria */ }
  return true;
}
/** La copia di salvataggio della struttura (senza toglierla). */
export function peekGuideUndo(sid: string, store: SessionLike | null = session()): UndoSlot | null {
  const m = undoMem.get(sid); if (m) return m;
  try { const raw = store?.getItem(UNDO_PREFIX + sid); if (raw) { const s = JSON.parse(raw) as UndoSlot; if (s && isRec(s.guide)) { undoMem.set(sid, s); return s; } } } catch { /* copia rovinata: si ignora */ }
  return null;
}
/** Toglie la copia di salvataggio (dopo l'annullamento). */
export function clearGuideUndo(sid: string, store: SessionLike | null = session()): void {
  undoMem.delete(sid);
  try { store?.removeItem(UNDO_PREFIX + sid); } catch { /* niente */ }
}
/** Solo per i test. */
export function __resetGuideUndoForTests(): void { undoMem.clear(); }
