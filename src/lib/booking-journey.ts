// Percorso di una prenotazione: tutti i passaggi da fare/fatti (check-in, pagamento, schedina, ISTAT…)
// calcolati dai dati che Xenora ha già. Funzione pura: nessuna scrittura, nessuna chiamata di rete.

import type { Booking, Guest, Structure } from "./types";
import { bookingPaidTotal, cityTaxOf } from "./booking";
import { autoLineFor, type AutoCtx, type AutoLine, type AutoStepKey } from "./auto-schedule";

export type StepState = "done" | "todo" | "late" | "na";
export interface JourneyStep { key: string; label: string; state: StepState; detail: string; href?: string; auto?: AutoLine /* invio automatico: "Non inviato · invio previsto alle 10:00" */ }
export interface Chip { key: string; label: string; tone: "info" | "warn" | "err" }

export interface JourneyCtx {
  today: string;                                  // "YYYY-MM-DD" locale
  guest?: Guest;
  structure?: Structure;
  schedina?: "da_validare" | "pronta" | "inviata" | "none"; // stato peggiore tra le schedine della prenotazione
  istat?: "pending" | "sent" | "none";
  guideSent: boolean;                              // guida ospiti già inviata in chat
  invoiceStato?: string;                           // stato del documento fiscale collegato (se esiste)
  auto?: AutoCtx;                                  // invii automatici (modelli attivi, interruttori del server): per scrivere "invio previsto alle 10:00"
  reminderNotes?: Partial<Record<"checkin" | "pay" | "tax" | "guide" | "review", string>>; // "inviato 2 volte · ultimo oggi 10:12", dalla cronologia dei solleciti
}

const expectedPax = (b: Booking) => Math.max(1, (b.adults ?? 1) + (b.children ?? 0));
const primaryDone = (b: Booking) => b.webCheckin === true || !!(b.primaryGuest?.lastName && b.primaryGuest?.docNumber);
const declaredPax = (b: Booking) => (primaryDone(b) ? 1 : 0) + (b.extraGuests?.filter((e) => !!(e.lastName || e.firstName)).length ?? 0);
const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
const daysTo = (iso: string, today: string) => Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
const eurRound = (n: number) => `€ ${Math.round(n * 100) % 100 === 0 ? Math.round(n) : n.toFixed(2).replace(".", ",")}`;
const fmtShort = (iso: string) => { const [, m, d] = iso.split("-"); return `${+d}/${+m}`; };

/** Nota interna della prenotazione, senza la dicitura "Importato da…" messa dall'importazione. Vuota se resta solo quella. Non è una nota dell'ospite: quelle sono le richieste (guestRequests). */
export const internalNote = (note?: string) => (note ?? "").replace(/^s*Importato da (Octorate|CSV)s*·?s*/i, "").trim();

export const isLiveBooking = (b: Booking) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked";

export function journeyOf(b: Booking, c: JourneyCtx): { steps: JourneyStep[]; done: number; total: number; next?: JourneyStep; chips: Chip[] } {
  const steps: JourneyStep[] = [];
  const arrived = b.checkIn <= c.today;
  const departed = b.checkOut < c.today;
  const arrivesIn = daysTo(b.checkIn, c.today);
  const g = c.guest;
  const note = (k: "checkin" | "pay" | "tax" | "guide" | "review") => (c.reminderNotes?.[k] ? ` · ${c.reminderNotes[k]}` : "");

  // 1 · Check-in online (dati di tutti gli ospiti)
  const exp = expectedPax(b), dec = declaredPax(b);
  const complete = dec > 0 && dec >= exp;
  steps.push({
    key: "checkin", label: "Check-in", href: "/adempimenti",
    state: complete ? "done" : arrived ? "late" : "todo",
    detail: complete ? `Dati completi (${dec}/${exp})` : `${dec > 0 ? `Compilati ${dec} su ${exp}: mancano i dati di ${exp - dec} ${exp - dec === 1 ? "ospite" : "ospiti"}` : "L'ospite non ha ancora compilato"}${note("checkin")}`,
  });

  // 2 · Pagamento
  const due = bookingPaidTotal(b);
  const paid = b.paid ?? 0;
  const resid = Math.max(0, due - paid);
  if (due <= 0) steps.push({ key: "pay", label: "Pagamento", state: "na", detail: "Nessun importo", href: "/pagamenti" });
  else steps.push({
    key: "pay", label: "Pagamento", href: "/pagamenti",
    state: resid <= 0.005 ? "done" : b.checkIn < c.today ? "late" : "todo",
    detail: resid <= 0.005 ? `Saldato ${eurRound(due)}` : `${paid > 0 ? `Incassati ${eurRound(paid)} · mancano ${eurRound(resid)}` : `Da incassare ${eurRound(resid)}`}${note("pay")}`,
  });

  // 3 · Tassa di soggiorno (solo se la struttura la applica)
  const tax = cityTaxOf(c.structure, b.adults, nightsBetween(b.checkIn, b.checkOut), b.total ?? 0, b.cityTaxExempt);
  if (tax > 0) steps.push({
    key: "tax", label: "Tassa soggiorno", href: "/tassa-soggiorno",
    state: b.cityTaxPaid ? "done" : departed ? "late" : "todo",
    detail: b.cityTaxPaid ? `Incassata ${eurRound(tax)}` : `Da incassare ${eurRound(tax)}${note("tax")}`,
  });

  // 4 · Schedina Alloggiati Web (Questura): entro 24 ore dall'arrivo
  const sc = c.schedina ?? "none";
  steps.push({
    key: "alloggiati", label: "Schedina Questura", href: "/alloggiati-web",
    state: sc === "inviata" ? "done" : sc === "da_validare" ? "late" : arrived ? "late" : "todo",
    detail: sc === "inviata" ? "Inviata alla Questura" : sc === "da_validare" ? "Dati da correggere" : sc === "pronta" ? "Pronta da inviare" : complete ? "Da preparare" : "Attende il check-in",
  });

  // 5 · Osservatorio turistico (ISTAT)
  const is = c.istat ?? "none";
  steps.push({
    key: "istat", label: "Osservatorio (ISTAT)", href: "/istat",
    state: is === "sent" ? "done" : departed ? "late" : "todo",
    detail: is === "sent" ? "Inviato" : is === "pending" ? "Pronto da inviare" : complete ? "Da preparare" : "Attende il check-in",
  });

  // 6 · Guida ospiti (utile prima dell'arrivo)
  if (c.guideSent) steps.push({ key: "guide", label: "Guida ospiti", state: "done", detail: "Inviata in chat", href: "/messaggi" });
  else if (!departed) steps.push({ key: "guide", label: "Guida ospiti", href: "/messaggi", state: arrivesIn <= 0 ? "late" : "todo", detail: `${arrivesIn <= 1 ? "Non ancora inviata" : "Da inviare il giorno del check-in"}${note("guide")}` });

  // 7 · Fattura / ricevuta (se richiesta dall'ospite, in bozza o già emessa)
  const issued = !!b.invoiceNo || (!!c.invoiceStato && c.invoiceStato !== "bozza");
  const ir = b.invoiceRequest;
  const irAsked = !!(ir && (ir.wants || ir.name || ir.vat || ir.taxCode || ir.address));
  if (issued) steps.push({ key: "invoice", label: "Fattura", state: "done", detail: b.invoiceNo ? `N. ${b.invoiceNo}` : "Emessa", href: "/documenti" });
  else if (c.invoiceStato === "bozza") steps.push({ key: "invoice", label: "Fattura", href: "/documenti", state: departed ? "late" : "todo", detail: "Bozza da controllare ed emettere" });
  else if (irAsked) steps.push({ key: "invoice", label: "Fattura", href: "/documenti", state: departed ? "late" : "todo", detail: "Richiesta dall'ospite" });
  else steps.push({ key: "invoice", label: "Fattura", href: "/documenti", state: "todo", detail: "Da emettere" }); // sempre presente, prima del check-out

  // 8 · Check-out
  steps.push({
    key: "checkout", label: "Check-out", href: "/pulizie",
    state: departed ? "done" : b.checkOut === c.today ? "todo" : "na",
    detail: departed ? "Partito" : b.checkOut === c.today ? "Parte oggi" : `Il ${fmtShort(b.checkOut)}`,
  });

  // 9 · Recensione (dopo la partenza)
  if (departed || b.checkOut === c.today) steps.push({
    key: "review", label: "Recensione", href: "/recensioni",
    state: b.reviewRequestedAt ? "done" : departed ? "todo" : "na",
    detail: b.reviewRequestedAt ? "Richiesta inviata" : departed ? `Da richiedere${note("review")}` : "Dopo la partenza",
  });

  // Ordine di lettura voluto: check-in, pagamento, guida, schedina, osservatorio, tassa, fattura, check-out (recensione per ultima).
  const ORDER = ["checkin", "pay", "guide", "alloggiati", "istat", "tax", "invoice", "checkout", "review"];
  steps.sort((a, b2) => ORDER.indexOf(a.key) - ORDER.indexOf(b2.key));

  // Invii automatici: sotto il passaggio ancora da fare, se ne esiste uno programmato, quando parte.
  if (c.auto) {
    const AUTO_KEYS: string[] = ["checkin", "guide", "pay", "review", "alloggiati"];
    for (const st of steps) {
      if (st.state === "done" || st.state === "na" || !AUTO_KEYS.includes(st.key)) continue;
      const line = autoLineFor(st.key as AutoStepKey, { structureId: b.structureId, checkIn: b.checkIn, checkOut: b.checkOut }, g ? { email: g.email, phone: g.phone } : undefined, c.auto, {
        today: c.today, wasSent: !!c.reminderNotes?.[st.key as "checkin" | "pay" | "guide" | "review"], schedina: sc, checkinDone: complete,
      });
      if (line) st.auto = line;
    }
  }

  const relevant = steps.filter((s) => s.state !== "na");
  const done = relevant.filter((s) => s.state === "done").length;
  const next = steps.find((s) => s.state === "late") ?? steps.find((s) => s.state === "todo");

  // Segnalazioni: cose da sapere che non sono un passaggio
  const chips: Chip[] = [];
  if (!b.unitId) chips.push({ key: "unit", label: "Camera da assegnare", tone: arrivesIn <= 3 ? "err" : "warn" });
  if (b.changeRequest) chips.push({ key: "chg", label: "Richiesta di modifica date", tone: "warn" });
  if (b.guestRequests) chips.push({ key: "req", label: `Richiesta: ${b.guestRequests.length > 40 ? b.guestRequests.slice(0, 40) + "…" : b.guestRequests}`, tone: "info" });
  if (b.arrivalTime) chips.push({ key: "eta", label: `Arrivo alle ${b.arrivalTime}`, tone: "info" });
  if ((g?.tags ?? []).includes("Animali")) chips.push({ key: "pet", label: "Animali", tone: "info" });
  if (g?.vip) chips.push({ key: "vip", label: "VIP", tone: "info" });
  if (b.cribs) chips.push({ key: "crib", label: `${b.cribs} culla`, tone: "info" });
  if (b.parking) chips.push({ key: "park", label: "Parcheggio", tone: "info" });
  if (g?.preferences) chips.push({ key: "pref", label: `Preferenze: ${g.preferences.length > 30 ? g.preferences.slice(0, 30) + "…" : g.preferences}`, tone: "info" });
  if ((b.extras ?? []).length) chips.push({ key: "extra", label: `${b.extras!.length} extra`, tone: "info" });
  const pendingOffers = (b.upsellOffers ?? []).filter((o) => o.status === "sent");
  if (pendingOffers.length) chips.push({ key: "offer", label: `${pendingOffers.length} offerta in attesa`, tone: "warn" });
  if (b.otaCard?.present && !b.otaCard.charged) chips.push({ key: "vcc", label: "Carta virtuale OTA da addebitare", tone: "warn" });
  if (b.depositPaid) chips.push({ key: "dep", label: "Caparra ricevuta", tone: "info" });
  if (b.refundable === false) chips.push({ key: "nr", label: "Non rimborsabile", tone: "info" });
  if (b.movedFrom) chips.push({ key: "moved", label: `Spostata da ${b.movedFrom.structureName}`, tone: "warn" });
  const inote = internalNote(b.note);
  if (inote) chips.push({ key: "note", label: `Nota interna: ${inote.length > 40 ? inote.slice(0, 40) + "…" : inote}`, tone: "info" });

  return { steps, done, total: relevant.length, next, chips };
}

// Categoria per i filtri rapidi della vista dettagliata.
export function journeyBucket(b: Booking, today: string, j: ReturnType<typeof journeyOf>): string[] {
  const out: string[] = [];
  if (j.steps.some((s) => s.state === "late")) out.push("late");
  if (j.steps.some((s) => s.state === "todo" || s.state === "late")) out.push("todo");
  if (b.checkIn === today) out.push("arrive");
  if (b.checkOut === today) out.push("leave");
  if (b.checkIn <= today && today < b.checkOut) out.push("inhouse");
  return out;
}
