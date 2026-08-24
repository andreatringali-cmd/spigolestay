// Assistente in linguaggio naturale (locale, senza backend): interpreta domande in
// italiano e risponde sui dati reali dello store. Deterministico, istantaneo, privato.

import type { Booking, Guest, Structure, Unit, RoomType } from "./types";
import { eur } from "./format";

export interface SavedQuote { id: string; number: number; name: string; total: number; status: string; createdAt: string; structureId: string; checkIn: string; checkOut: string }

export interface AssistantCtx {
  bookings: Booking[];
  guests: Guest[];
  structures: Structure[];
  units: Unit[];
  roomTypes: RoomType[];
  quotes: SavedQuote[];
  activeStructureId: string;
  today: Date;
}

export interface AnswerItem { label: string; sub?: string; badge?: string; badgeColor?: string; bookingId?: string; href?: string }
export interface Answer {
  kind: "answer" | "empty" | "help";
  icon: string;
  title: string;
  metric?: string;
  detail?: string;
  items?: AnswerItem[];
  href?: string;
  hrefLabel?: string;
  suggestions?: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const fmtD = (i: string) => { const [y, m, d] = i.split("-"); return `${+d} ${MONTHS[+m - 1].slice(0, 3)}${y !== String(new Date().getFullYear()) ? " " + y : ""}`; };
const nights = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));

export const SUGGESTIONS = [
  "Quanto ho incassato questo mese?",
  "Chi arriva domani?",
  "Camere libere questo weekend",
  "Ospiti con animali",
  "Quanto devo ancora incassare?",
  "Cosa si pulisce oggi?",
  "Chi non ha fatto la schedina alloggiati?",
  "Occupazione di oggi",
];

// ── Parser di periodo (intervallo) e di giorno singolo ──
function parsePeriod(q: string, today: Date): { from: string; to: string; label: string } | null {
  const y0 = today.getFullYear();
  if (/mese\s+scors|scorso\s+mese/.test(q)) { const d = new Date(y0, today.getMonth() - 1, 1); const e = new Date(y0, today.getMonth(), 0); return { from: iso(d), to: iso(e), label: "il mese scorso" }; }
  for (let i = 0; i < 12; i++) if (new RegExp("\\b" + MONTHS[i]).test(q)) { const ym = q.match(/\b(20\d\d)\b/); const y = ym ? +ym[1] : y0; return { from: iso(new Date(y, i, 1)), to: iso(new Date(y, i + 1, 0)), label: `${MONTHS[i]} ${y}` }; }
  if (/quest['o]?\s*mese|\bmese\b/.test(q)) { const d = new Date(y0, today.getMonth(), 1); const e = new Date(y0, today.getMonth() + 1, 0); return { from: iso(d), to: iso(e), label: "questo mese" }; }
  if (/settimana\s+prossim|prossima\s+settimana/.test(q)) { const dow = (today.getDay() + 6) % 7; const mon = addDays(today, -dow + 7); return { from: iso(mon), to: iso(addDays(mon, 6)), label: "la prossima settimana" }; }
  if (/quest['a]?\s*settimana|\bsettimana\b/.test(q)) { const dow = (today.getDay() + 6) % 7; const mon = addDays(today, -dow); return { from: iso(mon), to: iso(addDays(mon, 6)), label: "questa settimana" }; }
  if (/weekend|fine\s+settimana/.test(q)) { const dow = today.getDay(); const sat = addDays(today, (6 - dow + 7) % 7); return { from: iso(sat), to: iso(addDays(sat, 1)), label: "questo weekend" }; }
  const ym = q.match(/\b(20\d\d)\b/); if (ym && /ann[oi]|\b20\d\d\b/.test(q)) { const y = +ym[1]; return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) }; }
  if (/quest['o]?\s*anno|\banno\b/.test(q)) return { from: `${y0}-01-01`, to: `${y0}-12-31`, label: String(y0) };
  return null;
}
function parseDay(q: string, today: Date): { iso: string; label: string } | null {
  if (/dopodomani/.test(q)) return { iso: iso(addDays(today, 2)), label: "dopodomani" };
  if (/domani/.test(q)) return { iso: iso(addDays(today, 1)), label: "domani" };
  if (/ieri/.test(q)) return { iso: iso(addDays(today, -1)), label: "ieri" };
  if (/oggi|stasera|stamattina|stanotte/.test(q)) return { iso: iso(today), label: "oggi" };
  const md = q.match(/\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/);
  if (md) { const m = MONTHS.indexOf(md[2]); const ym = q.match(/\b(20\d\d)\b/); const y = ym ? +ym[1] : today.getFullYear(); return { iso: iso(new Date(y, m, +md[1])), label: `il ${+md[1]} ${md[2]}` }; }
  const dm = q.match(/\b(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?\b/);
  if (dm) { let y = today.getFullYear(); if (dm[3]) y = dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]; const d = new Date(y, +dm[2] - 1, +dm[1]); return { iso: iso(d), label: `il ${+dm[1]}/${+dm[2]}` }; }
  return null;
}

export function answer(raw: string, ctx: AssistantCtx): Answer {
  const q = raw.toLowerCase().trim();
  const { today } = ctx;
  const todayISO = iso(today);
  if (!q) return { kind: "help", icon: "chat", title: "Chiedimi quello che vuoi", detail: "Ti rispondo sui tuoi dati: incassi, arrivi, disponibilità, pulizie, ospiti…", suggestions: SUGGESTIONS };

  const scoped = ctx.activeStructureId === "all" ? ctx.bookings : ctx.bookings.filter((b) => b.structureId === ctx.activeStructureId);
  const active = scoped.filter((b) => b.status !== "cancelled" && b.channel !== "blocked");
  const guestName = (id: string) => ctx.guests.find((g) => g.id === id)?.fullName ?? "Ospite";
  const unitName = (id: string | null) => ctx.units.find((u) => u.id === id)?.name ?? "Da assegnare";
  const structName = (id: string) => ctx.structures.find((s) => s.id === id)?.name ?? "";
  const hasDog = (id: string) => (ctx.guests.find((g) => g.id === id)?.tags ?? []).includes("Animali");
  const bItem = (b: Booking, sub?: string): AnswerItem => ({ label: guestName(b.guestId), sub: sub ?? `${unitName(b.unitId)} · ${structName(b.structureId)}`, badge: hasDog(b.guestId) ? "🐾" : undefined, bookingId: b.id });

  // ── Incassi / ricavi ──
  if (/incass|ricav|fattur|guadagn|entrat|introit/.test(q) && !/da\s+incass|devo|ancora|resid|saldo|manca/.test(q)) {
    const p = parsePeriod(q, today) ?? { from: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`, to: iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)), label: "questo mese" };
    const inPeriod = active.filter((b) => b.checkIn >= p.from && b.checkIn <= p.to);
    const ricavi = inPeriod.reduce((a, b) => a + (b.total ?? 0), 0);
    const incassato = inPeriod.reduce((a, b) => a + (b.paid ?? 0), 0);
    const wantPaid = /incass|entrat|introit/.test(q) && !/ricav|fattur/.test(q);
    return { kind: "answer", icon: "card", title: wantPaid ? `Incassato per arrivi ${p.label}` : `Ricavi per arrivi ${p.label}`, metric: eur(wantPaid ? incassato : ricavi), detail: `${inPeriod.length} prenotazioni · ricavi ${eur(ricavi)} · già incassato ${eur(incassato)}`, href: "/statistiche", hrefLabel: "Apri statistiche" };
  }

  // ── Da incassare (saldi aperti) ──
  if (/(da\s+incass|devo\s+incass|ancora\s+incass|saldo|saldi|resid|manca.*(pagare|incass)|crediti)/.test(q)) {
    const open = active.filter((b) => b.checkOut >= todayISO).map((b) => ({ b, due: (b.total ?? 0) + (b.cleaningFee ?? 0) - (b.paid ?? 0) })).filter((x) => x.due > 0).sort((a, z) => z.due - a.due);
    const tot = open.reduce((a, x) => a + x.due, 0);
    return { kind: "answer", icon: "card", title: "Ancora da incassare", metric: eur(tot), detail: `${open.length} prenotazioni con saldo aperto`, items: open.slice(0, 8).map(({ b, due }) => bItem(b, `${fmtD(b.checkIn)} → ${fmtD(b.checkOut)}`)).map((it, i) => ({ ...it, badge: eur(open[i].due) })), href: "/pagamenti", hrefLabel: "Apri pagamenti" };
  }

  // ── Animali ──
  if (/animal|cane|cani|gatt|zamp|🐾/.test(q)) {
    const day = parseDay(q, today);
    const per = parsePeriod(q, today);
    let list = active.filter((b) => hasDog(b.guestId));
    let when = "in totale";
    if (day) { list = list.filter((b) => b.checkIn <= day.iso && day.iso < b.checkOut || b.checkIn === day.iso); when = day.label; }
    else if (per) { list = list.filter((b) => b.checkIn <= per.to && b.checkOut > per.from); when = per.label; }
    else { list = list.filter((b) => b.checkOut >= todayISO); when = "da oggi in poi"; }
    list = list.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    if (!list.length) return { kind: "empty", icon: "paw", title: `Nessun ospite con animali (${when})` };
    return { kind: "answer", icon: "paw", title: `Ospiti con animali · ${when}`, metric: String(list.length), items: list.slice(0, 10).map((b) => bItem(b, `${fmtD(b.checkIn)} → ${fmtD(b.checkOut)}`)) };
  }

  // ── Schedina Alloggiati mancante ──
  if (/schedin|alloggiat|documento|questura|dati\s+ospit/.test(q)) {
    const complete = (id: string) => { const g = ctx.guests.find((x) => x.id === id); return !!(g && (g.lastName || g.fullName) && g.sex && g.birthDate && g.birthPlace && g.citizenship && g.docType && g.docNumber); };
    const arrivals = active.filter((b) => b.checkIn >= todayISO).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    const missing = arrivals.filter((b) => !complete(b.guestId));
    if (!missing.length) return { kind: "empty", icon: "id", title: "Tutte le schedine dei prossimi arrivi sono complete ✓" };
    return { kind: "answer", icon: "id", title: "Schedina alloggiati da completare", metric: String(missing.length), detail: "Prossimi arrivi senza dati documento", items: missing.slice(0, 10).map((b) => bItem(b, `arrivo ${fmtD(b.checkIn)}`)), href: "/alloggiati", hrefLabel: "Apri Alloggiati" };
  }

  // ── Pulizie / turnover ──
  if (/puli|turnover|riassett|camere\s+da\s+fare|signora|sanific/.test(q)) {
    const day = parseDay(q, today) ?? { iso: todayISO, label: "oggi" };
    const dep = active.filter((b) => b.checkOut === day.iso);
    const arr = active.filter((b) => b.checkIn === day.iso);
    const stay = active.filter((b) => b.checkIn < day.iso && day.iso < b.checkOut);
    const toDo = dep.length + arr.length + stay.length;
    if (!toDo) return { kind: "empty", icon: "sparkles", title: `Nessuna pulizia in programma ${day.label}` };
    const items: AnswerItem[] = [
      ...dep.filter((d) => arr.some((a) => a.unitId === d.unitId)).map((d) => ({ label: unitName(d.unitId), sub: "Partenza + Arrivo", badge: "turnover", href: "/pulizie" })),
      ...dep.filter((d) => !arr.some((a) => a.unitId === d.unitId)).map((d) => ({ label: unitName(d.unitId), sub: `Partenza · ${guestName(d.guestId)}`, href: "/pulizie" })),
      ...arr.filter((a) => !dep.some((d) => d.unitId === a.unitId)).map((a) => ({ label: unitName(a.unitId), sub: `Arrivo · ${guestName(a.guestId)}`, href: "/pulizie" })),
      ...stay.filter((s) => !dep.some((d) => d.unitId === s.unitId) && !arr.some((a) => a.unitId === s.unitId)).map((s) => ({ label: unitName(s.unitId), sub: "Riassetto", href: "/pulizie" })),
    ];
    return { kind: "answer", icon: "sparkles", title: `Pulizie ${day.label}`, metric: String(toDo), detail: `${dep.length} partenze · ${arr.length} arrivi · ${stay.length} riassetti`, items: items.slice(0, 12), href: "/pulizie", hrefLabel: "Apri planning pulizie" };
  }

  // ── Disponibilità / camere libere ──
  if (/disponibil|liber|posto|posti|camere\s+libere|c['è]?\s*posto/.test(q)) {
    const p = parsePeriod(q, today);
    const day = parseDay(q, today);
    const from = p ? p.from : day ? day.iso : todayISO;
    const to = p ? p.to : day ? day.iso : todayISO;
    const label = p ? p.label : day ? day.label : "oggi";
    const unitsScoped = ctx.units.filter((u) => !u.outOfService && (ctx.activeStructureId === "all" || u.structureId === ctx.activeStructureId));
    const free = unitsScoped.filter((u) => !active.some((b) => b.unitId === u.id && b.checkIn <= to && from < b.checkOut));
    if (!free.length) return { kind: "empty", icon: "bed", title: `Nessuna camera libera (${label})`, detail: "Tutto occupato nel periodo scelto." };
    return { kind: "answer", icon: "bed", title: `Camere libere · ${label}`, metric: `${free.length}/${unitsScoped.length}`, items: free.slice(0, 12).map((u) => ({ label: u.name, sub: structName(u.structureId), href: "/calendario" })), href: "/calendario", hrefLabel: "Apri calendario" };
  }

  // ── Occupazione ──
  if (/occupaz|tasso|quanto\s+pien|riempit/.test(q)) {
    const day = parseDay(q, today) ?? { iso: todayISO, label: "oggi" };
    const unitsScoped = ctx.units.filter((u) => !u.outOfService && (ctx.activeStructureId === "all" || u.structureId === ctx.activeStructureId));
    const occ = active.filter((b) => b.unitId && unitsScoped.some((u) => u.id === b.unitId) && b.checkIn <= day.iso && day.iso < b.checkOut).length;
    const pct = unitsScoped.length ? Math.round((occ / unitsScoped.length) * 100) : 0;
    return { kind: "answer", icon: "chart", title: `Occupazione ${day.label}`, metric: `${pct}%`, detail: `${occ} camere occupate su ${unitsScoped.length}`, href: "/statistiche", hrefLabel: "Apri statistiche" };
  }

  // ── Preventivi ──
  if (/preventiv|offert/.test(q)) {
    const open = ctx.quotes.filter((qt) => qt.status !== "confermato");
    const val = open.reduce((a, qt) => a + (qt.total ?? 0), 0);
    if (!ctx.quotes.length) return { kind: "empty", icon: "fileText", title: "Nessun preventivo salvato", href: "/preventivi", hrefLabel: "Crea preventivo" };
    return { kind: "answer", icon: "fileText", title: "Preventivi aperti (non confermati)", metric: String(open.length), detail: `Valore potenziale ${eur(val)} · ${ctx.quotes.length} totali`, items: open.slice(0, 8).map((qt) => ({ label: qt.name, sub: `n. ${qt.number} · ${fmtD(qt.checkIn)} → ${fmtD(qt.checkOut)}`, badge: eur(qt.total), href: "/preventivi" })), href: "/preventivi", hrefLabel: "Apri preventivi" };
  }

  // ── Arrivi / partenze / in struttura ──
  const isArr = /arriv|check[\s-]?in|entrano|vengono/.test(q);
  const isDep = /part|check[\s-]?out|escono|vanno\s+via|lasciano/.test(q);
  const isStay = /in\s+struttura|present|chi\s+c['è]|soggiorn|ospit(i|ando)/.test(q);
  if (isArr || isDep || isStay) {
    const day = parseDay(q, today);
    const per = parsePeriod(q, today);
    const from = per ? per.from : day ? day.iso : todayISO;
    const to = per ? per.to : day ? day.iso : todayISO;
    const label = per ? per.label : day ? day.label : "oggi";
    if (isDep && !isArr) { const list = active.filter((b) => b.checkOut >= from && b.checkOut <= to).sort((a, b) => a.checkOut.localeCompare(b.checkOut)); return list.length ? { kind: "answer", icon: "logout", title: `Partenze · ${label}`, metric: String(list.length), items: list.slice(0, 12).map((b) => bItem(b, `parte ${fmtD(b.checkOut)}`)) } : { kind: "empty", icon: "logout", title: `Nessuna partenza ${label}` }; }
    if (isStay && !isArr && !isDep) { const list = active.filter((b) => b.checkIn <= from && from < b.checkOut).sort((a, b) => a.checkOut.localeCompare(b.checkOut)); return list.length ? { kind: "answer", icon: "bed", title: `In struttura · ${label}`, metric: String(list.length), items: list.slice(0, 12).map((b) => bItem(b, `fino al ${fmtD(b.checkOut)}`)) } : { kind: "empty", icon: "bed", title: `Nessun ospite presente ${label}` }; }
    const list = active.filter((b) => b.checkIn >= from && b.checkIn <= to).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    return list.length ? { kind: "answer", icon: "login", title: `Arrivi · ${label}`, metric: String(list.length), items: list.slice(0, 12).map((b) => bItem(b, `${fmtD(b.checkIn)} · ${b.adults + b.children} osp · ${nights(b.checkIn, b.checkOut)} ntt`)) } : { kind: "empty", icon: "login", title: `Nessun arrivo ${label}` };
  }

  // ── Conteggio prenotazioni ──
  if (/quant[ei]\s+prenotaz|numero\s+prenotaz|prenotazioni\b/.test(q)) {
    const p = parsePeriod(q, today);
    const list = p ? active.filter((b) => b.checkIn >= p.from && b.checkIn <= p.to) : active.filter((b) => b.checkIn >= todayISO);
    return { kind: "answer", icon: "clipboard", title: p ? `Prenotazioni (arrivi ${p.label})` : "Prossime prenotazioni", metric: String(list.length), href: "/prenotazioni", hrefLabel: "Apri prenotazioni" };
  }

  // ── Ricerca ospite per nome ──
  const nameQ = raw.replace(/\b(trova|cerca|prenotazione\s+di|ospite|dov['eè]|dettagli)\b/gi, "").trim();
  if (nameQ.length >= 3) {
    const matches = ctx.guests.filter((g) => g.fullName.toLowerCase().includes(nameQ.toLowerCase()));
    if (matches.length) {
      const ids = new Set(matches.map((g) => g.id));
      const bks = scoped.filter((b) => ids.has(b.guestId)).sort((a, b) => b.checkIn.localeCompare(a.checkIn));
      const g0 = matches[0];
      return { kind: "answer", icon: "users", title: matches.length === 1 ? g0.fullName : `${matches.length} ospiti trovati`, detail: g0.phone || g0.email || undefined, items: bks.slice(0, 8).map((b) => bItem(b, `${fmtD(b.checkIn)} → ${fmtD(b.checkOut)} · ${eur(b.total ?? 0)}`)), href: `/ospiti`, hrefLabel: "Apri anagrafica" };
    }
  }

  return { kind: "empty", icon: "search", title: "Non ho capito la domanda", detail: "Prova con una di queste:", suggestions: SUGGESTIONS.slice(0, 5) };
}
