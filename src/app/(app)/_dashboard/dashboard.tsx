"use client";

// Dashboard: la dashboard "a mosaico". Poche cose giuste: hero con la sintesi del giorno, adempimenti subito sotto,
// poi Oggi, i prossimi 14 giorni, i ricavi del mese, i canali e ciò che merita un'occhiata.
// I calcoli stanno in lib/dashboard.ts (puri e collaudati); qui si collegano ai dati reali e si disegna.
// La dashboard classica resta su "/" e ha un collegamento qui (e viceversa).
import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { CHANNELS, type Channel } from "@/lib/types";
import { toISO, parseISO, nights } from "@/lib/dates";
import { num } from "@/lib/format";
import { bookingPaidTotal, cityTaxOf, nightlyRevenue } from "@/lib/booking";
import { journeyOf, type JourneyStep } from "@/lib/booking-journey";
import { channelPulse } from "@/lib/channel-pulse";
import { contactReportCached } from "@/lib/contacts-check";
import { upcomingContactIssues } from "@/lib/contacts-upcoming";
import { isGuideSent, reminderNotes, useReminderLog } from "@/lib/guest-messages";
import {
  addDaysISO, adempimentiHealth, adempimentiStato, buildAdempimenti, buildControlli, diffDays, greetingFor, histogram, isLive, LEAD_LABELS, LEAD_UPPER,
  leadDays, monthStats, occupancyStrip, pickupDaily, rateSeries, splitDay, statusSentence, STAY_LABELS, STAY_UPPER, stayNights, todaySentence, topCountries,
  unassignedArrivals,
} from "@/lib/dashboard";
import Hero from "./_hero";
import Adempimenti from "./_adempimenti";
import Oggi, { type MoveRow } from "./_oggi";
import Giorni from "./_giorni";
import Incassi from "./_incassi";
import Canali, { type ChannelRow } from "./_canali";
import Controllo from "./_controllo";
import Pickup from "./_pickup";
import Provenienza from "./_provenienza";
import Prenotazioni from "./_prenotazioni";
import { D2Styles } from "./_kit";
import { useDashboard2Dati } from "./_dati";

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const OTA_CH = ["booking", "airbnb", "expedia", "hotelbeds"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MESI_BREVI[Number(iso.slice(5, 7)) - 1]}`;

export default function Dashboard2() {
  const { bookings, guests, units, structures, openBooking, activeStructureId } = useData();
  const sFilter = activeStructureId;

  // Orologio: oggi e ora (aggiornati ogni minuto, così il saluto e il giorno restano giusti a pagina aperta).
  const [clock, setClock] = useState(() => { const d = new Date(); return { iso: toISO(d), hour: d.getHours() }; });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date(); const iso = toISO(d), hour = d.getHours();
      setClock((c) => (c.iso === iso && c.hour === hour ? c : { iso, hour }));
    }, 60000);
    return () => clearInterval(id);
  }, []);
  const today = clock.iso;

  // Scope: prenotazioni vere e camere della struttura attiva.
  const live = useMemo(() => bookings.filter((b) => isLive(b) && (sFilter === "all" || b.structureId === sFilter)), [bookings, sFilter]);
  const scopedUnits = useMemo(() => (sFilter === "all" ? units : units.filter((u) => u.structureId === sFilter)), [units, sFilter]);
  const guestMap = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const structMap = useMemo(() => new Map(structures.map((s) => [s.id, s])), [structures]);
  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const guestName = (id: string) => guestMap.get(id)?.fullName ?? "Ospite";
  const guestShort = (id: string) => { const g = guestMap.get(id); return g?.lastName || g?.fullName || "Ospite"; };

  // Dati esterni (Questura, ISTAT, invii, canali).
  const structureIds = useMemo(() => (sFilter === "all" ? structures.map((s) => s.id) : [sFilter]), [sFilter, structures]);
  const dati = useDashboard2Dati(structureIds, sFilter, today);
  const windowBookings = useMemo(() => live.filter((b) => b.checkOut >= addDaysISO(today, -14) && b.checkIn <= addDaysISO(today, 2)), [live, today]);
  const remLog = useReminderLog(windowBookings);

  // Percorso della prenotazione (check-in, pagamento, tassa, guida…): stessa logica di Prenotazioni.
  const stepsOf = (b: (typeof bookings)[number]): JourneyStep[] | null => journeyOf(b, {
    today, guest: guestMap.get(b.guestId), structure: structMap.get(b.structureId),
    schedina: dati.schedBy.get(b.id) ?? "none", istat: dati.istatPendingIds.has(b.id) ? "pending" : "none",
    guideSent: isGuideSent(b, dati.threads[b.guestId], remLog[b.id]), reminderNotes: reminderNotes(remLog[b.id]),
  }).steps;
  const balanceOf = (b: (typeof bookings)[number]) => Math.max(0, bookingPaidTotal(b) - (b.paid ?? 0));

  // --- Giornata ---
  const split = useMemo(() => splitDay(live, today), [live, today]);
  // 61 giorni: i 30 passati, oggi (posizione 30) e i 30 a venire. Dalla striscia escono anche le sparkline dell'hero.
  const strip = useMemo(() => occupancyStrip(live, scopedUnits, addDaysISO(today, -30), 61, today), [live, scopedUnits, today]);
  const tonight = strip[30];
  const last14 = strip.slice(17, 31);

  // --- Adempimenti ---
  const items = useMemo(() => buildAdempimenti({
    bookings: live, today,
    journeyFor: (b) => stepsOf(b),
    schedinaOf: (b) => dati.schedBy.get(b.id) ?? "none",
    istatPending: (b) => dati.istatPendingIds.has(b.id),
    taxOf: (b) => cityTaxOf(structMap.get(b.structureId), b.adults, nights(b.checkIn, b.checkOut), b.total ?? 0, b.cityTaxExempt),
    balanceOf,
    nameOf: (b) => guestShort(b.guestId),
    questuraErrors: dati.questuraErrors,
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [live, today, dati.schedBy, dati.istatPendingIds, dati.threads, dati.questuraErrors, remLog, structMap, guestMap]);
  const stato = adempimentiStato(items);
  const health = useMemo(() => adempimentiHealth(live, today, (b) => stepsOf(b)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [live, today, dati.schedBy, dati.istatPendingIds, dati.threads, remLog, structMap, guestMap]);
  const loadingAdem = !dati.ready;

  // --- Da controllare ---
  const contactIssues = useMemo(() => upcomingContactIssues(live, guests, today, contactReportCached), [live, guests, today]);
  const pulseBad = useMemo(() => channelPulse({
    bookings: bookings.filter((b) => OTA_CH.includes(b.channel) && (sFilter === "all" || b.structureId === sFilter)).map((b) => ({ channel: b.channel, bookedOn: b.bookedOn })),
    today,
    connected: Object.fromEntries(Object.entries(dati.chConn).filter(([k]) => OTA_CH.includes(k))),
    labels: Object.fromEntries(OTA_CH.map((k) => [k, CHANNELS[k as Channel]?.label ?? k])),
  }).filter((p): p is typeof p & { level: "err" | "warn" } => p.level === "err" || p.level === "warn"), [bookings, sFilter, today, dati.chConn]);
  const controlli = useMemo(() => buildControlli({
    unassigned: unassignedArrivals(live, today, 7),
    contacts: { count: contactIssues.length, urgent: contactIssues.filter((x) => x.urgent).length },
    invii: dati.inviiKo,
    pulse: pulseBad.map((p) => ({ channel: p.channel, label: p.label, level: p.level, headline: p.headline, detail: p.detail })),
    oos: scopedUnits.filter((u) => u.outOfService).length,
  }), [live, today, contactIssues, dati.inviiKo, pulseBad, scopedUnits]);

  // --- Ricavi del mese e canali ---
  const mIdx = Number(today.slice(5, 7)) - 1;
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthDays = new Date(Date.UTC(Number(today.slice(0, 4)), mIdx + 1, 0)).getUTCDate();
  const nextMonthStart = addDaysISO(monthStart, monthDays);
  const prevStart = `${addDaysISO(monthStart, -1).slice(0, 7)}-01`;
  const cur = useMemo(() => monthStats(live, monthStart, nextMonthStart, today, nightlyRevenue), [live, monthStart, nextMonthStart, today]);
  const prev = useMemo(() => monthStats(live, prevStart, monthStart, today, nightlyRevenue), [live, prevStart, monthStart, today]);
  const channelRows: ChannelRow[] = useMemo(() => cur.byChannel.filter((r) => r.revenue > 0 && r.channel in CHANNELS).slice(0, 5).map((r) => ({
    channel: r.channel as Channel, label: CHANNELS[r.channel as Channel].label, color: `var(${CHANNELS[r.channel as Channel].cssVar})`,
    revenue: Math.round(r.revenue), count: r.count, share: cur.total ? Math.round((r.revenue / cur.total) * 100) : 0,
  })), [cur]);

  // ADR e RevPAR degli ultimi 14 giorni (ricavo per notte / camere occupate, e / camere disponibili).
  const rates = useMemo(() => {
    const rev = monthStats(live, addDaysISO(today, -13), addDaysISO(today, 1), today, nightlyRevenue).daily;
    return rateSeries(rev, last14.map((c) => c.occupied), tonight?.total ?? 0);
  }, [live, today, last14, tonight]);

  // Pickup, anticipo, durata e provenienza (ultimi 12 mesi di arrivi).
  const pickup = useMemo(() => pickupDaily(live, today, 30), [live, today]);
  const yearAgo = addDaysISO(today, -365);
  const lastYear = useMemo(() => live.filter((b) => b.checkIn >= yearAgo && b.checkIn <= today), [live, yearAgo, today]);
  const leadHisto = useMemo(() => histogram(lastYear.map(leadDays).filter((v): v is number => v !== null), LEAD_UPPER, LEAD_LABELS), [lastYear]);
  const stayHisto = useMemo(() => histogram(lastYear.map(stayNights), STAY_UPPER, STAY_LABELS), [lastYear]);
  const countries = useMemo(() => topCountries(lastYear.map((b) => guestMap.get(b.guestId)?.country), 5), [lastYear, guestMap]);

  // --- Righe di "Oggi" ---
  const multiAll = sFilter === "all" && structures.length > 1;
  const rows: MoveRow[] = useMemo(() => {
    const room = (b: (typeof bookings)[number]) => { const u = b.unitId ? unitMap.get(b.unitId) : undefined; return u ? u.name.replace(/^camera\s*/i, "") : null; };
    const pax = (b: (typeof bookings)[number]) => { const n = b.adults + b.children; return `${n} ${n === 1 ? "ospite" : "ospiti"}`; };
    const where = (b: (typeof bookings)[number]) => (multiAll ? ` · ${structMap.get(b.structureId)?.name ?? ""}` : "");
    const byRoom = (a: (typeof bookings)[number], b: (typeof bookings)[number]) => (unitMap.get(a.unitId ?? "")?.name ?? "~").localeCompare(unitMap.get(b.unitId ?? "")?.name ?? "~", "it", { numeric: true });
    const turn = (b: (typeof bookings)[number]) => !!b.unitId && split.turnoverUnits.has(b.unitId);
    const out: MoveRow[] = [];
    for (const b of [...split.arrivals].sort((a, c) => (a.arrivalTime ?? "99").localeCompare(c.arrivalTime ?? "99") || byRoom(a, c))) {
      const ci = stepsOf(b)?.find((s) => s.key === "checkin");
      out.push({
        id: b.id, kind: "arr", turnover: turn(b), room: room(b), name: guestName(b.guestId),
        sub: `${pax(b)} · ${CHANNELS[b.channel].label}${b.arrivalTime ? ` · arrivo ${b.arrivalTime}` : ""}${where(b)}`,
        chip: !b.unitId ? { text: "Senza camera", tone: "err" } : ci?.state === "done" ? { text: "Check-in fatto", tone: "ok" } : { text: "Check-in da fare", tone: "warn" },
      });
    }
    for (const b of [...split.departures].sort(byRoom)) {
      const bal = balanceOf(b);
      out.push({
        id: b.id, kind: "dep", turnover: turn(b), room: room(b), name: guestName(b.guestId),
        sub: `${pax(b)} · ${CHANNELS[b.channel].label}${turn(b) ? " · poi nuovo arrivo" : ""}${where(b)}`,
        chip: bal > 0.005 ? { text: `€ ${num(bal)} da incassare`, tone: "warn" } : bookingPaidTotal(b) > 0 ? { text: "Saldato", tone: "ok" } : undefined,
      });
    }
    for (const b of [...split.inHouse].sort((a, c) => a.checkOut.localeCompare(c.checkOut) || byRoom(a, c))) {
      const bal = balanceOf(b);
      out.push({
        id: b.id, kind: "stay", turnover: false, room: room(b), name: guestName(b.guestId),
        sub: `${pax(b)} · fino al ${shortDate(b.checkOut)}${where(b)}`,
        chip: bal > 0.005 ? { text: `Saldo € ${num(bal)}`, tone: "warn" } : undefined,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [split, unitMap, structMap, guestMap, multiAll, dati.threads, dati.schedBy, remLog, today]);

  // --- Testi ---
  const dateLabel = cap(parseISO(today).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }));
  const scopeLabel = sFilter === "all" ? (structures.length > 1 ? "Tutte le strutture" : structures[0]?.name ?? "") : structMap.get(sFilter)?.name ?? "";
  const statusText = loadingAdem ? "Controllo gli adempimenti…" : statusSentence(stato.total, stato.urgent).replace(/\.$/, "");
  const statusTone = loadingAdem ? "dim" : stato.tone;

  const controlliOnTop = controlli.length > 0;
  const wrap = "min-w-0 [&>section]:h-full";
  const SPAN: Record<number, string> = { 1: "lg:col-span-12", 2: "lg:col-span-6", 3: "lg:col-span-4" };
  const hasPickup = pickup.total > 0;
  const hasPren = leadHisto.total > 0 || stayHisto.total > 0;
  const rowC = 1 + (channelRows.length > 0 ? 1 : 0) + (countries.rows.length > 0 ? 1 : 0);
  return (
    <div className="d2-root">
      <D2Styles />
      {/* key = struttura: cambiando struttura tutto si ridisegna con una transizione morbida */}
      <div key={sFilter} className="d2-fade flex flex-col gap-4">
        <Hero
          greeting={greetingFor(clock.hour)} dateLabel={dateLabel} scopeLabel={scopeLabel}
          sentence={todaySentence(split.arrivals.length, split.departures.length, split.inHouse.length)}
          statusText={statusText} statusTone={statusTone} statusCount={stato.total}
          arrivals={split.arrivals.length} departures={split.departures.length} stays={split.inHouse.length}
          arrSpark={last14.map((c) => c.arrivals)} depSpark={last14.map((c) => c.departures)} staySpark={last14.map((c) => c.stay)}
          occupied={tonight?.occupied ?? 0} totalRooms={tonight?.total ?? 0} pct={tonight?.pct ?? 0}
        />
        <div className="grid gap-4 lg:grid-cols-12">
          <div className={`order-4 lg:order-none ${hasPickup ? "lg:col-span-8" : "lg:col-span-12"} ${wrap}`}><Giorni cells={strip} delay={60} /></div>
          {hasPickup && <div className={`order-5 lg:order-none lg:col-span-4 ${wrap}`}><Pickup pickup={pickup} delay={120} /></div>}
          <div className={`order-6 lg:order-none ${SPAN[rowC]} ${wrap}`}><Incassi monthName={MESI[mIdx]} prevName={MESI[(mIdx + 11) % 12]} cur={cur} prev={prev} todayIdx={diffDays(today, monthStart)} adr={{ avg: rates.adrAvg, series: rates.adr }} revpar={{ avg: rates.revparAvg, series: rates.revpar }} delay={60} /></div>
          {channelRows.length > 0 && <div className={`order-7 lg:order-none ${SPAN[rowC]} ${wrap}`}><Canali rows={channelRows} total={cur.total} monthName={MESI[mIdx]} delay={120} /></div>}
          {countries.rows.length > 0 && <div className={`order-8 lg:order-none ${SPAN[rowC]} ${wrap}`}><Provenienza rows={countries.rows} known={countries.known} delay={180} /></div>}
          {hasPren && <div className={`order-9 lg:order-none lg:col-span-5 ${wrap}`}><Prenotazioni lead={leadHisto} stay={stayHisto} delay={60} /></div>}
          <div className={`${controlliOnTop ? "order-3" : "order-10"} lg:order-none ${hasPren ? "lg:col-span-7" : "lg:col-span-12"} ${wrap}`}><Controllo items={controlli} delay={120} /></div>
          <div className={`order-11 lg:order-none lg:col-span-7 ${wrap}`}><Adempimenti items={items} total={stato.total} urgent={stato.urgent} loading={loadingAdem} health={health} delay={60} /></div>
          <div className={`order-12 lg:order-none lg:col-span-5 ${wrap}`}><Oggi rows={rows} turnovers={split.turnoverUnits.size} onOpen={openBooking} delay={120} /></div>
        </div>
      </div>
    </div>
  );
}
