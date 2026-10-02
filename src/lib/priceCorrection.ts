// ============================================================
//  Correzione prezzo OTA — logica PURA (nessuna dipendenza da React/store/rete).
//  Condivisa da: route /api/channex/price-correction, pagina Canali, componente
//  PriceCorrectionPanel e test (tests/price-correction.test.ts).
//
//  COSA È REALE E COSA È STIMA
//  - La correzione (regola + valore) è REALE: sta su Channex (settings.derived_option) e la
//    leggiamo/scriviamo davvero tramite API.
//  - Il prezzo che l'OTA pubblica NON è leggibile da Channex: lo STIMIAMO applicando la
//    correzione al prezzo Xenora. Chi legge deve vedere sempre la dicitura "stima".
//  - Il netto è una stima: usa la commissione impostata per canale/struttura (o quella esatta
//    media delle prenotazioni), non quella che l'OTA applicherà davvero su quella data.
// ============================================================

export type CorrRule = "increase_by_percent" | "decrease_by_percent";
export interface Correction { rule: CorrRule; value: number }

export const CORR_MAX_INCREASE = 100;   // oltre +100% è quasi certamente un errore di battitura
export const CORR_WARN_ABS = 30;        // sopra ±30% chiediamo attenzione esplicita
export const CORR_BIG_CHANGE_POINTS = 10; // variazione ≥ 10 punti % rispetto a prima = "grossa"

const round2 = (n: number) => Math.round(n * 100) / 100;

// Normalizza ciò che arriva da Channex (regola + valore stringa) in una Correction, o null se assente/zero.
export function parseCorrection(rule?: string | null, value?: string | number | null): Correction | null {
  if (rule !== "increase_by_percent" && rule !== "decrease_by_percent") return null;
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return { rule, value: round2(n) };
}

// Percentuale con segno: +x se aumento, -x se riduzione, 0 se nessuna correzione.
export function signedPct(c: Correction | null): number {
  if (!c) return 0;
  return c.rule === "increase_by_percent" ? c.value : -c.value;
}

export function correctionLabel(c: Correction | null): string {
  if (!c) return "nessuna";
  return `${c.rule === "increase_by_percent" ? "+" : "−"}${c.value}%`;
}

export function sameCorrection(a: Correction | null, b: Correction | null): boolean {
  return signedPct(a) === signedPct(b);
}

// Prezzo stimato sull'OTA = prezzo Xenora corretto. (Channex arrotonda a modo suo: è una stima.)
export function applyCorrection(price: number, c: Correction | null): number {
  if (!Number.isFinite(price)) return 0;
  return round2(Math.max(0, price * (1 + signedPct(c) / 100)));
}

// Correzione che fa incassare sull'OTA lo stesso NETTO del prezzo diretto, data la commissione.
// netto OTA = prezzo × (1 + c) × (1 − comm)  ⇒  c = 1/(1 − comm) − 1. Es. 15% → +17,65%.
// null se la commissione non ha senso (≤0 o ≥100).
export function breakevenCorrection(commissionPct: number): Correction | null {
  if (!Number.isFinite(commissionPct) || commissionPct <= 0 || commissionPct >= 100) return null;
  const c = (1 / (1 - commissionPct / 100) - 1) * 100;
  return parseCorrection("increase_by_percent", round2(c));
}

export type InputCheck =
  | { ok: true; correction: Correction | null; warning?: string }
  | { ok: false; error: string };

// Valida l'input utente (regola + testo del valore). Valore vuoto o 0 = "nessuna correzione" (azzera).
export function validateCorrectionInput(rule: string, rawValue: string): InputCheck {
  if (rule !== "increase_by_percent" && rule !== "decrease_by_percent") return { ok: false, error: "Scegli se aumentare (+) o ridurre (−) il prezzo." };
  const txt = (rawValue ?? "").replace(",", ".").trim();
  if (txt === "") return { ok: true, correction: null };
  const n = Number(txt);
  if (!Number.isFinite(n)) return { ok: false, error: "Il valore non è un numero valido." };
  if (n < 0) return { ok: false, error: "Inserisci un valore positivo: il segno si sceglie con + / −." };
  if (n === 0) return { ok: true, correction: null };
  if (rule === "decrease_by_percent" && n >= 100) return { ok: false, error: "Una riduzione del 100% o più azzererebbe il prezzo sul canale." };
  if (rule === "increase_by_percent" && n > CORR_MAX_INCREASE) return { ok: false, error: `Un aumento superiore al ${CORR_MAX_INCREASE}% non è consentito: controlla di non aver sbagliato cifra.` };
  const value = round2(n);
  const c: Correction = { rule, value };
  const warning = value > CORR_WARN_ABS ? `Correzione molto alta (${correctionLabel(c)}): i prezzi sul canale cambieranno in modo marcato.` : undefined;
  return { ok: true, correction: c, ...(warning ? { warning } : {}) };
}

export interface ChangeDiff { changed: boolean; signFlip: boolean; deltaPoints: number; big: boolean }
// Differenza tra correzione attuale e nuova: serve all'anteprima per avvisare di cambi grossi / inversioni di segno.
export function diffCorrections(before: Correction | null, after: Correction | null): ChangeDiff {
  const b = signedPct(before), a = signedPct(after);
  const deltaPoints = round2(a - b);
  return { changed: deltaPoints !== 0, signFlip: (b > 0 && a < 0) || (b < 0 && a > 0), deltaPoints, big: Math.abs(deltaPoints) >= CORR_BIG_CHANGE_POINTS };
}

// ── Confronto prezzi ─────────────────────────────────────────

export interface PriceRowIn { date: string; roomTypeId: string; roomTypeName: string; xenora: number }
export interface PriceRow extends PriceRowIn {
  ota: number;           // prezzo stimato sull'OTA con la correzione considerata
  deltaEur: number;      // ota − xenora
  deltaPct: number;      // (ota − xenora) / xenora × 100 (0 se xenora = 0)
  commissionEur: number; // commissione stimata sul prezzo OTA
  netOta: number;        // ota − commissione
  netVsXenoraEur: number; // netOta − xenora: quanto in più/meno incassi rispetto alla vendita diretta allo stesso prezzo Xenora
}

export function compareRow(r: PriceRowIn, c: Correction | null, commissionPct: number): PriceRow {
  const ota = applyCorrection(r.xenora, c);
  const commissionEur = round2(ota * Math.max(0, commissionPct) / 100);
  const netOta = round2(ota - commissionEur);
  return {
    ...r,
    ota,
    deltaEur: round2(ota - r.xenora),
    deltaPct: r.xenora > 0 ? round2(((ota - r.xenora) / r.xenora) * 100) : 0,
    commissionEur,
    netOta,
    netVsXenoraEur: round2(netOta - r.xenora),
  };
}

export function compareRows(rows: PriceRowIn[], c: Correction | null, commissionPct: number): PriceRow[] {
  return rows.map((r) => compareRow(r, c, commissionPct));
}

export interface ComparisonSummary { n: number; avgXenora: number; avgOta: number; avgDeltaEur: number; avgNetOta: number; avgNetVsXenora: number }
export function summarizeComparison(rows: PriceRow[]): ComparisonSummary {
  const n = rows.length;
  if (n === 0) return { n: 0, avgXenora: 0, avgOta: 0, avgDeltaEur: 0, avgNetOta: 0, avgNetVsXenora: 0 };
  const avg = (f: (r: PriceRow) => number) => round2(rows.reduce((a, r) => a + f(r), 0) / n);
  return { n, avgXenora: avg((r) => r.xenora), avgOta: avg((r) => r.ota), avgDeltaEur: avg((r) => r.deltaEur), avgNetOta: avg((r) => r.netOta), avgNetVsXenora: avg((r) => r.netVsXenoraEur) };
}

// ── Discrepanze (parità prezzi) ──────────────────────────────

export interface ChannelCorrState { id: string; label: string; correction: Correction | null; commissionPct: number; active: boolean }
export interface ParityAlert { kind: "undercut" | "spread"; severity: "warn"; channelIds: string[]; message: string }

// Segnala le discrepanze oltre la soglia (in %):
//  - undercut: il prezzo OTA stimato è PIÙ BASSO del prezzo Xenora (= del tuo sito diretto) oltre la soglia →
//    l'ospite trova più conveniente l'OTA del tuo sito (rischio parità tariffaria, perdi prenotazioni dirette).
//  - spread: due canali ATTIVI differiscono tra loro oltre la soglia → incoerenza di prezzo tra OTA.
export function parityAlerts(channels: ChannelCorrState[], thresholdPct: number): ParityAlert[] {
  const out: ParityAlert[] = [];
  const th = Math.max(0, thresholdPct);
  const act = channels.filter((c) => c.active);
  for (const c of act) {
    const p = signedPct(c.correction);
    if (p < 0 && Math.abs(p) > th) out.push({ kind: "undercut", severity: "warn", channelIds: [c.id], message: `${c.label}: il prezzo stimato è ${Math.abs(p)}% più basso del tuo prezzo diretto (soglia ${th}%).` });
  }
  if (act.length >= 2) {
    const sorted = [...act].sort((a, b) => signedPct(a.correction) - signedPct(b.correction));
    const lo = sorted[0], hi = sorted[sorted.length - 1];
    const spread = round2(signedPct(hi.correction) - signedPct(lo.correction));
    if (spread > th) out.push({ kind: "spread", severity: "warn", channelIds: [lo.id, hi.id], message: `Differenza di ${spread} punti % tra ${hi.label} (${correctionLabel(hi.correction)}) e ${lo.label} (${correctionLabel(lo.correction)}): sopra la soglia di ${th}%.` });
  }
  return out;
}

// ── Errori Channex comprensibili ─────────────────────────────

// Traduce status HTTP + testo grezzo di Channex in un messaggio azionabile in italiano.
// `status` 0 = errore di rete/timeout (nessuna risposta dal server).
export function explainChannexError(status: number | undefined, raw?: string): string {
  const txt = raw ?? "";
  if (/CHANNEX_API_KEY/i.test(txt)) return "Il collegamento al Channel Manager non è configurato su questo ambiente.";
  if (txt) {
    try {
      const j = JSON.parse(txt) as { details?: Record<string, string[] | string>; message?: string; title?: string };
      const fields = j.details && typeof j.details === "object"
        ? Object.entries(j.details).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join("; ")
        : "";
      if (/hotel_id/i.test(fields) || /hotel_id/i.test(txt)) {
        return "Channex segnala che manca il campo \"Hotel Id\" nella configurazione di questo canale (impostazioni della connessione, non la correzione prezzo). Controllalo su Channex prima di riprovare.";
      }
      if (fields) return `Channex ha rifiutato la modifica (${fields}).`;
      if (j.message || j.title) return `Channex: ${j.message ?? j.title}`;
    } catch { /* non era JSON: si prosegue con lo status */ }
  }
  if (status === 401 || status === 403) return "Channex ha rifiutato l'accesso: la chiave API non è valida o non ha il permesso di modificare questo canale.";
  if (status === 404) return "Il canale non esiste più su Channex (forse è stato scollegato): aggiorna l'elenco dei canali.";
  if (status === 409) return "Il canale è in uso da un'altra operazione su Channex: riprova tra qualche istante.";
  if (status === 422) return "Channex non ha accettato i dati inviati: controlla la configurazione del canale su Channex.";
  if (status === 429) return "Troppe richieste verso Channex in poco tempo: attendi un minuto e riprova.";
  if (status && status >= 500) return "Channex è momentaneamente non raggiungibile: la correzione NON è stata salvata, riprova tra poco.";
  if (status === 0) return "Nessuna risposta da Channex (rete o timeout): la correzione NON è stata salvata, riprova.";
  if (txt) return txt.length > 200 ? "Salvataggio non riuscito (errore Channex non leggibile)." : txt;
  return "Salvataggio non riuscito.";
}

// ── Storico correzioni ───────────────────────────────────────

export type CorrLogKind = "set" | "reset" | "bulk" | "rollback" | "retry";
export interface CorrLogEntry {
  id: string;
  ts: number;
  structureId: string;
  channelId: string;
  channelLabel: string;
  kind: CorrLogKind;
  from: Correction | null;   // valore su Channex PRIMA (null = nessuna o sconosciuto se fromKnown=false)
  fromKnown: boolean;
  to: Correction | null;     // valore che si voleva impostare
  status: "ok" | "error";
  verified?: boolean;        // true se la rilettura da Channex ha confermato il valore
  error?: string;
  bulkId?: string;
}

export const CORR_LOG_KEY = "spigolestay:canali:corrlog";
export const CORR_LOG_MAX = 200;

export function parseCorrLog(raw: string | null | undefined): CorrLogEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && typeof e.id === "string" && typeof e.channelId === "string" && typeof e.ts === "number") as CorrLogEntry[];
  } catch { return []; }
}

// Una voce fallita è "ripetibile" solo se NON c'è una voce più recente OK per lo stesso canale
// (altrimenti ripeterla riporterebbe indietro un valore già superato).
export function canRetry(entry: CorrLogEntry, all: CorrLogEntry[]): boolean {
  if (entry.status !== "error") return false;
  return !all.some((e) => e.channelId === entry.channelId && e.status === "ok" && e.ts > entry.ts);
}

// Una voce OK è "ripristinabile" se è l'ULTIMA OK del canale e conosciamo il valore precedente.
export function canRollback(entry: CorrLogEntry, all: CorrLogEntry[]): boolean {
  if (entry.status !== "ok" || !entry.fromKnown || entry.kind === "rollback") return false;
  if (sameCorrection(entry.from, entry.to)) return false;
  return !all.some((e) => e.channelId === entry.channelId && e.status === "ok" && e.ts > entry.ts);
}

// Solo le voci della struttura in vista; con "all" tutte.
export function logForStructure(all: CorrLogEntry[], activeStructureId: string): CorrLogEntry[] {
  if (!activeStructureId || activeStructureId === "all") return all;
  return all.filter((e) => e.structureId === activeStructureId);
}

export const correctionToApi = (c: Correction | null): { rule: CorrRule; value: string } | null => (c ? { rule: c.rule, value: c.value.toFixed(2) } : null);
