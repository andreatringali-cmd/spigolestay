// «Adempimenti oggi»: UNA sola regola per il numero di cose da gestire.
// Prima la pagina Adempimenti, la Dashboard e il badge della barra laterale contavano in tre modi diversi (es. 2 / 4 / 3 sulla stessa struttura).
// Ora la regola è quella della pagina «Adempimenti oggi» (quella che l'utente vede cliccando) ed è scritta qui, pura e collaudata:
// pagina, Dashboard e badge la usano tutti (vedi use-adempimenti-oggi.ts).
//
// Cosa conta (una voce per riga):
//  1. check-in online da completare o da correggere, per GRUPPO di prenotazione, solo per gli arrivi di oggi;
//  2. schedine Questura pronte da inviare (arrivo oggi o già passato), una voce per prenotazione, solo se il check-in è completo e nessuna schedina è da validare;
//  3. movimenti ISTAT da inviare (arrivo oggi o già passato, prenotazione ancora viva);
//  4. fatture/ricevute da incassare (saldo residuo > 0) e 5. fatture scartate dallo SdI;
//  6. fatture fornitori scadute e non pagate.
// NON contano qui: tassa di soggiorno e saldo delle prenotazioni (si gestiscono in Pagamenti / Tassa di soggiorno), guide ospiti, errori Questura.
import type { Booking, Guest } from "./types";
import { addDaysYmd } from "./dates-rome";

// ---- Righe lette dal server (solo i campi che servono) ----
export interface AdSchedRow { id: string; arrival: string; stato: string; booking_id: string | null; guest?: { cognome?: string; nome?: string } | null; structure_id: string | null }
export interface AdIstatRow { id: string; arrival: string; stato: string; booking_id: string | null; structure_id: string | null }
export interface AdDocRow { id: string; structure_id: string | null; number_label: string | null; stato: string; total_cents: number; counterpart: { name?: string } | null }
export interface AdPayRow { document_id: string; amount_cents: number }
export interface AdPassiveRow { id: string; structure_id: string | null; supplier_name: string | null; due_date: string | null; total_cents: number; paid: boolean }

// ---- Completezza del check-in PER PERSONA ----
export const expectedPaxOf = (b: Booking) => Math.max(1, (b.adults ?? 1) + (b.children ?? 0));
export const primaryDoneOf = (b: Booking) => b.webCheckin === true || !!(b.primaryGuest?.lastName && b.primaryGuest?.docNumber);
// Un ospite conta come «dichiarato» solo se ha davvero dei dati (nome/cognome): un segnaposto vuoto non conta.
export const declaredPaxOf = (b: Booking) => (primaryDoneOf(b) ? 1 : 0) + (b.extraGuests?.filter((e) => !!(e.lastName || e.firstName)).length ?? 0);
export const isCheckinComplete = (b: Booking) => declaredPaxOf(b) > 0 && declaredPaxOf(b) >= expectedPaxOf(b);
export const isActiveBooking = (b: { status: string; channel: string }) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked";
export const bookingNo = (b: Booking) => b.code || b.id.slice(0, 6).toUpperCase();

export interface ArrivalGroup { key: string; rep: Booking; members: Booking[]; rooms: number; expected: number; declared: number; cat: "todo" | "fix" | "done" }
export interface SchedGroup { key: string; bookingId: string | null; arrival: string; structureId: string | null; count: number }

export interface AdempimentiInput {
  /** Prenotazioni già limitate alla struttura selezionata. */
  bookings: Booking[];
  /** Anagrafica ospiti (per i dati dell'ospite principale quando la prenotazione non li conserva). */
  getGuest: (id: string) => Guest | undefined;
  /** Oggi nel fuso italiano (YYYY-MM-DD). */
  today: string;
  /** Righe del server GIÀ limitate alla struttura selezionata. */
  sched: AdSchedRow[]; istat: AdIstatRow[]; docs: AdDocRow[]; pays: AdPayRow[]; passive: AdPassiveRow[];
}

/** Raggruppa le schedine per PRENOTAZIONE (una riga per prenotazione, con quante schedine ha). */
export function groupSched(list: AdSchedRow[]): SchedGroup[] {
  const m = new Map<string, SchedGroup>();
  for (const s of list) {
    const key = s.booking_id || s.id;
    const cur = m.get(key) ?? { key, bookingId: s.booking_id, arrival: s.arrival, structureId: s.structure_id, count: 0 };
    cur.count += 1;
    if (s.arrival && (!cur.arrival || s.arrival < cur.arrival)) cur.arrival = s.arrival;
    m.set(key, cur);
  }
  return [...m.values()].sort((a, b) => (a.arrival < b.arrival ? -1 : 1));
}

const guestFieldsOk = (g?: { lastName?: string; firstName?: string; sex?: string; birthDate?: string; birthPlace?: string; citizenship?: string; country?: string }) =>
  !!(g?.lastName && g?.firstName && g?.sex && g?.birthDate && g?.birthPlace && (g?.citizenship || g?.country));

export function computeAdempimentiOggi(inp: AdempimentiInput) {
  const { bookings, getGuest, today: t, sched, istat, docs, pays, passive } = inp;

  // Prenotazioni con almeno una schedina «da validare».
  const bookingsWithInvalid = new Set(sched.filter((s) => s.stato === "da_validare" && s.booking_id).map((s) => s.booking_id as string));
  // Validità calcolata sui DATI VERI della prenotazione (non sulla schedina, che è una copia).
  const bookingDataValid = (b: Booking) => {
    const p = b.primaryGuest ?? getGuest(b.guestId); // i dati del check-in stanno sulla prenotazione; l'anagrafica è condivisa fra le camere di un gruppo
    if (!guestFieldsOk(p) || !(p?.docType && p?.docNumber && (p as { docPlace?: string })?.docPlace)) return false; // anche il luogo di rilascio: la schedina lo richiede
    for (const e of (b.extraGuests ?? [])) if (!guestFieldsOk(e)) return false;
    return !bookingsWithInvalid.has(b.id); // schedina già rifiutata dal controllo: il check-in NON è «valido»
  };

  // Arrivi di oggi divisi in 3 (per GRUPPO): da completare, da correggere, fatti.
  const arrivalsToday = bookings.filter((b) => b.checkIn === t && isActiveBooking(b));
  const solo: Booking[] = [];
  const byGroup = new Map<string, Booking[]>();
  for (const b of arrivalsToday) {
    if (b.groupId) { const arr = byGroup.get(b.groupId) ?? []; arr.push(b); byGroup.set(b.groupId, arr); } else solo.push(b);
  }
  const mk = (members: Booking[], key: string): ArrivalGroup => {
    const rep = [...members].sort((a, c) => { const ka = bookingNo(a), kc = bookingNo(c); if (ka !== kc) return ka < kc ? -1 : 1; return (a.checkIn || "") < (c.checkIn || "") ? -1 : 1; })[0];
    const expected = members.reduce((s, m) => s + expectedPaxOf(m), 0);
    const declared = members.reduce((s, m) => s + declaredPaxOf(m), 0);
    const allDone = members.every((m) => isCheckinComplete(m) && bookingDataValid(m));
    const someFix = members.some((m) => isCheckinComplete(m) && !bookingDataValid(m));
    return { key, rep, members, rooms: members.length, expected, declared, cat: allDone ? "done" : someFix ? "fix" : "todo" };
  };
  const arrivalGroups: ArrivalGroup[] = [];
  for (const b of solo) arrivalGroups.push(mk([b], b.id));
  for (const [gid, members] of byGroup) arrivalGroups.push(mk(members, gid));
  arrivalGroups.sort((a, b) => ((a.rep.checkIn || "") < (b.rep.checkIn || "") ? -1 : 1));
  const groupsNoCheckin = arrivalGroups.filter((g) => g.cat === "todo");
  const groupsToFix = arrivalGroups.filter((g) => g.cat === "fix");
  const groupsCheckedIn = arrivalGroups.filter((g) => g.cat === "done");

  const paidByDoc = new Map<string, number>();
  for (const p of pays) paidByDoc.set(p.document_id, (paidByDoc.get(p.document_id) ?? 0) + p.amount_cents);
  const balanceOf = (d: { id: string; total_cents: number }) => d.total_cents - (paidByDoc.get(d.id) ?? 0);

  // Solo prenotazioni ancora attive: schedine/ISTAT di annullate o no-show spariscono subito.
  const activeBookingIds = new Set(bookings.filter(isActiveBooking).map((b) => b.id));
  const isActive = (bookingId: string | null) => !bookingId || activeBookingIds.has(bookingId);
  // Solo le prenotazioni col check-in COMPLETO per tutte le persone possono avere schedine «da inviare».
  const completeBookingIds = new Set(bookings.filter((b) => isActiveBooking(b) && isCheckinComplete(b)).map((b) => b.id));
  const schedPending = sched.filter((s) => s.stato === "pronta" && isActive(s.booking_id) && !!s.booking_id && completeBookingIds.has(s.booking_id) && !bookingsWithInvalid.has(s.booking_id));
  const schedToSend = schedPending.filter((s) => (s.arrival || "") <= t);
  const schedSent = sched.filter((s) => s.stato === "inviata");
  const schedBookingIds = new Set(sched.map((s) => s.booking_id).filter(Boolean) as string[]);
  const weekAgo = addDaysYmd(t, -7);
  // Check-in completo ma SENZA schedine ancora generate → «da trasferire alle schedine».
  const needsTransfer = bookings.filter((b) => isActiveBooking(b) && isCheckinComplete(b) && (b.checkIn || "") >= weekAgo && !schedBookingIds.has(b.id));
  const toTransfer = groupsCheckedIn.filter((g) => !g.members.every((m) => schedBookingIds.has(m.id)));
  const schedToSendG = groupSched(schedToSend);
  const schedSentG = groupSched(schedSent);

  const istatPend = istat.filter((s) => s.stato === "pending" && isActive(s.booking_id) && (s.arrival || "") <= t);
  const istatSent = istat.filter((s) => s.stato === "sent");

  const docsUnpaid = docs.filter((d) => d.stato !== "scartata" && balanceOf(d) > 0);
  const docsPaid = docs.filter((d) => d.stato !== "scartata" && balanceOf(d) <= 0);
  const docsRejected = docs.filter((d) => d.stato === "scartata");
  const docsSdiOk = docs.filter((d) => d.stato !== "scartata");
  const passiveUnpaid = passive.filter((p) => !p.paid);
  const passivePaid = passive.filter((p) => p.paid);
  const passiveOverdue = passiveUnpaid.filter((p) => p.due_date && p.due_date <= t);

  // IL numero: stessi conteggi delle sei card della pagina.
  const checkinTodo = groupsNoCheckin.length + groupsToFix.length;
  const total = checkinTodo + schedToSendG.length + istatPend.length + docsUnpaid.length + docsRejected.length + passiveOverdue.length;
  const urgent = schedToSendG.length + docsRejected.length + passiveOverdue.length; // scadenze e rifiuti = priorità alta
  return {
    arrivalGroups, groupsNoCheckin, groupsToFix, groupsCheckedIn,
    schedToSendG, schedSentG, needsTransfer, toTransfer, schedBookingIds,
    istatPend, istatSent, docsUnpaid, docsPaid, docsRejected, docsSdiOk, passiveUnpaid, passivePaid, passiveOverdue, balanceOf,
    counts: { checkinTodo, total, urgent, toDo: total - urgent, allClear: total === 0, schedine: schedToSendG.length, istat: istatPend.length },
  };
}
export type AdempimentiOggi = ReturnType<typeof computeAdempimentiOggi>;
