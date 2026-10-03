"use client";

// Calendario · Dettagliato: al posto della griglia camere × giorni, una vista a giorni che risponde a
// "chi arriva, chi resta, chi parte e cosa manca, camera per camera". Striscia di 7 giorni con contatori,
// tre colonne (Arrivi / In casa / Partenze) con le schede della vista dettagliata, camere libere e blocchi.
// Per le prenotazioni usa journeyOf/journeyBucket-style (booking-journey) e la finestra "Risolvi" (StepActions).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { inScope as inScopeOf, scopeFilter } from "@/lib/scope";
import { toISO, shiftISO, parseISO } from "@/lib/dates";
import { bookingPaidTotal } from "@/lib/booking";
import { eur } from "@/lib/format";
import { journeyOf, isLiveBooking, type JourneyStep } from "@/lib/booking-journey";
import type { Booking } from "@/lib/types";
import EmptyState from "@/components/EmptyState";
import StepActions from "@/app/(app)/prenotazioni/_azioni";
import SchedaGiorno, { type Avviso, type Journey } from "./_scheda";
import StriscaGiorni, { type Modo } from "./_giorni";
import { CameraLibera, BloccoRiga, FuoriServizioRiga } from "./_libere";
import { GUIDE_RE, readCleanDone, useDatiPercorso } from "./_dati";
import { blocksIn, daysBetween, dayStats, freeUnits, nightOf, occupies, turnoverIndex, turnoverLabel } from "./_modello";

type Row = { b: Booking; j: Journey };
type Col = "arr" | "stay" | "dep";

const dayShort = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
const dayLong = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function relDay(iso: string, today: string) {
  const diff = Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
  return diff === 0 ? "oggi" : diff === 1 ? "domani" : diff === -1 ? "ieri" : dayShort(iso);
}

function Vuoto({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center">
      <div className="text-sm font-medium text-dim">{title}</div>
      {sub && <div className="mx-auto mt-1 max-w-xs text-xs text-faint">{sub}</div>}
    </div>
  );
}

export default function CalendarioDettaglio() {
  const router = useRouter();
  const { bookings, guests, units, roomTypes, structures, events, getStructure, openBooking, openNewBooking, activeStructureId } = useData();
  const dati = useDatiPercorso();
  const { schedBy, istatBy, docBy, threads, rems, reload } = dati;

  const today = toISO(new Date());
  const [sel, setSel] = useState(today);
  const [winStart, setWinStart] = useState(today);
  const [mode, setMode] = useState<Modo>("day");
  const [modal, setModal] = useState<{ id: string; key: string } | null>(null);
  // Colonne lunghe: mostra le prime 6 schede, poi "Mostra tutte" (e, aperta, scorre dentro la colonna invece di allungare la pagina).
  const [openCols, setOpenCols] = useState<Record<string, boolean>>({});
  const COL_LIMIT = 6;
  const [cleanDone, setCleanDone] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const h = () => setCleanDone(readCleanDone());
    h();
    window.addEventListener("focus", h);
    return () => window.removeEventListener("focus", h);
  }, []);

  // ── Ambito: solo la struttura attiva (o tutte) ──
  const inS = useCallback((sid: string) => inScopeOf(sid, activeStructureId), [activeStructureId]);
  const showStructure = activeStructureId === "all" && structures.length > 1;
  const scopedUnits = useMemo(() => {
    const order = new Map(structures.map((s, i) => [s.id, i]));
    return units.filter((u) => inS(u.structureId)).sort((a, b) => (order.get(a.structureId) ?? 0) - (order.get(b.structureId) ?? 0) || (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, "it", { numeric: true }));
  }, [units, structures, inS]);
  const activeUnits = useMemo(() => scopedUnits.filter((u) => !u.outOfService), [scopedUnits]);
  const outUnits = useMemo(() => scopedUnits.filter((u) => u.outOfService), [scopedUnits]);
  const unitPos = useMemo(() => new Map(scopedUnits.map((u, i) => [u.id, i])), [scopedUnits]);
  const busy = useMemo(() => bookings.filter((b) => occupies(b) && inS(b.structureId)), [bookings, inS]);
  const live = useMemo(() => busy.filter(isLiveBooking), [busy]);
  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const typeById = useMemo(() => new Map(roomTypes.map((r) => [r.id, r])), [roomTypes]);
  const turn = useMemo(() => turnoverIndex(live), [live]);

  // ── Periodo mostrato ──
  const winDays = useMemo(() => daysBetween(winStart, shiftISO(winStart, 6)), [winStart]);
  const from = mode === "day" ? sel : winDays[0];
  const to = mode === "day" ? sel : winDays[6];
  const stripDays = useMemo(() => winDays.map((iso) => ({ iso, stats: dayStats(iso, live, busy, activeUnits, cleanDone) })), [winDays, live, busy, activeUnits, cleanDone]);

  const guestName = useCallback((b: Booking) => {
    const g = guestById.get(b.guestId);
    return g?.fullName || [b.primaryGuest?.firstName, b.primaryGuest?.lastName].filter(Boolean).join(" ") || "Ospite";
  }, [guestById]);

  // ── Prenotazioni del periodo con il loro percorso ──
  const rows = useMemo(() => {
    const out = new Map<string, Row>();
    for (const b of live) {
      if (b.checkOut < from || b.checkIn > to) continue;
      const j = journeyOf(b, {
        today, guest: guestById.get(b.guestId), structure: getStructure(b.structureId),
        schedina: schedBy.get(b.id) ?? "none", istat: istatBy.get(b.id) ?? "none",
        guideSent: !!rems[b.id]?.guide || (threads[b.guestId] ?? []).some((m) => m.dir === "out" && GUIDE_RE.test(m.text)),
        invoiceStato: docBy.get(b.id),
      });
      out.set(b.id, { b, j });
    }
    return out;
  }, [live, from, to, today, guestById, getStructure, schedBy, istatBy, rems, threads, docBy]);

  const cols = useMemo(() => {
    const pos = (b: Booking) => (b.unitId ? unitPos.get(b.unitId) ?? 9999 : 10000);
    const eta = (b: Booking) => (/^\d{1,2}:\d{2}$/.test(b.arrivalTime ?? "") ? b.arrivalTime!.padStart(5, "0") : "99:99");
    const all = [...rows.values()];
    const arr = all.filter((r) => r.b.checkIn >= from && r.b.checkIn <= to).sort((a, b) => a.b.checkIn.localeCompare(b.b.checkIn) || eta(a.b).localeCompare(eta(b.b)) || pos(a.b) - pos(b.b));
    const dep = all.filter((r) => r.b.checkOut >= from && r.b.checkOut <= to).sort((a, b) => a.b.checkOut.localeCompare(b.b.checkOut) || pos(a.b) - pos(b.b));
    const stay = all.filter((r) => r.b.checkIn < from && r.b.checkOut > to).sort((a, b) => pos(a.b) - pos(b.b) || a.b.checkOut.localeCompare(b.b.checkOut));
    return { arr, stay, dep };
  }, [rows, from, to, unitPos]);

  // ── Avvisi per scheda ──
  const avvisiFor = useCallback((r: Row, col: Col): Avviso[] => {
    const { b, j } = r;
    const out: Avviso[] = [];
    const unit = b.unitId ? unitById.get(b.unitId) : undefined;
    if (!b.unitId) out.push({ key: "nounit", label: "Camera da assegnare", tone: b.checkIn <= shiftISO(today, 3) ? "err" : "warn", title: "La prenotazione non ha ancora una camera fisica" });
    else if (unit?.outOfService) out.push({ key: "oos", label: "Camera fuori servizio: serve un'altra camera", tone: "err" });
    if (col === "arr" && j.steps.find((s) => s.key === "checkin")?.state !== "done") {
      out.push({ key: "nocheckin", label: b.checkIn <= today ? "Arrivo senza check-in online" : "Check-in online non ancora fatto", tone: b.checkIn <= today ? "err" : "warn" });
    }
    const t = col === "arr" ? turn.arr.get(b.id) : col === "dep" ? turn.dep.get(b.id) : undefined;
    if (t) { const l = turnoverLabel(t, getStructure); out.push({ key: "turnover", label: l.label, tone: "warn", title: l.title }); }
    if (col === "dep") {
      const resid = Math.max(0, bookingPaidTotal(b) - (b.paid ?? 0));
      if (resid > 0.005) out.push({ key: "saldo", label: `Parte con saldo aperto: ${eur(resid)}`, tone: b.checkOut <= today ? "err" : "warn" });
    }
    return out;
  }, [unitById, today, turn, getStructure]);

  // ── Camere libere e blocchi ──
  const free = useMemo(() => freeUnits(activeUnits, busy, from, to), [activeUnits, busy, from, to]);
  const blocks = useMemo(() => blocksIn(busy, scopedUnits, from, to), [busy, scopedUnits, from, to]);
  const unassignedNow = useMemo(() => mode === "day" ? live.filter((b) => !b.unitId && nightOf(b, sel)).length : 0, [live, mode, sel]);

  // Eventi segnalati nel periodo (sagre, ponti…): come nel calendario a griglia, solo per la struttura attiva.
  const evs = useMemo(() => scopeFilter(events, activeStructureId).filter((e) => e.from <= to && e.to > from), [events, activeStructureId, from, to]);

  // ── Riepilogo anomalie del periodo (sulle schede mostrate) ──
  const summary = useMemo(() => {
    const all = new Map([...cols.arr, ...cols.stay, ...cols.dep].map((r) => [r.b.id, r]));
    const noUnit = [...all.values()].filter((r) => !r.b.unitId).length;
    const noCheckin = cols.arr.filter((r) => r.j.steps.find((s) => s.key === "checkin")?.state !== "done").length;
    const turnovers = cols.arr.filter((r) => turn.arr.has(r.b.id)).length;
    const saldo = cols.dep.filter((r) => bookingPaidTotal(r.b) - (r.b.paid ?? 0) > 0.005).length;
    const late = [...all.values()].filter((r) => r.j.steps.some((s) => s.state === "late")).length;
    return { noUnit, noCheckin, turnovers, saldo, late };
  }, [cols, turn]);

  const openStep = (r: Row, s: JourneyStep) => {
    if (s.state !== "done" && s.state !== "na") setModal({ id: r.b.id, key: s.key });
    else if (s.href) router.push(s.href);
  };
  const modalRow = modal ? rows.get(modal.id) : undefined;
  const modalStep = modalRow?.j.steps.find((x) => x.key === modal?.key);

  const rangeLabel = mode === "day" ? cap(dayLong(sel)) : `${dayShort(winDays[0])} – ${dayShort(winDays[6])}`;
  const week = mode === "week";

  // ── Navigazione ──
  const shift = (dir: -1 | 1) => { setWinStart((w) => shiftISO(w, 7 * dir)); setSel((s) => shiftISO(s, 7 * dir)); };
  const goToday = () => { setSel(today); setWinStart(today); };
  const pick = (iso: string) => { setSel(iso); setWinStart(iso); setMode("day"); };
  const selectDay = (iso: string) => { setSel(iso); setMode("day"); };

  const COLS: { key: Col; title: string; tone: string; sub: string; empty: string; emptySub: string; list: Row[] }[] = [
    { key: "arr", title: "Arrivi", tone: "var(--ok)", sub: week ? "Check-in del periodo" : "Check-in del giorno", empty: week ? "Nessun arrivo in questi 7 giorni" : "Nessun arrivo", emptySub: "Nessun ospite fa il check-in in questo periodo.", list: cols.arr },
    { key: "stay", title: "In casa", tone: "var(--focus)", sub: week ? "Restano per tutto il periodo" : "Restano la notte, né arrivano né partono", empty: week ? "Nessun ospite resta tutto il periodo" : "Nessun ospite si ferma", emptySub: week ? "Chi arriva o parte nei 7 giorni è nelle altre colonne." : "Chi arriva o parte è nelle altre colonne.", list: cols.stay },
    { key: "dep", title: "Partenze", tone: "var(--warn)", sub: week ? "Check-out del periodo" : "Check-out del giorno", empty: week ? "Nessuna partenza in questi 7 giorni" : "Nessuna partenza", emptySub: "Nessun ospite lascia la camera in questo periodo.", list: cols.dep },
  ];

  const tagFor = (r: Row, col: Col): { tag: string; tone: string } => {
    const { b } = r;
    if (col === "arr") return { tag: `Arriva ${relDay(b.checkIn, today)}`, tone: "var(--ok)" };
    if (col === "dep") return { tag: `Parte ${relDay(b.checkOut, today)}`, tone: "var(--warn)" };
    if (week) return { tag: `Fino a ${dayShort(b.checkOut)}`, tone: "var(--dim)" };
    const k = Math.round((Date.parse(sel) - Date.parse(b.checkIn)) / 86400000) + 1;
    const n = Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86400000);
    return { tag: `In casa · notte ${k} di ${n}`, tone: "var(--focus)" };
  };

  const freeTitle = week ? "Camere libere nel periodo" : sel === today ? "Camere libere stasera" : `Camere libere la notte di ${dayShort(sel)}`;
  const nothingAtAll = !scopedUnits.length && !live.length;

  const pill = (n: number, label: string, tone: "err" | "warn") => n > 0 ? (
    <span key={label} className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ color: tone === "err" ? "var(--err)" : "var(--warn)", background: `color-mix(in srgb, ${tone === "err" ? "var(--err)" : "var(--warn)"} 13%, transparent)` }}>{n} {label}</span>
  ) : null;
  const pills = [
    pill(summary.noUnit, summary.noUnit === 1 ? "prenotazione senza camera" : "prenotazioni senza camera", "err"),
    pill(summary.noCheckin, summary.noCheckin === 1 ? "arrivo senza check-in" : "arrivi senza check-in", "warn"),
    pill(summary.turnovers, summary.turnovers === 1 ? "turnover" : "turnover", "warn"),
    pill(summary.saldo, summary.saldo === 1 ? "partenza con saldo aperto" : "partenze con saldo aperto", "warn"),
    pill(summary.late, summary.late === 1 ? "prenotazione con passaggi in ritardo" : "prenotazioni con passaggi in ritardo", "err"),
  ].filter(Boolean);

  if (nothingAtAll) return <div className="rounded-xl border border-line bg-surface"><EmptyState title="Nessuna camera né prenotazione da mostrare" sub="Aggiungi le camere della struttura e le prime prenotazioni: qui vedrai arrivi, soggiorni e partenze giorno per giorno." /></div>;

  return (
    <div>
      <StriscaGiorni days={stripDays} sel={sel} mode={mode} today={today} rangeLabel={rangeLabel} onSelect={selectDay} onShift={shift} onToday={goToday} onMode={setMode} onPick={pick} />

      {/* Eventi e riepilogo del periodo */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {evs.map((e) => (
          <span key={e.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-txt" title={`${dayShort(e.from)} → ${dayShort(shiftISO(e.to, -1))}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />{e.name}
          </span>
        ))}
        {pills.length > 0 ? pills : <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ color: "var(--ok)", background: "color-mix(in srgb, var(--ok) 13%, transparent)" }}>Nessuna anomalia in questo periodo ✓</span>}
      </div>

      {/* Arrivi / In casa / Partenze */}
      <div className="mt-5 flex flex-col gap-8">
        {COLS.map((c) => {
          // In modalità 7 giorni arrivi e partenze sono raggruppati per giorno.
          const groups: { day: string; items: Row[] }[] = [];
          if (week && c.key !== "stay") {
            for (const r of c.list) { const d = c.key === "arr" ? r.b.checkIn : r.b.checkOut; const g = groups[groups.length - 1]; if (g && g.day === d) g.items.push(r); else groups.push({ day: d, items: [r] }); }
          } else groups.push({ day: "", items: c.list });
          const card = (r: Row) => {
            const unit = r.b.unitId ? unitById.get(r.b.unitId) : undefined;
            const t = tagFor(r, c.key);
            return (
              <SchedaGiorno
                key={r.b.id} b={r.b} j={r.j} guestName={guestName(r.b)}
                unit={unit} roomType={typeById.get(unit?.roomTypeId ?? r.b.roomTypeId)}
                structure={getStructure(r.b.structureId)} showStructure={showStructure}
                tag={t.tag} tagTone={t.tone} avvisi={avvisiFor(r, c.key)}
                onOpen={() => openBooking(r.b.id)} onStep={(s) => openStep(r, s)}
              />
            );
          };
          return (
            <section key={c.key} className="min-w-0">
              <div className="mb-3">
                <h2 className="flex items-center gap-2 font-display text-lg font-bold text-txt">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.tone }} />
                  {c.title}
                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: c.tone, background: `color-mix(in srgb, ${c.tone} 14%, transparent)` }}>{c.list.length}</span>
                </h2>
                <p className="text-xs text-faint">{c.sub}</p>
              </div>
              {c.list.length === 0 ? <Vuoto title={c.empty} sub={c.emptySub} /> : (
                <div className={`flex flex-col gap-3 `}>
                  {groups.map((g) => {
                    if (!openCols[c.key]) { const before = groups.slice(0, groups.indexOf(g)).reduce((a, x) => a + x.items.length, 0); if (before >= COL_LIMIT) return null; g = { ...g, items: g.items.slice(0, COL_LIMIT - before) }; }
                    return (
                    <div key={g.day || "all"} className="flex flex-col gap-3">
                      {g.day && <div className="text-xs font-bold uppercase tracking-wide text-faint">{dayShort(g.day)}{g.day === today ? " · oggi" : ""}</div>}
                      <div className="flex flex-col gap-3">{g.items.map(card)}</div>
                    </div>
                    );
                  })}
                  {c.list.length > COL_LIMIT && (
                    <button onClick={() => setOpenCols((o) => ({ ...o, [c.key]: !o[c.key] }))} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-focus transition hover:border-focus">
                      {openCols[c.key] ? "Mostra meno" : `Mostra tutte le ${c.list.length}`}
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Camere libere */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-txt">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--dim)" }} />
            {freeTitle}
            <span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold text-dim">{week ? free.length : `${stripDays.find((d) => d.iso === sel)?.stats.free ?? free.length}/${activeUnits.length}`}</span>
          </h2>
          <span className="text-xs text-faint">{week ? "Camere con almeno una notte libera" : "Nessuna prenotazione né blocco in questa notte"}</span>
        </div>
        {unassignedNow > 0 && (
          <div className="mb-3 rounded-lg px-3 py-2 text-xs font-medium" style={{ color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 12%, transparent)" }}>
            {unassignedNow} {unassignedNow === 1 ? "prenotazione senza camera occupa" : "prenotazioni senza camera occupano"} una delle camere libere qui sotto: il numero accanto al titolo la sottrae già.
          </div>
        )}
        {!activeUnits.length ? <Vuoto title="Nessuna camera in servizio" sub="Aggiungi le camere dalla pagina Camere." /> : free.length === 0 ? <Vuoto title={week ? "Nessuna camera libera in questi 7 giorni" : "Tutte le camere sono occupate"} sub={week ? undefined : "Nessuna camera libera in questa notte."} /> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {free.map((f) => (
              <CameraLibera
                key={f.unit.id} f={f} roomType={typeById.get(f.unit.roomTypeId)} structure={getStructure(f.unit.structureId)}
                showStructure={showStructure} guestName={guestName} weekMode={week}
                onNew={() => openNewBooking({ structureId: f.unit.structureId, roomTypeId: f.unit.roomTypeId, unitId: f.unit.id, checkIn: f.firstFree, checkOut: shiftISO(f.firstFree, 1) })}
              />
            ))}
          </div>
        )}
      </section>

      {/* Fuori servizio e blocchi */}
      {(outUnits.length > 0 || blocks.length > 0) && (
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-txt">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--err)" }} />
              Fuori servizio e blocchi
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: "var(--err)", background: "color-mix(in srgb, var(--err) 14%, transparent)" }}>{outUnits.length + blocks.length}</span>
            </h2>
            <span className="text-xs text-faint">Camere non vendibili {week ? "nel periodo" : "in questo giorno"}</span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {outUnits.map((u) => <FuoriServizioRiga key={u.id} unit={u} roomType={typeById.get(u.roomTypeId)} structure={getStructure(u.structureId)} showStructure={showStructure} />)}
            {blocks.map((b) => {
              const u = b.unitId ? unitById.get(b.unitId) : undefined;
              return <BloccoRiga key={b.id} b={b} unit={u} roomType={typeById.get(u?.roomTypeId ?? b.roomTypeId)} structure={getStructure(b.structureId)} showStructure={showStructure} onOpen={() => openBooking(b.id)} />;
            })}
          </div>
        </section>
      )}

      {modal && modalRow && modalStep && (
        <StepActions
          key={`${modal.id}:${modal.key}`}
          b={modalRow.b} step={modalStep}
          guest={guestById.get(modalRow.b.guestId)} structure={getStructure(modalRow.b.structureId)}
          checkinDone={modalRow.j.steps.find((x) => x.key === "checkin")?.state === "done"}
          schedina={schedBy.get(modalRow.b.id) ?? "none"} istat={istatBy.get(modalRow.b.id) ?? "none"}
          paySentInChat={(threads[modalRow.b.guestId] ?? []).some((m) => m.dir === "out" && m.text.includes("chat-pay/go"))}
          onClose={() => setModal(null)} onSwitch={(key) => setModal({ id: modal.id, key })} onChanged={() => { void reload(); }}
        />
      )}
    </div>
  );
}
