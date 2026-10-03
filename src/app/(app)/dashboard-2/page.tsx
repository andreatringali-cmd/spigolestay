"use client";

// Dashboard 2: "cosa devo fare oggi", per la struttura selezionata. In alto saluto e numeri essenziali,
// poi schede (stesse di "Prenotazioni · Dettagliata") in ordine di urgenza: in ritardo, arrivi di oggi,
// in casa, partenze di oggi, prossimi arrivi. Il click su un passaggio apre la finestra "Risolvi".
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";
import { toISO, addDays, parseISO } from "@/lib/dates";
import { bookingPaidTotal } from "@/lib/booking";
import { eur } from "@/lib/format";
import { journeyOf, isLiveBooking, type JourneyStep } from "@/lib/booking-journey";
import { readReminders } from "@/lib/guest-messages";
import type { Booking } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import WeatherWidget from "@/components/WeatherWidget";
import StepActions from "@/app/(app)/prenotazioni/_azioni";
import Scheda, { type Journey } from "./_scheda";

type StatoRow = { booking_id: string | null; stato: string };

const GUIDE_RE = /guest-guide|\/guida|guida ospiti/i;
// Le prenotazioni già partite compaiono tra i ritardi solo se la partenza è recente: lo storico lontano resterebbe "in ritardo" per sempre.
const LATE_WINDOW_DAYS = 30;
const UPCOMING_DAYS = 7;
const PAGE = 6; // schede mostrate per sezione prima di "Mostra altre"

type Row = { b: Booking; j: Journey };
type SectionKey = "late" | "arrive" | "inhouse" | "leave" | "next";

export default function Dashboard2() {
  const router = useRouter();
  const { user } = useAuth();
  const { bookings, guests, units, roomTypes, structures, getStructure, openBooking, activeStructureId } = useData();
  const today = toISO(new Date());
  const [sched, setSched] = useState<StatoRow[]>([]);
  const [istat, setIstat] = useState<StatoRow[]>([]);
  const [docs, setDocs] = useState<StatoRow[]>([]);
  const [threads, setThreads] = useState<Record<string, { dir: string; text: string }[]>>({});
  const [rems, setRems] = useState<Record<string, Record<string, number>>>({});
  const [modal, setModal] = useState<{ id: string; key: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // Stessa logica di caricamento di "Prenotazioni · Dettagliata".
  const load = useCallback(async () => {
    try { setThreads(JSON.parse(localStorage.getItem("spigolestay:threads:v1") || "{}")); } catch { setThreads({}); }
    setRems(readReminders());
    if (!supabase) return;
    const [a, i, d] = await Promise.all([
      supabase.from("alloggiati_schedine").select("booking_id, stato"),
      supabase.from("istat_rows").select("booking_id, stato"),
      supabase.from("documents").select("booking_id, stato").not("booking_id", "is", null),
    ]);
    setSched((a.data ?? []) as StatoRow[]); setIstat((i.data ?? []) as StatoRow[]); setDocs((d.data ?? []) as StatoRow[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const h = () => { void load(); };
    window.addEventListener("focus", h);
    window.addEventListener("spigolestay:datasync", h);
    window.addEventListener("spigolestay:reminders", h);
    window.addEventListener("spigolestay:threads", h);
    return () => { window.removeEventListener("focus", h); window.removeEventListener("spigolestay:datasync", h); window.removeEventListener("spigolestay:reminders", h); window.removeEventListener("spigolestay:threads", h); };
  }, [load]);

  const schedBy = useMemo(() => {
    const m = new Map<string, "da_validare" | "pronta" | "inviata">();
    const rank = { da_validare: 3, pronta: 2, inviata: 1 } as const;
    for (const s of sched) {
      if (!s.booking_id || !(s.stato in rank)) continue;
      const st = s.stato as keyof typeof rank;
      const cur = m.get(s.booking_id);
      if (!cur || rank[st] > rank[cur]) m.set(s.booking_id, st);
    }
    return m;
  }, [sched]);
  const istatBy = useMemo(() => {
    const m = new Map<string, "pending" | "sent">();
    for (const r of istat) {
      if (!r.booking_id || (r.stato !== "pending" && r.stato !== "sent")) continue;
      if (m.get(r.booking_id) !== "pending") m.set(r.booking_id, r.stato);
    }
    return m;
  }, [istat]);
  const docBy = useMemo(() => { const m = new Map<string, string>(); for (const d of docs) if (d.booking_id && d.stato !== "bozza" && d.stato !== "scartata") m.set(d.booking_id, d.stato); return m; }, [docs]);

  // Struttura selezionata: solo prenotazioni vere (niente bloccate/annullate/no-show) e solo camere in scope.
  const inScope = useCallback((sid: string) => activeStructureId === "all" || sid === activeStructureId, [activeStructureId]);
  const scopedStructures = useMemo(() => structures.filter((s) => inScope(s.id)), [structures, inScope]);
  const scopedUnits = useMemo(() => units.filter((u) => inScope(u.structureId) && !u.outOfService), [units, inScope]);
  const live = useMemo(() => bookings.filter((b) => isLiveBooking(b) && inScope(b.structureId)), [bookings, inScope]);

  const lateFrom = toISO(addDays(parseISO(today), -LATE_WINDOW_DAYS));
  const upTo = toISO(addDays(parseISO(today), UPCOMING_DAYS));

  const rows: Row[] = useMemo(() => live.filter((b) => b.checkOut >= lateFrom && b.checkIn <= upTo).map((b) => {
    const guest = guests.find((g) => g.id === b.guestId);
    const j = journeyOf(b, {
      today, guest, structure: getStructure(b.structureId),
      schedina: schedBy.get(b.id) ?? "none", istat: istatBy.get(b.id) ?? "none",
      guideSent: !!rems[b.id]?.guide || (threads[b.guestId] ?? []).some((m) => m.dir === "out" && GUIDE_RE.test(m.text)),
      invoiceStato: docBy.get(b.id),
    });
    return { b, j };
  }), [live, lateFrom, upTo, guests, getStructure, today, schedBy, istatBy, threads, docBy, rems]);

  // Sezioni per urgenza. Una prenotazione compare una sola volta: se ha passaggi in ritardo sta in "In ritardo".
  const sections = useMemo(() => {
    const byIn = (a: Row, b: Row) => a.b.checkIn.localeCompare(b.b.checkIn) || a.b.checkOut.localeCompare(b.b.checkOut);
    const hasLate = (r: Row) => r.j.steps.some((s) => s.state === "late");
    const late = rows.filter(hasLate).sort((a, b) => a.b.checkOut.localeCompare(b.b.checkOut) || byIn(a, b));
    const lateIds = new Set(late.map((r) => r.b.id));
    const rest = rows.filter((r) => !lateIds.has(r.b.id));
    const pick = (f: (b: Booking) => boolean) => rest.filter((r) => f(r.b)).sort(byIn);
    const all = (f: (b: Booking) => boolean) => rows.filter((r) => f(r.b)).length;
    return {
      late,
      arrive: pick((b) => b.checkIn === today),
      inhouse: pick((b) => b.checkIn < today && today < b.checkOut),
      leave: pick((b) => b.checkOut === today && b.checkIn < today),
      next: pick((b) => b.checkIn > today && b.checkIn <= upTo),
      // Quanti di ciascun movimento sono già finiti in "In ritardo" (per non far sembrare la sezione vuota).
      moved: {
        arrive: all((b) => b.checkIn === today) - pick((b) => b.checkIn === today).length,
        inhouse: all((b) => b.checkIn < today && today < b.checkOut) - pick((b) => b.checkIn < today && today < b.checkOut).length,
        leave: all((b) => b.checkOut === today && b.checkIn < today) - pick((b) => b.checkOut === today && b.checkIn < today).length,
        next: all((b) => b.checkIn > today && b.checkIn <= upTo) - pick((b) => b.checkIn > today && b.checkIn <= upTo).length,
      },
    };
  }, [rows, today, upTo]);

  // Numeri essenziali (calcolati su tutte le prenotazioni in scope, non sulle sezioni deduplicate).
  const kpi = useMemo(() => {
    const arrivals = live.filter((b) => b.checkIn === today).length;
    const departures = live.filter((b) => b.checkOut === today).length;
    const inHouse = live.filter((b) => b.checkIn < today && today < b.checkOut).length;
    // Camere libere stasera: camere in servizio meno quelle con una notte occupata (anche da blocchi) o prenotazioni senza camera.
    const busyUnits = new Set(bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show" && b.unitId && inScope(b.structureId) && b.checkIn <= today && today < b.checkOut).map((b) => b.unitId as string));
    const unassigned = live.filter((b) => !b.unitId && b.checkIn <= today && today < b.checkOut).length;
    const busy = scopedUnits.filter((u) => busyUnits.has(u.id)).length + unassigned;
    const free = Math.max(0, scopedUnits.length - busy);
    let due = 0, dueN = 0;
    for (const r of rows) { const d = Math.max(0, bookingPaidTotal(r.b) - (r.b.paid ?? 0)); if (d > 0.005) { due += d; dueN++; } }
    const lateSteps = sections.late.reduce((a, r) => a + r.j.steps.filter((s) => s.state === "late").length, 0);
    return { arrivals, departures, inHouse, free, total: scopedUnits.length, due, dueN, lateSteps, lateBookings: sections.late.length };
  }, [live, bookings, today, inScope, scopedUnits, rows, sections.late]);

  const guestName = (b: Booking) => {
    const g = guests.find((x) => x.id === b.guestId);
    return g?.fullName || [b.primaryGuest?.firstName, b.primaryGuest?.lastName].filter(Boolean).join(" ") || "Ospite";
  };

  const openStep = (r: Row, s: JourneyStep) => {
    if (s.state !== "done" && s.state !== "na") setModal({ id: r.b.id, key: s.key });
    else if (s.href) router.push(s.href);
  };
  const modalRow = modal ? rows.find((r) => r.b.id === modal.id) : undefined;
  const modalStep = modalRow?.j.steps.find((x) => x.key === modal?.key);

  const goTo = (k: SectionKey) => sectionRefs.current[k]?.scrollIntoView({ behavior: "smooth", block: "start" });

  const hour = new Date().getHours();
  const hello = hour < 13 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera";
  const fullName = (user?.user_metadata?.full_name as string | undefined) || (user?.user_metadata?.name as string | undefined) || "";
  const first = fullName.trim().split(/\s+/)[0];
  const scopeName = activeStructureId === "all" ? (structures.length > 1 ? "Tutte le strutture" : scopedStructures[0]?.name ?? "") : getStructure(activeStructureId)?.name ?? "";
  const showStructure = activeStructureId === "all" && structures.length > 1;
  const dateLabel = parseISO(today).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const SECTIONS: { key: SectionKey; title: string; tone: string; empty: string; sub: string }[] = [
    { key: "late", title: "In ritardo", tone: "var(--err)", empty: "Nessuna prenotazione in ritardo. Tutto in regola.", sub: `Almeno un passaggio scaduto · partenze degli ultimi ${LATE_WINDOW_DAYS} giorni incluse` },
    { key: "arrive", title: "Arrivano oggi", tone: "var(--ok)", empty: "Nessun arrivo oggi", sub: "Check-in della giornata" },
    { key: "inhouse", title: "In casa adesso", tone: "var(--focus)", empty: "Nessun ospite in casa adesso", sub: "Soggiorni in corso, arrivati prima di oggi" },
    { key: "leave", title: "Partono oggi", tone: "var(--warn)", empty: "Nessuna partenza oggi", sub: "Check-out della giornata" },
    { key: "next", title: `Prossimi arrivi · ${UPCOMING_DAYS} giorni`, tone: "var(--dim)", empty: `Nessun arrivo nei prossimi ${UPCOMING_DAYS} giorni`, sub: "Da preparare con anticipo" },
  ];

  return (
    <div>
      <PageHeader
        title={`${hello}${first ? `, ${first}` : ""}`}
        subtitle={`${dateLabel.charAt(0).toUpperCase()}${dateLabel.slice(1)}${scopeName ? ` · ${scopeName}` : ""}`}
        actions={<WeatherWidget compact />}
      />

      {/* Numeri essenziali */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Arrivi oggi" value={String(kpi.arrivals)} color="var(--ok)" onClick={() => goTo("arrive")} />
        <Tile label="Partenze oggi" value={String(kpi.departures)} color="var(--warn)" onClick={() => goTo("leave")} />
        <Tile label="In casa" value={String(kpi.inHouse)} color="var(--focus)" onClick={() => goTo("inhouse")} />
        <Tile label="Camere libere stasera" value={kpi.total ? `${kpi.free}/${kpi.total}` : "—"} color="var(--txt)" href="/calendario" />
        <Tile label="Da incassare" value={eur(kpi.due)} color={kpi.due > 0 ? "var(--warn)" : "var(--ok)"} hint={kpi.dueN ? `${kpi.dueN} ${kpi.dueN === 1 ? "prenotazione" : "prenotazioni"}` : "Tutto saldato"} href="/pagamenti" />
        <Tile label="Adempimenti in ritardo" value={String(kpi.lateSteps)} color={kpi.lateSteps > 0 ? "var(--err)" : "var(--ok)"} hint={kpi.lateBookings ? `in ${kpi.lateBookings} ${kpi.lateBookings === 1 ? "prenotazione" : "prenotazioni"}` : "Nessuno"} onClick={() => goTo("late")} />
      </div>

      {/* Salto rapido alle sezioni, con contatori */}
      <div className="no-print mt-4 flex flex-wrap items-center gap-1.5">
        {SECTIONS.map((s) => {
          const n = sections[s.key].length;
          return (
            <button key={s.key} onClick={() => goTo(s.key)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-dim transition hover:border-focus hover:text-focus">
              {s.title.split(" · ")[0]}
              <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]" style={n > 0 ? { color: s.tone, background: `color-mix(in srgb, ${s.tone} 14%, transparent)` } : undefined}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Sezioni */}
      {SECTIONS.map((s) => {
        const list = sections[s.key];
        const open = expanded[s.key];
        const shown = open ? list : list.slice(0, PAGE);
        const moved = s.key === "late" ? 0 : sections.moved[s.key];
        return (
          <section key={s.key} ref={(el) => { sectionRefs.current[s.key] = el; }} className="mt-7 scroll-mt-4">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 className="flex items-center gap-2 font-display text-lg font-bold text-txt">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.tone }} />
                {s.title}
                <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: s.tone, background: `color-mix(in srgb, ${s.tone} 14%, transparent)` }}>{list.length}</span>
              </h2>
              <span className="text-xs text-faint">{s.sub}</span>
              {moved > 0 && <button onClick={() => goTo("late")} className="text-xs font-semibold text-[color:var(--err)] hover:underline">+{moved} già in “In ritardo” ↑</button>}
            </div>
            {list.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface"><EmptyState title={s.empty} sub={moved > 0 ? `${moved} ${moved === 1 ? "prenotazione è" : "prenotazioni sono"} già nella sezione “In ritardo”.` : undefined} /></div>
            ) : (
              <div className="flex flex-col gap-3">
                {shown.map((r) => {
                  const unit = units.find((u) => u.id === r.b.unitId);
                  return (
                    <Scheda
                      key={r.b.id} b={r.b} j={r.j} today={today} guestName={guestName(r.b)}
                      unit={unit} roomType={roomTypes.find((x) => x.id === (unit?.roomTypeId ?? r.b.roomTypeId))}
                      structure={getStructure(r.b.structureId)} showStructure={showStructure}
                      onOpen={() => openBooking(r.b.id)} onStep={(st) => openStep(r, st)}
                    />
                  );
                })}
                {list.length > PAGE && (
                  <button onClick={() => setExpanded((e) => ({ ...e, [s.key]: !open }))} className="self-center rounded-full border border-line bg-surface px-4 py-1.5 text-xs font-semibold text-dim transition hover:border-focus hover:text-focus">
                    {open ? "Mostra meno" : `Mostra altre ${list.length - PAGE}`}
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}

      <p className="mt-8 text-center text-xs text-faint">Per l&apos;elenco completo e i filtri vai a <Link href="/prenotazioni" className="font-semibold text-focus hover:underline">Prenotazioni · Dettagliata</Link>.</p>

      {modal && modalRow && modalStep && (
        <StepActions
          key={`${modal.id}:${modal.key}`}
          b={modalRow.b} step={modalStep}
          guest={guests.find((g) => g.id === modalRow.b.guestId)} structure={getStructure(modalRow.b.structureId)}
          checkinDone={modalRow.j.steps.find((x) => x.key === "checkin")?.state === "done"}
          schedina={schedBy.get(modalRow.b.id) ?? "none"} istat={istatBy.get(modalRow.b.id) ?? "none"}
          paySentInChat={(threads[modalRow.b.guestId] ?? []).some((m) => m.dir === "out" && m.text.includes("chat-pay/go"))}
          onClose={() => setModal(null)} onSwitch={(key) => setModal({ id: modal.id, key })} onChanged={() => { void load(); }}
        />
      )}
    </div>
  );
}

// Tessera numerica: cliccabile (scorre alla sezione o apre una pagina).
function Tile({ label, value, color, hint, onClick, href }: { label: string; value: string; color: string; hint?: string; onClick?: () => void; href?: string }) {
  const cls = `flex min-h-[78px] min-w-0 flex-col justify-center rounded-xl border border-line bg-surface p-3 text-left shadow-sm ${onClick || href ? "cursor-pointer transition hover:-translate-y-0.5 hover:border-focus hover:shadow-md" : ""}`;
  const inner = (<>
    <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</div>
    <div className="mt-0.5 truncate font-mono text-xl font-bold tabular-nums" style={{ color }}>{value}</div>
    {hint && <div className="truncate text-[11px] text-faint">{hint}</div>}
  </>);
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  return onClick ? <button type="button" onClick={onClick} className={cls}>{inner}</button> : <div className={cls}>{inner}</div>;
}
