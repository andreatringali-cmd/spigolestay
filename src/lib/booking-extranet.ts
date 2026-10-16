// Riconciliazione con l'extranet di Booking.com: l'utente incolla l'elenco copiato dalla pagina «Prenotazioni»
// («Nome dell'ospite · Arrivo · Partenza · Alloggi · Data di prenotazione · Stato · Prezzo · Commissione e costi · Numero prenotazione»)
// e Xenora confronta ogni riga con le proprie prenotazioni, mostra le differenze e propone di allineare gli importi.
//
// Modulo PURO (nessun accesso a browser/rete): tutto parte dal testo incollato e dalle prenotazioni passate dal chiamante, così è collaudabile.
// Nessun dato esce dal browser.

import type { Booking, Guest } from "./types";
import { commissionOf, lordoOf, paymentFeeOf, isNetPayout } from "./booking";
import { parseDecimalIT } from "./num-it";

/** Tolleranza sui confronti in euro. */
export const TOL = 0.02;
/** Soglia entro cui un importo Xenora si considera «lo stesso» dell'extranet per poterlo correggere da soli (l'importo è solo un po' vecchio/diverso). */
export const NEAR = 1;

// ---------------------------------------------------------------------------------------------------------------------------------------
// 1. Lettura del testo incollato
// ---------------------------------------------------------------------------------------------------------------------------------------

export type ExtranetStatus = "ok" | "cancelled" | "other";

export interface ExtranetRow {
  code: string;            // numero prenotazione (10 cifre)
  guest: string;           // nome dell'ospite, ripulito da «Genius», «2 adulti», avvisi di messaggi
  checkIn: string;         // ISO yyyy-mm-dd
  checkOut: string;        // ISO
  bookedOn: string;        // ISO, vuoto se non letta
  status: ExtranetStatus;
  statusText: string;      // testo originale dello stato («OK», «Cancellata», «No show»…)
  accommodation: string;   // «1 x Camera Matrimoniale…, 1 x Camera Tripla…»
  price: number;           // € (colonna Prezzo)
  commission: number;      // € (colonna Commissione e costi)
}

export interface ExtranetParse {
  rows: ExtranetRow[];
  totals?: { commission: number; price: number; pages: number }; // somma dei totali «in fondo» (uno per pagina incollata)
  warnings: string[];
}

const MONTHS: Record<string, number> = { gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12 };
const pad2 = (n: number) => String(n).padStart(2, "0");
const cents = (n: number) => Math.round(n * 100 + (n < 0 ? -1e-7 : 1e-7));
const r2 = (n: number) => cents(n) / 100;

interface FoundDate { iso: string; index: number; end: number }

/** Tutte le date scritte come «14 ott 2026» (mesi italiani abbreviati o per esteso) o come 14/10/2026, in ordine di posizione. */
function findDates(s: string): FoundDate[] {
  const out: FoundDate[] = [];
  const re1 = /(?<![0-9])([0-9]{1,2})\s+([A-Za-zÀ-ÿ]{3,9})[.]?\s+([0-9]{4})(?![0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(s))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const d = Number(m[1]);
    if (!mo || d < 1 || d > 31) continue;
    out.push({ iso: `${m[3]}-${pad2(mo)}-${pad2(d)}`, index: m.index, end: m.index + m[0].length });
  }
  const re2 = /(?<![0-9])([0-9]{1,2})[/.]([0-9]{1,2})[/.]([0-9]{4})(?![0-9])/g;
  while ((m = re2.exec(s))) {
    const d = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    out.push({ iso: `${m[3]}-${pad2(mo)}-${pad2(d)}`, index: m.index, end: m.index + m[0].length });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Importi nel testo: «€ 1.234,56», «EUR 12», «12,50 €». Restituisce i valori in ordine di comparsa. */
function findAmounts(s: string): number[] {
  const out: number[] = [];
  const re = /(?:€|EUR)\s*(-?[0-9][0-9.,]*)|(-?[0-9][0-9.,]*)\s*(?:€|EUR)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const v = parseDecimalIT((m[1] ?? m[2]).replace(/[.,]+$/, ""));
    if (v != null) out.push(v);
  }
  return out;
}

function classifyStatus(text: string): ExtranetStatus {
  const t = text.trim().toLowerCase();
  if (t === "ok" || t.startsWith("confermat")) return "ok";
  if (t.startsWith("cancell") || t.startsWith("annull")) return "cancelled";
  return "other";
}

/** Toglie dal nome tutto ciò che Booking mette accanto: «Genius», «2 adulti», «Hai 1 messaggio di un ospite a cui rispondere»… */
function cleanGuest(pre: string): string {
  const cut = pre.search(/(?<![A-Za-zÀ-ÿ])(?:Genius|[0-9]+\s+(?:adult|ospit|person|bambin)|Hai\s+[0-9]+\s+messagg|Hai\s+un\s+messagg|Nuov[oa]\s+messagg)/i);
  const name = cut >= 0 ? pre.slice(0, cut) : pre;
  return name.replace(/\s+/g, " ").replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "");
}

/**
 * Legge il testo copiato dall'extranet. Tollerante: tab, spazi multipli, righe spezzate in punti qualsiasi, intestazione ripetuta, «Genius», «N adulti»,
 * avvisi di messaggi, «Bonifico», importi con migliaia. Il separatore dei record è il NUMERO PRENOTAZIONE (10 cifre) che chiude ogni riga.
 * Non riconosce: righe senza numero di 10 cifre, date scritte in altre lingue, importi senza € (o EUR), stati con cifre.
 */
export function parseExtranetText(input: string): ExtranetParse {
  const warnings: string[] = [];
  let text = String(input ?? "").replace(/[\s ​ ]+/g, " ").trim();
  if (!text) return { rows: [], warnings };

  // Totali in fondo («Commissione e costi: € 234,66  Prezzo totale: € 957,78»): se incolli più pagine sono più, si sommano.
  let totComm = 0, totPrice = 0, pages = 0;
  text = text.replace(/Commissione e costi\s*:?\s*(?:€|EUR)\s*(-?[0-9][0-9.,]*)/gi, (_m, a: string) => { const v = parseDecimalIT(a.replace(/[.,]+$/, "")); if (v != null) { totComm += v; } return " "; });
  text = text.replace(/Prezzo totale\s*:?\s*(?:€|EUR)\s*(-?[0-9][0-9.,]*)/gi, (_m, a: string) => { const v = parseDecimalIT(a.replace(/[.,]+$/, "")); if (v != null) { totPrice += v; pages++; } return " "; });
  // Intestazione della tabella (anche ripetuta o a pezzi).
  text = text.replace(/Nome dell.{0,2}ospite(?:\s+Arrivo)?(?:\s+Partenza)?(?:\s+Alloggi)?(?:\s+Data di prenotazione)?(?:\s+Stato)?(?:\s+Prezzo)?(?:\s+Commissione e costi)?(?:\s+Numero prenotazione)?/gi, " ");
  text = text.replace(/\s+/g, " ").trim();

  // Record: ognuno finisce con il suo numero prenotazione.
  const codeRe = /(?<![0-9.,])[0-9]{10}(?![0-9])/g;
  const rows: ExtranetRow[] = [];
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(text))) {
    const seg = text.slice(start, m.index).trim();
    start = m.index + m[0].length;
    const code = m[0];
    const dates = findDates(seg);
    if (dates.length < 2) { warnings.push(`Riga con numero ${code} non letta: servono almeno le date di arrivo e partenza (trovate ${dates.length}).`); continue; }
    const [d1, d2, d3] = dates;
    const guest = cleanGuest(seg.slice(0, d1.index));
    const accommodation = (d3 ? seg.slice(d2.end, d3.index) : seg.slice(d2.end)).replace(/\s+/g, " ").trim().replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "");
    let status: ExtranetStatus = "other", statusText = "";
    let amountsFrom = d3 ? d3.end : d2.end;
    if (d3) {
      const after = seg.slice(d3.end);
      const sm = /^\s*([A-Za-zÀ-ÿ' -]+?)\s*(?=Pagamento|Bonifico|€|EUR|[0-9]|$)/i.exec(after);
      if (sm) { statusText = sm[1].trim(); status = classifyStatus(statusText); amountsFrom = d3.end + sm[0].length; }
    } else warnings.push(`Riga ${code}: data di prenotazione non letta.`);
    if (!statusText) warnings.push(`Riga ${code}: stato non riconosciuto.`);
    const amounts = findAmounts(seg.slice(amountsFrom));
    let price = 0, commission = 0;
    if (amounts.length >= 2) { price = amounts[0]; commission = amounts[1]; if (amounts.length > 2) warnings.push(`Riga ${code}: trovati ${amounts.length} importi, uso i primi due (prezzo e commissione).`); }
    else if (amounts.length === 1) { price = amounts[0]; warnings.push(`Riga ${code}: trovato un solo importo, la commissione è considerata 0.`); }
    else warnings.push(`Riga ${code}: importi non trovati (servono prezzo e commissione con il simbolo €).`);
    rows.push({ code, guest, checkIn: d1.iso, checkOut: d2.iso, bookedOn: d3?.iso ?? "", status, statusText, accommodation, price: r2(price), commission: r2(commission) });
  }
  const tail = text.slice(start).trim();
  if (tail && (findDates(tail).length > 0 || findAmounts(tail).length > 0)) warnings.push("In fondo al testo c'è una riga senza numero prenotazione di 10 cifre: ignorata.");
  if (!rows.length && !warnings.length) warnings.push("Non ho trovato nessuna prenotazione: copia l'elenco dalla pagina Prenotazioni dell'extranet, comprese le righe con il numero prenotazione.");

  // Righe ripetute (stesso numero incollato due volte, per esempio due pagine che si sovrappongono).
  const seen = new Map<string, ExtranetRow>();
  const uniq: ExtranetRow[] = [];
  let dup = 0;
  for (const r of rows) {
    const prev = seen.get(r.code);
    if (!prev) { seen.set(r.code, r); uniq.push(r); continue; }
    dup++;
    if (Math.abs(prev.price - r.price) > TOL || Math.abs(prev.commission - r.commission) > TOL || prev.status !== r.status) warnings.push(`Numero ${r.code} incollato due volte con valori diversi: tengo la prima riga.`);
  }
  if (dup) warnings.push(`${dup} ${dup === 1 ? "riga ripetuta (stesso numero) ignorata" : "righe ripetute (stesso numero) ignorate"}.`);

  const out: ExtranetParse = { rows: uniq, warnings };
  if (pages > 0) {
    out.totals = { commission: r2(totComm), price: r2(totPrice), pages };
    // Il totale in fondo è della pagina visibile: se la somma delle righe non torna, manca qualcosa (o è stata copiata solo in parte).
    const sumP = r2(rows.reduce((a, r) => a + r.price, 0)), sumC = r2(rows.reduce((a, r) => a + r.commission, 0));
    if (dup === 0) {
      if (Math.abs(sumP - out.totals.price) > TOL) warnings.push(`La somma dei prezzi delle righe (${money(sumP)}) non coincide con «Prezzo totale» in fondo (${money(out.totals.price)}): forse manca qualche riga.`);
      if (Math.abs(sumC - out.totals.commission) > TOL) warnings.push(`La somma delle commissioni delle righe (${money(sumC)}) non coincide con «Commissione e costi» in fondo (${money(out.totals.commission)}): forse manca qualche riga.`);
    }
  }
  return out;
}

function money(n: number): string {
  const [i, d] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}€ ${i.replace(/\B(?=([0-9]{3})+(?![0-9]))/g, ".")},${d}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// 2. Confronto con le prenotazioni di Xenora
// ---------------------------------------------------------------------------------------------------------------------------------------

export type MatchOutcome = "ok" | "differenze" | "mancante_in_xenora" | "doppione" | "altra_struttura";
export type DiffField = "totale" | "incassato" | "commissione" | "checkIn" | "checkOut" | "stato" | "ospite" | "canale";

export interface Diff {
  field: DiffField;
  xenora: string;
  booking: string;
  fixable: boolean;   // l'allineamento automatico lo corregge
  note?: string;
}

export interface RowMatch {
  row: ExtranetRow;
  bookings: Booking[];      // tutte le prenotazioni Xenora con quel numero
  active: Booking[];        // quelle non annullate (su cui si calcolano gli importi)
  outcome: MatchOutcome;
  diffs: Diff[];
  structureIds: string[];
  xenora: { total: number; paid: number; commission: number }; // somme delle righe attive (lordo, incassato, commissioni come mostrate in Xenora)
  note?: string;            // cosa fare, per le segnalazioni
  needsReview?: boolean;    // importo troppo diverso: non si allinea da solo
}

export interface OnlyInXenora { code: string; bookings: Booking[]; guest: string; checkIn: string; checkOut: string }

export interface Comparison {
  matches: RowMatch[];
  onlyInXenora: OnlyInXenora[];
  structureIds: string[];           // strutture in cui stanno le prenotazioni trovate (la prima = quella prevalente)
  dominantStructureId: string | null;
}

const norm = (s?: string) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s?: string) => norm(s).split(" ").filter((t) => t.length >= 2);
/** Nomi «compatibili»: almeno min(2, parole del più corto) parole in comune (ordine e accenti ininfluenti). Se uno dei due manca, non è una differenza. */
export function sameGuestName(a?: string, b?: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return true;
  if (/^ospite$/.test(norm(a)) || /^ospite$/.test(norm(b))) return true;
  const sb = new Set(tb);
  const common = ta.filter((t) => sb.has(t)).length;
  return common >= Math.min(2, ta.length, tb.length);
}

const sumC = (xs: number[]) => xs.reduce((a, x) => a + cents(x), 0) / 100;
const extId = (b: Booking) => String(b.extId ?? "");
const sourceOf = (b: Booking) => { const m = /^([a-z_]+):/.exec(extId(b)); return m ? m[1] : ""; };
const codeOf = (b: Booking) => String(b.code ?? "").trim();
const isActive = (b: Booking) => b.status !== "cancelled";
const extrasOf = (b: Booking) => (b.cleaningFee ?? 0) + (Array.isArray(b.extras) ? b.extras.reduce((a, e) => a + (e?.price || 0), 0) : 0);

/** Divide un importo (in centesimi) in parti proporzionali ai pesi: somma ESATTA, l'ultimo arrotondamento va sulla riga con il peso maggiore. */
export function splitCents(totalCents: number, weights: number[]): number[] {
  if (!weights.length) return [];
  if (weights.length === 1) return [totalCents];
  let w = weights.map((x) => (x > 0 ? x : 0));
  let sum = w.reduce((a, x) => a + x, 0);
  if (sum <= 0) { w = weights.map(() => 1); sum = w.length; }
  const shares = w.map((x) => Math.round((totalCents * x) / sum));
  const diff = totalCents - shares.reduce((a, x) => a + x, 0);
  let big = 0;
  w.forEach((x, i) => { if (x > w[big]) big = i; });
  shares[big] += diff;
  return shares;
}

/** Rinomina i pesi con cui si ripartisce un importo tra le camere di una stessa prenotazione: i totali attuali, altrimenti gli incassati, altrimenti parti uguali. */
function weightsOf(active: Booking[]): number[] {
  const byTotal = active.map((b) => cents(lordoOf(b)));
  if (byTotal.some((x) => x > 0)) return byTotal;
  const byPaid = active.map((b) => cents(b.paid ?? 0));
  if (byPaid.some((x) => x > 0)) return byPaid;
  return active.map(() => 1);
}

/**
 * Confronta le righe dell'extranet con le prenotazioni di Xenora (canale Booking.com, stesso numero in `code`).
 * Esiti: ok · differenze · mancante_in_xenora · doppione (stesso numero con origini diverse, es. octorate: e channex:) · altra_struttura.
 * In più `onlyInXenora`: prenotazioni Booking di Xenora con check-out nell'intervallo incollato e numero assente dall'elenco.
 */
export function compareWithBookings(rows: ExtranetRow[], bookings: Booking[], guests: Guest[]): Comparison {
  const guestName = new Map<string, string>();
  for (const g of guests) guestName.set(g.id, g.fullName || [g.firstName, g.lastName].filter(Boolean).join(" "));
  const byCode = new Map<string, Booking[]>();
  for (const b of bookings) {
    const c = codeOf(b);
    if (!c) continue;
    const arr = byCode.get(c); if (arr) arr.push(b); else byCode.set(c, [b]);
  }

  const matches: RowMatch[] = rows.map((row) => {
    const all = byCode.get(row.code) ?? [];
    const active = all.filter(isActive);
    const structureIds = Array.from(new Set(all.map((b) => b.structureId)));
    const xenora = {
      total: r2(sumC(active.map((b) => lordoOf(b)))),
      paid: r2(sumC(active.map((b) => b.paid ?? 0))),
      commission: r2(sumC(active.map((b) => commissionOf(b)))),
    };
    const m: RowMatch = { row, bookings: all, active, outcome: "ok", diffs: [], structureIds, xenora };
    if (!all.length) {
      m.outcome = "mancante_in_xenora";
      m.note = row.status === "cancelled"
        ? "Cancellata su Booking e assente in Xenora: non serve fare nulla."
        : "Presente su Booking ma non in Xenora con questo numero. Controlla il Calendario (magari è registrata con un altro numero o come altro canale) oppure aspetta la sincronizzazione.";
      if (row.status === "cancelled") m.outcome = "ok";
      return m;
    }
    // Doppione: stesso numero registrato da origini diverse (importata da Octorate E arrivata da Channex).
    const srcs = new Set(active.map(sourceOf).filter(Boolean));
    if (srcs.size >= 2) m.note = `Il numero ${row.code} è registrato due volte (${Array.from(srcs).join(" e ")}). Tieni una sola prenotazione e annulla l'altra dal Calendario: qui non tocco nulla.`;

    const D = m.diffs;
    const xb = active.length ? active : all;
    const isBookingChannel = all.some((b) => b.channel === "booking");
    if (!isBookingChannel) D.push({ field: "canale", xenora: all[0].channel, booking: "Booking.com", fixable: false });

    // Stato.
    if (row.status === "cancelled") {
      if (active.length) D.push({ field: "stato", xenora: "Attiva", booking: "Cancellata", fixable: false, note: "Annullala tu dal Calendario se è davvero cancellata." });
    } else if (!active.length) {
      D.push({ field: "stato", xenora: "Annullata", booking: row.statusText || "OK", fixable: false, note: "Su Booking è attiva ma in Xenora è annullata: ripristinala dal Calendario se serve." });
    }

    if (row.status !== "cancelled" && active.length) {
      // Importi.
      const L = xenora.total, P = xenora.paid, C = xenora.commission;
      const totalDiff = Math.abs(L - row.price) > TOL;
      const nearTotal = Math.abs(row.price - L) <= NEAR || (P > 0 && Math.abs(row.price - P) <= NEAR) || L === 0;
      m.needsReview = totalDiff && !nearTotal;
      if (totalDiff) D.push({ field: "totale", xenora: money(L), booking: money(row.price), fixable: nearTotal, note: nearTotal ? undefined : "Troppo diverso: controllalo a mano (date o camere cambiate?)." });
      if (Math.abs(C - row.commission) > TOL) D.push({ field: "commissione", xenora: money(C), booking: money(row.commission), fixable: !m.needsReview });
      if (P > 0 && Math.abs(P - row.price) > TOL && Math.abs(P - row.price) < NEAR) D.push({ field: "incassato", xenora: money(P), booking: money(row.price), fixable: !m.needsReview });
    }
    if (active.length || row.status !== "cancelled") {
      // Date.
      const cis = xb.map((b) => b.checkIn).sort(), cos = xb.map((b) => b.checkOut).sort();
      const ci = cis[0], co = cos[cos.length - 1];
      if (ci !== row.checkIn) D.push({ field: "checkIn", xenora: ci, booking: row.checkIn, fixable: false });
      if (co !== row.checkOut) D.push({ field: "checkOut", xenora: co, booking: row.checkOut, fixable: false });
      // Ospite.
      const names = xb.map((b) => guestName.get(b.guestId) ?? "");
      if (!names.some((n) => sameGuestName(n, row.guest))) D.push({ field: "ospite", xenora: names.find(Boolean) || "—", booking: row.guest, fixable: false });
    }
    m.outcome = srcs.size >= 2 ? "doppione" : D.length ? "differenze" : "ok";
    return m;
  });

  // Struttura prevalente: se nell'elenco ce n'è più di una, le righe delle altre sono segnalate.
  const count = new Map<string, number>();
  for (const m of matches) for (const id of m.structureIds) count.set(id, (count.get(id) ?? 0) + 1);
  const ranked = Array.from(count.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const dominant = ranked[0] ?? null;
  if (ranked.length > 1) {
    for (const m of matches) {
      if (!m.structureIds.length || m.structureIds.includes(dominant!)) continue;
      m.outcome = "altra_struttura";
      m.note = "Questa prenotazione è in un'altra struttura rispetto alle altre righe dell'elenco: o hai incollato righe di due strutture, o è stata spostata nel Calendario. Non la tocco.";
    }
  }

  // Solo in Xenora: Booking di Xenora con check-out nell'intervallo dell'elenco ma assenti dall'elenco.
  const onlyInXenora: OnlyInXenora[] = [];
  if (rows.length && dominant) {
    const outs = rows.map((r) => r.checkOut).sort();
    const lo = outs[0], hi = outs[outs.length - 1];
    const listed = new Set(rows.map((r) => r.code));
    const groups = new Map<string, Booking[]>();
    for (const b of bookings) {
      if (b.channel !== "booking" || !isActive(b) || b.structureId !== dominant) continue;
      if (b.checkOut < lo || b.checkOut > hi) continue;
      const c = codeOf(b);
      if (c && listed.has(c)) continue;
      const k = c || `id:${b.id}`;
      const arr = groups.get(k); if (arr) arr.push(b); else groups.set(k, [b]);
    }
    for (const [k, bs] of groups) onlyInXenora.push({ code: k.startsWith("id:") ? "" : k, bookings: bs, guest: guestName.get(bs[0].guestId) || "—", checkIn: bs.map((b) => b.checkIn).sort()[0], checkOut: bs.map((b) => b.checkOut).sort().slice(-1)[0] });
    onlyInXenora.sort((a, b) => a.checkOut.localeCompare(b.checkOut));
  }

  return { matches, onlyInXenora, structureIds: ranked, dominantStructureId: dominant };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// 3. Proposta di allineamento
// ---------------------------------------------------------------------------------------------------------------------------------------

export interface AlignPatch { id: string; patch: Partial<Booking> }

/**
 * Cosa scrivere nelle prenotazioni di Xenora perché coincidano con l'extranet.
 *  - `total`: il prezzo esatto (al netto di pulizia/extra, che nel «lordo» si sommano), se il totale attuale o l'incassato distano al massimo 1 €.
 *  - `commissionAmount`: la commissione esatta (se Xenora ha già un costo d'incasso `paymentFee` lo si lascia e si scrive la differenza, così la somma torna).
 *  - `paid`: il prezzo esatto SOLO se l'incassato attuale è > 0 e dista meno di 1 € dal prezzo (un incassato a zero o molto diverso non si tocca).
 *  - lo `status` non si tocca mai: una «Cancellata» su Booking con prenotazione ancora attiva in Xenora resta una segnalazione.
 * Con più camere (stesso numero, più righe) i valori dell'extranet sono la SOMMA delle righe: la ripartizione è proporzionale ai totali attuali.
 * Per esiti diversi da «differenze» (mancante, doppione, altra struttura) non propone nulla.
 */
export function proposeAlign(match: RowMatch): AlignPatch[] {
  if (match.outcome !== "differenze" || match.needsReview) return [];
  const { row, active } = match;
  if (row.status === "cancelled" || !active.length) return [];
  const fixes = new Set(match.diffs.filter((d) => d.fixable).map((d) => d.field));
  if (!fixes.size) return [];

  const w = weightsOf(active);
  const priceC = cents(row.price);
  const lordoShares = fixes.has("totale") ? splitCents(priceC, w) : active.map((b) => cents(lordoOf(b)));
  // L'incassato si allinea solo con la regola sul prezzo; per più camere o tutte hanno incassato > 0 e la somma torna entro 1 €, o si guarda riga per riga.
  const paidSum = sumC(active.map((b) => b.paid ?? 0));
  const allPaid = active.every((b) => (b.paid ?? 0) > 0);
  const priceShares = splitCents(priceC, fixes.has("totale") ? lordoShares : w);
  const commShares = fixes.has("commissione") ? splitCents(cents(row.commission), lordoShares.some((x) => x > 0) ? lordoShares : w) : [];

  const out: AlignPatch[] = [];
  active.forEach((b, i) => {
    const patch: Partial<Booking> = {};
    const newLordo = lordoShares[i] / 100;
    if (fixes.has("totale")) {
      const t = Math.max(0, r2(newLordo - extrasOf(b)));
      if (Math.abs(t - (b.total ?? 0)) >= 0.005) patch.total = t;
    }
    if (fixes.has("commissione")) {
      const share = commShares[i] / 100;
      const next: Booking = { ...b, ...patch };
      const fee = paymentFeeOf(b);
      let amount = share - fee;
      if (amount < 0) { amount = share; patch.paymentFee = 0; next.paymentFee = 0; }
      amount = r2(amount);
      next.commissionAmount = amount;
      if (isNetPayout(next)) { patch.netTotal = false; next.netTotal = false; }
      // Eventuale sconto aggiuntivo dell'OTA derivato dalla carta virtuale: si compensa una volta.
      const got = commissionOf(next);
      if (Math.abs(got - share) > 0.005) amount = r2(Math.max(0, amount + (share - got)));
      if (Math.abs(amount - (b.commissionAmount ?? NaN)) >= 0.005 || patch.paymentFee !== undefined || patch.netTotal !== undefined) patch.commissionAmount = amount;
    }
    // Incassato.
    const useAgg = allPaid && Math.abs(paidSum - row.price) < NEAR;
    const want = priceShares[i] / 100;
    const cur = b.paid ?? 0;
    if (cur > 0 && Math.abs(cur - want) >= 0.005 && (useAgg || Math.abs(cur - want) < NEAR) && fixes.has("incassato")) patch.paid = r2(want);
    if (Object.keys(patch).length) out.push({ id: b.id, patch });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// 4. Statistica sulla percentuale di commissione
// ---------------------------------------------------------------------------------------------------------------------------------------

export interface CommissionStats {
  items: { code: string; guest: string; price: number; commission: number; pct: number }[];
  avg: number;       // media semplice delle percentuali
  weighted: number;  // commissioni totali ÷ prezzi totali
  min: number;
  max: number;
  allEqual: boolean; // tutte uguali (scarto massimo 0,15 punti: i centesimi arrotondati spostano un po' le percentuali)
}

/** Percentuale reale (commissione ÷ prezzo) delle righe indicate, con media/min/max. Salta cancellate e righe a prezzo zero. null se non c'è nulla da misurare. */
export function commissionStats(rows: ExtranetRow[]): CommissionStats | null {
  const items = rows.filter((r) => r.status !== "cancelled" && r.price > 0).map((r) => ({ code: r.code, guest: r.guest, price: r.price, commission: r.commission, pct: (r.commission / r.price) * 100 }));
  if (!items.length) return null;
  const pcts = items.map((i) => i.pct);
  const min = Math.min(...pcts), max = Math.max(...pcts);
  const sp = items.reduce((a, i) => a + i.price, 0), sc = items.reduce((a, i) => a + i.commission, 0);
  return { items, avg: pcts.reduce((a, x) => a + x, 0) / pcts.length, weighted: (sc / sp) * 100, min, max, allEqual: max - min <= 0.15 };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// 5. Riepilogo di ciò che cambierebbe (per la conferma prima di allineare)
// ---------------------------------------------------------------------------------------------------------------------------------------

export interface AlignSummary { bookings: number; dTotal: number; dCommission: number; dPaid: number }

/** Somma delle variazioni che le patch producono: totale (lordo), commissioni (come mostrate in Xenora) e incassato. */
export function summarizeAlign(patches: AlignPatch[], bookings: Booking[]): AlignSummary {
  const byId = new Map(bookings.map((b) => [b.id, b] as const));
  let dT = 0, dC = 0, dP = 0, n = 0;
  for (const p of patches) {
    const b = byId.get(p.id);
    if (!b) continue;
    const next = { ...b, ...p.patch } as Booking;
    n++;
    dT += cents(lordoOf(next)) - cents(lordoOf(b));
    dC += cents(commissionOf(next)) - cents(commissionOf(b));
    dP += cents(next.paid ?? 0) - cents(b.paid ?? 0);
  }
  return { bookings: n, dTotal: dT / 100, dCommission: dC / 100, dPaid: dP / 100 };
}
