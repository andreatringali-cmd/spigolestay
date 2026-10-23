// Pagina «Qualità»: indicatori calcolati sulle recensioni già presenti in Xenora (Booking.com / Airbnb / Expedia via Channex, dirette, manuali).
// Modulo puro, senza import: serve alla pagina e ai test. Voti sempre su scala 0..10 (Google 1..5 ×2); «5 stelle» = voto 9 o più.

export interface QReview { id: string; date: string; rating: number; text: string; source: string }

const DAY = 86400000;
const ymdToMs = (ymd: string): number => { const t = Date.parse(`${(ymd || "").slice(0, 10)}T12:00:00Z`); return Number.isFinite(t) ? t : NaN; };
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export const isFiveStar = (r: QReview): boolean => r.rating >= 9;

export interface QSummary { count: number; avg10: number | null; avg5: number | null; fiveStarPct: number | null; positivePct: number | null; negativePct: number | null }
export function summarize(reviews: QReview[]): QSummary {
  const rs = reviews.filter((r) => Number.isFinite(r.rating));
  const avg10 = mean(rs.map((r) => r.rating));
  const pct = (n: number) => (rs.length ? (n / rs.length) * 100 : null);
  return {
    count: rs.length,
    avg10,
    avg5: avg10 == null ? null : avg10 / 2,
    fiveStarPct: pct(rs.filter(isFiveStar).length),
    positivePct: pct(rs.filter((r) => r.rating >= 8).length),
    negativePct: pct(rs.filter((r) => r.rating < 6).length),
  };
}

/** Recensioni con data dentro l'intervallo [da, a) in giorni prima di `now` (da > a: «da 365 a 0 giorni fa»). */
export function inWindow(reviews: QReview[], fromDaysAgo: number, toDaysAgo: number, now: number): QReview[] {
  const lo = now - fromDaysAgo * DAY, hi = now - toDaysAgo * DAY;
  return reviews.filter((r) => { const t = ymdToMs(r.date); return Number.isFinite(t) && t >= lo && t < hi; });
}

export interface QCompare { current: QSummary; previous: QSummary; deltaAvg10: number | null; deltaFiveStarPts: number | null }
/** Ultimi N giorni contro i N giorni precedenti (N = 365 per «anno su anno», 30 per «mese su mese»). */
export function compareWindows(reviews: QReview[], days: number, now: number): QCompare {
  const current = summarize(inWindow(reviews, days, 0, now + DAY));
  const previous = summarize(inWindow(reviews, days * 2, days, now));
  return {
    current, previous,
    deltaAvg10: current.avg10 != null && previous.avg10 != null ? current.avg10 - previous.avg10 : null,
    deltaFiveStarPts: current.fiveStarPct != null && previous.fiveStarPct != null ? current.fiveStarPct - previous.fiveStarPct : null,
  };
}

export interface QMonth { key: string; label: string; count: number; avg10: number | null; fiveStarPct: number | null }
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
/** Ultimi `months` mesi (compreso quello in corso), dal più vecchio al più recente. */
export function monthlySeries(reviews: QReview[], months: number, now: number): QMonth[] {
  const d = new Date(now);
  const out: QMonth[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    const key = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
    const rs = reviews.filter((r) => (r.date || "").slice(0, 7) === key);
    const s = summarize(rs);
    out.push({ key, label: `${MESI[m.getUTCMonth()]} ${String(m.getUTCFullYear()).slice(2)}`, count: s.count, avg10: s.avg10, fiveStarPct: s.fiveStarPct });
  }
  return out;
}

export interface QTheme { key: string; label: string; count: number; share: number; example: string }
// Temi riconosciuti dalle parole usate (italiano e inglese). È un conteggio di parole, non una lettura del senso: la pagina lo dice.
const THEMES: { key: string; label: string; re: RegExp }[] = [
  { key: "pulizia", label: "Pulizia", re: /pulizi|sporc|polvere|macchi|capell|dirty|dust|stain|unclean|filth/i },
  { key: "rumore", label: "Rumore", re: /rumor|chiass|noisy|noise|loud/i },
  { key: "checkin", label: "Arrivo e accoglienza", re: /check-?in|accoglien|attes[ae]|reception|chiav|\bkey\b|istruzion|welcome|host/i },
  { key: "letto", label: "Letto e comfort", re: /\bletto|materass|cuscin|\bbed\b|mattress|pillow|comfort/i },
  { key: "bagno", label: "Bagno e acqua calda", re: /bagno|doccia|acqua calda|scarico|muffa|bathroom|shower|hot water|mold|mould/i },
  { key: "clima", label: "Caldo e freddo", re: /aria condizionata|climatizz|riscald|\bcaldo|\bfreddo|heating|air.?con|too hot|too cold/i },
  { key: "wifi", label: "Wi-Fi", re: /wi-?fi|internet/i },
  { key: "parcheggio", label: "Parcheggio", re: /parchegg|parking/i },
  { key: "posizione", label: "Posizione", re: /posizion|zona|centro|vicin|lontan|location|central|close to/i },
  { key: "prezzo", label: "Prezzo", re: /prezz|costos|\bcaro\b|price|expensive|value for money/i },
  { key: "colazione", label: "Colazione", re: /colazion|breakfast/i },
  { key: "spazio", label: "Spazi", re: /piccol[ao]|stretta|\bspazi|small|tiny|cramped|spacious|spazios/i },
];
export const THEME_LABELS = Object.fromEntries(THEMES.map((t) => [t.key, t.label]));

const snippet = (text: string, re: RegExp): string => {
  const t = (text || "").replace(/\s+/g, " ").trim();
  const m = re.exec(t);
  if (!m) return t.slice(0, 110);
  const start = Math.max(0, m.index - 50);
  return (start > 0 ? "…" : "") + t.slice(start, start + 120) + (start + 120 < t.length ? "…" : "");
};

/** Temi più citati nelle recensioni che soddisfano `pick` (es. voti sotto 8 per «cosa migliorare», voti da 9 per «cosa piace»). Max `top` temi, almeno 1 citazione. */
export function topThemes(reviews: QReview[], pick: (r: QReview) => boolean, top = 3): QTheme[] {
  const rs = reviews.filter((r) => pick(r) && (r.text || "").trim().length > 0);
  const out: QTheme[] = [];
  for (const t of THEMES) {
    const hit = rs.filter((r) => t.re.test(r.text));
    if (hit.length) out.push({ key: t.key, label: t.label, count: hit.length, share: rs.length ? hit.length / rs.length : 0, example: snippet(hit[0].text, t.re) });
  }
  return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "it")).slice(0, top);
}
export const toImprove = (reviews: QReview[], top = 3) => topThemes(reviews, (r) => r.rating < 8, top);
export const whatTheyLove = (reviews: QReview[], top = 3) => topThemes(reviews, (r) => r.rating >= 9, top);

export interface QChannel { source: string; count: number; avg10: number | null; fiveStarPct: number | null }
export function bySource(reviews: QReview[]): QChannel[] {
  const m = new Map<string, QReview[]>();
  for (const r of reviews) { const a = m.get(r.source) ?? []; a.push(r); m.set(r.source, a); }
  return [...m.entries()].map(([source, rs]) => { const s = summarize(rs); return { source, count: s.count, avg10: s.avg10, fiveStarPct: s.fiveStarPct }; }).sort((a, b) => b.count - a.count);
}

/** CSV delle recensioni (separatore «;», UTF-8 con BOM per Excel). */
export function reviewsCsv(reviews: QReview[]): string {
  const esc = (v: string | number) => { const s = String(v ?? "").replace(/\r?\n/g, " "); return /[";]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["Data", "Fonte", "Voto (su 10)", "Voto (su 5)", "Testo"];
  const rows = [...reviews].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((r) => [r.date, r.source, r.rating, (r.rating / 2).toFixed(1), r.text].map(esc).join(";"));
  return "﻿" + [head.join(";"), ...rows].join("\r\n");
}
