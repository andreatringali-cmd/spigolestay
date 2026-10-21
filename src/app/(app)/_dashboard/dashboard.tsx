"use client";

// Dashboard: la prima pagina dopo l'accesso, un cruscotto di lavoro.
// Dall'alto: testata sottile (giorno, struttura, aggiorna) → eventuale «Completa la configurazione» → indicatori di oggi →
// a sinistra «Da fare» e «Oggi», a destra occupazione, ricavi e canali → «Altri indicatori» (chiusi).
// I calcoli stanno in lib/dashboard.ts (puri e collaudati); qui si collegano ai dati reali. Su telefono: indicatori → Da fare → Oggi → il resto.
import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { CHANNELS, type Channel } from "@/lib/types";
import { toISO, parseISO, nights, fmtDM, fmtDMY } from "@/lib/dates";
import { eur } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { bookingPaidTotal, cityTaxOfBooking } from "@/lib/booking";
import { stayDue } from "@/lib/incassi";
import { journeyOf, type JourneyStep } from "@/lib/booking-journey";
import { channelPulse } from "@/lib/channel-pulse";
import { contactReportCached } from "@/lib/contacts-check";
import { upcomingContactIssues } from "@/lib/contacts-upcoming";
import { guideHasText } from "@/lib/guide-copy";
import { isGuideSent, reminderNotes, useReminderLog } from "@/lib/guest-messages";
import {
  addDaysISO, adempimentiHealth, adempimentiStato, buildAdempimenti, buildControlli, buildSetupSteps, buildTodo, greetingFor, isLive,
  monthStats, occupancyOutlook, occupancyStrip, plural, splitDay, stayNights, unassignedArrivals,
} from "@/lib/dashboard";
import { useAuth } from "@/lib/authsync";
import { useAccess } from "@/lib/access";
import { loadChannelColor } from "@/lib/channelOverrides";
import { BTN_SM } from "./_kit";
import Kpis, { type KpiItem } from "./_kpi";
import Avvio from "./_avvio";
import DaFare from "./_dafare";
import Oggi, { type MoveRow } from "./_oggi";
import Occupazione from "./_occupazione";
import Ricavi from "./_ricavi";
import Canali, { type ChannelRow } from "./_canali";
import Altri from "./_altri";
import { useDashboard2Dati } from "./_dati";

const OTA_CH = ["booking", "airbnb", "expedia", "agoda", "google", "hotelbeds"];
const SETUP_HIDDEN_KEY = "xn-dash-avvio"; // preferenza per dispositivo: «Completa la configurazione» nascosto ("1")
const GUIDES_KEY = "spigolestay:guides";   // guide ospiti (per struttura)
const ICAL_KEY = "spigolestay:icalfeeds:v1"; // calendari collegati
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ospiti = (n: number) => `${n} ${plural(n, "ospite", "ospiti")}`;
type Bk = ReturnType<typeof useData>["bookings"][number];

export default function Dashboard() {
  const { bookings, guests, units, roomTypes, structures, allStructures, openBooking, openNewBooking, activeStructureId, setActiveStructure } = useData();
  const sFilter = activeStructureId;

  // Orologio: oggi e ora (aggiornati ogni minuto, così il giorno resta giusto a pagina aperta).
  const [clock, setClock] = useState(() => { const d = new Date(); return { iso: toISO(d), hour: d.getHours() }; });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date(); const iso = toISO(d), hour = d.getHours();
      setClock((c) => (c.iso === iso && c.hour === hour ? c : { iso, hour }));
    }, 60000);
    return () => clearInterval(id);
  }, []);
  const today = clock.iso;

  // Scope: prenotazioni vere e camere della struttura attiva (con l'apertura su una struttura sola, in modalità veloce, solo i suoi dati).
  const live = useMemo(() => bookings.filter((b) => isLive(b) && (sFilter === "all" || b.structureId === sFilter)), [bookings, sFilter]);
  const scopedUnits = useMemo(() => (sFilter === "all" ? units : units.filter((u) => u.structureId === sFilter)), [units, sFilter]);
  const scopeStructures = useMemo(() => (sFilter === "all" ? structures : structures.filter((s) => s.id === sFilter)), [structures, sFilter]);
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
  const stepsOf = (b: Bk): JourneyStep[] | null => journeyOf(b, {
    today, guest: guestMap.get(b.guestId), structure: structMap.get(b.structureId),
    schedina: dati.schedBy.get(b.id) ?? "none", istat: dati.istatPendingIds.has(b.id) ? "pending" : "none",
    guideSent: isGuideSent(b, dati.threads[b.guestId], remLog[b.id]), reminderNotes: reminderNotes(remLog[b.id]),
  }).steps;
  const balanceOf = (b: Bk) => stayDue(b, structMap.get(b.structureId));

  // --- Giornata ---
  const split = useMemo(() => splitDay(live, today), [live, today]);
  // Prossimi 14 giorni (oggi compreso): una sola passata; la prima colonna è «stanotte».
  const strip = useMemo(() => occupancyStrip(live, scopedUnits, today, 14, today), [live, scopedUnits, today]);
  const tonight = strip[0];
  const outlook = useMemo(() => occupancyOutlook(strip), [strip]);

  // --- Adempimenti ---
  const items = useMemo(() => buildAdempimenti({
    bookings: live, today,
    journeyFor: (b) => stepsOf(b),
    schedinaOf: (b) => dati.schedBy.get(b.id) ?? "none",
    istatPending: (b) => dati.istatPendingIds.has(b.id),
    taxOf: (b) => cityTaxOfBooking(structMap.get(b.structureId), b),
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
  const todo = useMemo(() => buildTodo(items, controlli), [items, controlli]);

  // --- Ricavi e canali: TUTTI sulle prenotazioni in corso e future, come il riepilogo di Prenotazioni (chi parte oggi conta ancora; totale lordo = soggiorno + pulizia + extra) ---
  const upcomingList = useMemo(() => live.filter((b) => b.checkOut >= today), [live, today]);
  const upcoming = useMemo(() => ({
    total: upcomingList.reduce((a, b) => a + bookingPaidTotal(b), 0), count: upcomingList.length, nights: upcomingList.reduce((a, b) => a + nights(b.checkIn, b.checkOut), 0),
  }), [upcomingList]);
  // Ricavi per canale: il totale di ogni prenotazione intero (spalmato sulle sue notti) sull'intero arco delle prenotazioni.
  const byChannel = useMemo(() => {
    if (!upcomingList.length) return [];
    const from = upcomingList.reduce((m, b) => (b.checkIn < m ? b.checkIn : m), upcomingList[0].checkIn);
    const to = upcomingList.reduce((m, b) => (b.checkOut > m ? b.checkOut : m), upcomingList[0].checkOut);
    return monthStats(upcomingList, from, to, today, (b) => bookingPaidTotal(b) / stayNights(b)).byChannel;
  }, [upcomingList, today]);
  const channelRows: ChannelRow[] = useMemo(() => byChannel.filter((r) => r.revenue > 0 && r.channel in CHANNELS).slice(0, 5).map((r) => ({
    channel: r.channel as Channel, label: r.mixed ? "Altre OTA" : CHANNELS[r.channel as Channel].label, color: loadChannelColor(r.channel as Channel) || `var(${CHANNELS[r.channel as Channel].cssVar})`, // il colore scelto in Canali, altrimenti quello del portale
    revenue: Math.round(r.revenue), count: r.count, share: upcoming.total ? Math.round((r.revenue / upcoming.total) * 100) : 0, name: r.name,
  })), [byChannel, upcoming.total]);

  // --- «Oggi»: righe e piccoli totali per gli indicatori ---
  const multiAll = sFilter === "all" && structures.length > 1;
  const day = useMemo(() => {
    const room = (b: Bk) => { const u = b.unitId ? unitMap.get(b.unitId) : undefined; return u ? u.name.replace(/^camera\s*/i, "") : null; };
    const pax = (b: Bk) => b.adults + b.children;
    const where = (b: Bk) => (multiAll ? ` · ${structMap.get(b.structureId)?.name ?? ""}` : "");
    const byRoom = (a: Bk, b: Bk) => (unitMap.get(a.unitId ?? "")?.name ?? "~").localeCompare(unitMap.get(b.unitId ?? "")?.name ?? "~", "it", { numeric: true });
    const turn = (b: Bk) => !!b.unitId && split.turnoverUnits.has(b.unitId);
    const out: MoveRow[] = [];
    let checkinTodo = 0, depDue = 0, guestsIn = 0;
    for (const b of [...split.arrivals].sort((a, c) => (a.arrivalTime ?? "99").localeCompare(c.arrivalTime ?? "99") || byRoom(a, c))) {
      const ci = stepsOf(b)?.find((s) => s.key === "checkin");
      const bal = balanceOf(b);
      const chips: MoveRow["chips"] = [];
      if (!b.unitId) chips.push({ text: "Senza camera", tone: "err" });
      if (ci?.state === "done") chips.push({ text: "Check-in fatto", tone: "ok" });
      else if (ci?.state !== "na") { chips.push({ text: "Check-in da fare", tone: "warn" }); checkinTodo++; }
      if (bal > 0.005) chips.push({ text: `Da incassare ${eur(bal)}`, tone: "warn" });
      out.push({ id: b.id, kind: "arr", turnover: turn(b), room: room(b), name: guestName(b.guestId), sub: `${ospiti(pax(b))} · ${CHANNELS[b.channel].label}${b.arrivalTime ? ` · arrivo ${b.arrivalTime}` : ""}${turn(b) ? " · turnover" : ""}${where(b)}`, chips });
    }
    for (const b of [...split.departures].sort(byRoom)) {
      const bal = balanceOf(b);
      const chips: MoveRow["chips"] = [];
      if (bal > 0.005) { chips.push({ text: `Da incassare ${eur(bal)}`, tone: "warn" }); depDue += bal; }
      else if (bookingPaidTotal(b) > 0) chips.push({ text: "Saldato", tone: "ok" });
      out.push({ id: b.id, kind: "dep", turnover: turn(b), room: room(b), name: guestName(b.guestId), sub: `${ospiti(pax(b))} · ${CHANNELS[b.channel].label}${turn(b) ? " · turnover: poi nuovo arrivo" : ""}${where(b)}`, chips });
    }
    for (const b of [...split.inHouse].sort((a, c) => a.checkOut.localeCompare(c.checkOut) || byRoom(a, c))) {
      const bal = balanceOf(b);
      guestsIn += pax(b);
      out.push({ id: b.id, kind: "stay", turnover: false, room: room(b), name: guestName(b.guestId), sub: `${ospiti(pax(b))} · fino al ${fmtDM(b.checkOut)}${where(b)}`, chips: bal > 0.005 ? [{ text: `Saldo ${eur(bal)}`, tone: "warn" }] : [] });
    }
    return { rows: out, checkinTodo, depDue, guestsIn };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [split, unitMap, structMap, guestMap, multiAll, dati.threads, dati.schedBy, remLog, today]);

  // --- Configurazione iniziale: passi veri per la struttura (o le strutture) che si sta guardando ---
  // Guide e calendari stanno nel browser: si leggono una volta in effetto (mai in render, per non creare differenze con il server) e a ogni ritorno sulla finestra.
  const [local, setLocal] = useState<{ guides: Set<string>; ical: number; hidden: boolean } | null>(null);
  useEffect(() => {
    const read = () => {
      let guides = new Set<string>(), ical = 0, hidden = false;
      try { const all = JSON.parse(localStorage.getItem(GUIDES_KEY) || "{}") as Record<string, { content?: unknown }>; guides = new Set(Object.keys(all).filter((id) => guideHasText(all[id]?.content))); } catch { /* guida illeggibile: come se mancasse */ }
      try { const f = JSON.parse(localStorage.getItem(ICAL_KEY) || "[]"); ical = Array.isArray(f) ? f.length : 0; } catch { /* nessun calendario */ }
      try { hidden = localStorage.getItem(SETUP_HIDDEN_KEY) === "1"; } catch { /* preferenza non letta */ }
      setLocal((p) => (p && p.ical === ical && p.hidden === hidden && p.guides.size === guides.size && [...guides].every((g) => p.guides.has(g)) ? p : { guides, ical, hidden }));
    };
    read();
    window.addEventListener("focus", read);
    window.addEventListener("spigolestay:datasync", read);
    return () => { window.removeEventListener("focus", read); window.removeEventListener("spigolestay:datasync", read); };
  }, []);
  // Senza strutture può essere un account davvero nuovo oppure i dati non sono ancora arrivati: si aspetta un attimo prima di proporre i passi.
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 1500); return () => clearTimeout(t); }, []);
  const { users: accessUsers, can, user: localUser } = useAccess();
  const setup = useMemo(() => buildSetupSteps({
    structures: scopeStructures.map((s) => {
      const types = roomTypes.filter((r) => r.structureId === s.id);
      return {
        id: s.id, name: s.name,
        profile: !!(s.city?.trim() && s.address?.trim() && (s.phone?.trim() || s.email?.trim() || s.whatsapp?.trim())),
        rooms: units.filter((u) => u.structureId === s.id).length,
        pricedTypes: types.filter((t) => t.basePrice > 0 || !!t.deriveFrom).length, totalTypes: types.length,
        guide: !!local?.guides.has(s.id),
      };
    }),
    channels: Object.values(dati.chConn).some(Boolean) || (local?.ical ?? 0) > 0 || bookings.some((b) => OTA_CH.includes(b.channel)),
    extraUsers: accessUsers.length > 1,
  }), [scopeStructures, roomTypes, units, local, dati.chConn, bookings, accessUsers]);
  const setupReady = !!local && dati.ready && dati.chReady && (scopeStructures.length > 0 || waited) && can("impostazioni") && can("camere");
  const showSetup = setupReady && !setup.complete && !local?.hidden;
  const setSetupHidden = (hidden: boolean) => {
    try { if (hidden) localStorage.setItem(SETUP_HIDDEN_KEY, "1"); else localStorage.removeItem(SETUP_HIDDEN_KEY); } catch { /* preferenza non salvata */ }
    setLocal((p) => (p ? { ...p, hidden } : p));
  };

  // --- Testi ---
  const { user: authUser } = useAuth();
  const authMd = authUser?.user_metadata as Record<string, unknown> | undefined; // il nome arriva da «full_name» (registrazione) o da «first_name» (configurazione guidata)
  const firstName = (localUser?.firstName?.trim() || (authMd?.first_name as string | undefined) || (authMd?.full_name as string | undefined) || "").trim().split(/\s+/)[0];
  const dateLabel = cap(`${parseISO(today).toLocaleDateString("it-IT", { weekday: "long" })} ${fmtDMY(today)}`);
  const subtitle = `${greetingFor(clock.hour)}${firstName ? " " + firstName : ""} · ${dateLabel}`;
  const several = allStructures.length > 1;
  const partial = several && (sFilter !== "all" || structures.length !== allStructures.length); // si guarda solo una parte delle strutture
  const scopeName = sFilter === "all" ? (structures.length === allStructures.length ? (several ? "Tutte le strutture" : structures[0]?.name ?? "") : `${structures.length} strutture`) : structMap.get(sFilter)?.name ?? "";
  // «Aggiorna»: un attimo di feedback visibile (i dati si ricaricano in sottofondo)
  const [busy, setBusy] = useState(false);
  const refresh = () => { dati.reload(); setBusy(true); setTimeout(() => setBusy(false), 900); };
  const updated = dati.updatedAt ? new Date(dati.updatedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : null;

  // --- Indicatori ---
  const arrN = split.arrivals.length, depN = split.departures.length, stayN = split.inHouse.length;
  const payItem = items.find((i) => i.key === "pay"), taxItem = items.find((i) => i.key === "tax");
  const free = tonight ? Math.max(0, tonight.total - tonight.occupied) : 0;
  const kpis: KpiItem[] = [
    { key: "arr", label: "Arrivi oggi", value: String(arrN), href: "/prenotazioni", sub: arrN === 0 ? "Nessun arrivo" : day.checkinTodo > 0 ? `${day.checkinTodo} check-in da fare` : "Check-in completati" },
    { key: "dep", label: "Partenze oggi", value: String(depN), href: "/prenotazioni", sub: depN === 0 ? "Nessuna partenza" : day.depDue > 0.005 ? `${eur(day.depDue)} da incassare` : split.turnoverUnits.size > 0 ? `${split.turnoverUnits.size} turnover` : "Tutte saldate" },
    { key: "stay", label: "In casa", value: String(stayN), href: "/prenotazioni", sub: stayN === 0 ? "Nessun ospite in casa" : ospiti(day.guestsIn) },
    { key: "occ", label: "Occupazione stanotte", value: tonight && tonight.total ? `${tonight.pct}%` : "–", href: "/calendario", sub: tonight && tonight.total ? `${tonight.occupied}/${tonight.total} camere · ${free} ${plural(free, "libera", "libere")}` : "Nessuna camera" },
    {
      key: "due", label: "Da incassare", value: eur(payItem?.amount ?? 0), long: true, href: "/pagamenti", loading: loadingAdem,
      sub: payItem ? `${payItem.count} ${plural(payItem.count, "saldo", "saldi")}${taxItem?.amount ? ` · tassa ${eur(taxItem.amount)}` : ""}` : taxItem?.amount ? `Tassa di soggiorno ${eur(taxItem.amount)}` : "Nessun saldo aperto",
    },
    {
      key: "ade", label: "Adempimenti", value: String(stato.total), href: "/adempimenti", loading: loadingAdem, tone: stato.urgent > 0 ? "err" : undefined,
      sub: stato.urgent > 0 ? `${stato.urgent} ${plural(stato.urgent, "urgente", "urgenti")}` : stato.total > 0 ? "Da fare oggi" : "Niente in scadenza",
    },
  ];

  return (
    <div className="w-full">
      <PageHeader
        title="Dashboard" subtitle={subtitle}
        actions={
          <>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-dim">
              <span>{several ? "Stai guardando:" : "Struttura:"} <b className="font-semibold text-txt">{scopeName || "nessuna"}</b></span>
              {partial && (
                <button type="button" onClick={() => setActiveStructure("all")} title="Con l'apertura su una sola struttura le altre si caricano quando le scegli (anche dal menu in alto)" className="rounded-[var(--r-md)] px-1.5 py-1 font-medium text-focus hover:bg-wash max-sm:min-h-10">Mostra tutte le strutture</button>
              )}
            </span>
            {setupReady && !setup.complete && local?.hidden && <button type="button" onClick={() => setSetupHidden(false)} className={BTN_SM}>Configurazione {setup.done}/{setup.total}</button>}
            <button type="button" onClick={refresh} aria-busy={busy} title="Rilegge adempimenti, invii e canali" className={`${BTN_SM} min-w-[7.5rem]`}>{busy ? "Aggiornamento…" : "Aggiorna"}</button>
            {updated && <span className="text-xs text-dim max-xl:hidden" role="status">Aggiornato alle {updated}</span>}
          </>
        }
      />
      <div className="flex flex-col gap-3">
        {showSetup && <Avvio state={setup} onHide={() => setSetupHidden(true)} />}
        <Kpis items={kpis} />
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] xl:items-start">
          <div className="flex min-w-0 flex-col gap-3">
            <DaFare rows={todo} loading={loadingAdem} health={health} setupPending={!setup.complete} />
            <Oggi rows={day.rows} onOpen={openBooking} onNew={() => openNewBooking()} noBookings={live.length === 0} noStructures={structures.length === 0} />
          </div>
          {/* sotto i 1280 px la colonna di destra passa su due colonne (occupazione | ricavi e canali); da xl sta accanto a Da fare e Oggi */}
          <div className="grid min-w-0 items-start gap-3 lg:grid-cols-2 xl:grid-cols-1">
            <Occupazione cells={strip} outlook={outlook} />
            <div className="flex min-w-0 flex-col gap-3">
              <Ricavi total={upcoming.total} count={upcoming.count} nights={upcoming.nights} onNew={structures.length ? () => openNewBooking() : undefined} />
              <Canali rows={channelRows} />
            </div>
          </div>
        </div>
        <Altri list={upcomingList} guests={guestMap} today={today} />
      </div>
    </div>
  );
}
