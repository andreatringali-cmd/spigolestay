"use client";

// Adempimenti 2: il centro di controllo degli adempimenti. In cima lo stato (anello, "In regola" / "N cose da fare") e la prossima cosa
// urgente; sotto, a sinistra, le voci raggruppate per ente o per urgenza; a destra il calendario dei prossimi giorni e gli ultimi invii.
// I calcoli stanno in lib/adempimenti2.ts (puri e collaudati); qui si collegano ai dati reali e si disegna.
// La pagina classica resta su /adempimenti: stesse tabelle, stesse chiamate, stesse regole.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { PageHeader } from "@/components/ui";
import { apiPost } from "@/lib/invoicing/client";
import { toISO, nights, parseISO } from "@/lib/dates";
import { bookingPaidTotal, cityTaxOf } from "@/lib/booking";
import { journeyOf, type JourneyStep } from "@/lib/booking-journey";
import { isGuideSent, reminderNotes, useReminderLog } from "@/lib/guest-messages";
import {
  ENTI, addDaysISO, buildCalendar, buildTasks, buildTimeline, isLive, nextTask, summarize, type ABooking, type Ente, type ReminderItem, type StepKey, type Task, type TaskAction,
} from "@/lib/adempimenti2";
import type { Booking } from "@/lib/types";
import StepActions from "../prenotazioni/_azioni";
import { tint } from "../_ui";
import { useAdempimentiDati } from "./_dati";
import { ElaboraButton, ElaboraConfirm, ElaboraPanel, useElabora } from "./_elabora";
import Hero from "./_hero";
import { EmptyFilter, EnteView, RegolaPanel, Toolbar, UrgencyView, type Filter, type View } from "./_gruppi";
import { Calendario, Cronologia } from "./_laterale";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function Adempimenti2() {
  const router = useRouter();
  const { bookings: allBookings, guests, structures, allStructures, selectedStructureIds, getStructure, openBooking } = useData();

  // Orologio: "oggi" LOCALE (non UTC) e ora, aggiornati ogni minuto (le scadenze Questura scalano a pagina aperta).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNowMs(Date.now()), 60000); return () => clearInterval(id); }, []);
  const today = useMemo(() => toISO(new Date(nowMs)), [nowMs]);

  // Scope: SOLO le strutture selezionate in alto (una, più d'una, o tutte). Vale per prenotazioni e per le tabelle dei dati.
  const scopeSet = useMemo(() => new Set(selectedStructureIds), [selectedStructureIds]);
  const inScope = useCallback((sid: string | null | undefined) => !sid || scopeSet.has(sid), [scopeSet]);
  const bookings = useMemo(() => allBookings.filter((b) => scopeSet.has(b.structureId)), [allBookings, scopeSet]);
  const multi = selectedStructureIds.length > 1;
  const structName = useCallback((sid?: string | null) => (multi && sid ? getStructure(sid)?.name : undefined), [multi, getStructure]);
  const structOf = useCallback((t: Task) => structName(t.structureId), [structName]);

  const guestMap = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const byId = useMemo(() => new Map(allBookings.map((b) => [b.id, b])), [allBookings]);
  const nameOf = useCallback((b: ABooking) => {
    const g = guestMap.get(b.guestId);
    const pg = (b as Booking).primaryGuest;
    return g?.fullName || [pg?.firstName, pg?.lastName].filter(Boolean).join(" ") || "Ospite";
  }, [guestMap]);

  // Dati: gli stessi di "Adempimenti oggi".
  const dati = useAdempimentiDati(today);
  const sched = useMemo(() => dati.sched.filter((s) => inScope(s.structure_id)), [dati.sched, inScope]);
  const istat = useMemo(() => dati.istat.filter((s) => inScope(s.structure_id)), [dati.istat, inScope]);
  const docs = useMemo(() => dati.docs.filter((d) => inScope(d.structure_id)), [dati.docs, inScope]);
  const passive = useMemo(() => dati.passive.filter((p) => inScope(p.structure_id)), [dati.passive, inScope]);

  // ── Cose da fare ──
  const res = useMemo(() => buildTasks<Booking>({
    today, nowMs, bookings,
    primaryOf: (b) => guestMap.get(b.guestId) ?? b.primaryGuest,
    nameOf,
    sched, istat,
    taxOf: (b) => cityTaxOf(getStructure(b.structureId), b.adults, nights(b.checkIn, b.checkOut), b.total ?? 0, b.cityTaxExempt),
    balanceOf: (b) => Math.max(0, bookingPaidTotal(b) - (b.paid ?? 0)),
    totalOf: (b) => bookingPaidTotal(b),
    docs, passive,
  }), [today, nowMs, bookings, guestMap, nameOf, sched, istat, getStructure, docs, passive]);
  const summary = useMemo(() => summarize(res.tasks, res.done), [res]);
  const next = useMemo(() => nextTask(res.tasks), [res.tasks]);
  const calendar = useMemo(() => buildCalendar<Booking>(res.tasks, bookings, (b) => guestMap.get(b.guestId) ?? b.primaryGuest, today, 7), [res.tasks, bookings, guestMap, today]);

  // ── Percorso della prenotazione (per la finestra "Risolvi", la stessa di Prenotazioni) e cronologia dei solleciti ──
  const windowBookings = useMemo(() => bookings.filter((b) => isLive(b) && b.checkOut >= addDaysISO(today, -14) && b.checkIn <= addDaysISO(today, 3)), [bookings, today]);
  const remLog = useReminderLog(windowBookings);
  const stepsOf = useCallback((b: Booking): JourneyStep[] => journeyOf(b, {
    today, guest: guestMap.get(b.guestId), structure: getStructure(b.structureId),
    schedina: dati.schedBy.get(b.id) ?? "none", istat: dati.istatBy.get(b.id) ?? "none",
    guideSent: isGuideSent(b, dati.threads[b.guestId], remLog[b.id]), reminderNotes: reminderNotes(remLog[b.id]),
  }).steps, [today, guestMap, getStructure, dati.schedBy, dati.istatBy, dati.threads, remLog]);

  const timeline = useMemo(() => {
    const since = nowMs - 7 * 86400000;
    const rems: ReminderItem[] = [];
    for (const [bid, kinds] of Object.entries(remLog)) for (const [kind, list] of Object.entries(kinds)) for (const e of list) if (e.ts >= since) rems.push({ ts: e.ts, kind, via: e.via, bookingId: bid });
    return buildTimeline(dati.subs.filter((s) => inScope(s.structure_id)), rems, 8);
  }, [dati.subs, remLog, inScope, nowMs]);

  // ── Vista e filtro ──
  const [view, setView] = useState<View>("ente");
  const [filter, setFilter] = useState<Filter>("all");
  const [regolaOpen, setRegolaOpen] = useState(false);
  const shown = useMemo(() => (filter === "all" ? res.tasks : res.tasks.filter((t) => t.urgency === filter)), [res.tasks, filter]);
  const regola = useMemo(() => ENTI.filter((e) => !res.tasks.some((t) => t.ente === e)), [res.tasks]);
  const onEnte = (e: Ente) => {
    setView("ente"); setFilter("all");
    const hasCard = res.tasks.some((t) => t.ente === e);
    if (!hasCard) setRegolaOpen(true);
    const reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => document.getElementById(hasCard ? `ente-${e}` : "regola")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }), 60);
  };

  // ── Azioni ──
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(null), 9000); return () => clearTimeout(id); }, [notice]);
  const [resolve, setResolve] = useState<{ bookingId: string; step: StepKey } | null>(null);

  // "Prepara": genera le schedine / i movimenti ISTAT dagli arrivi. NON invia nulla (l'invio resta una scelta esplicita).
  const syncCall = async (kind: "alloggiati" | "istat") => {
    if (selectedStructureIds.length >= allStructures.length) await apiPost(`${kind}/sync`, {});
    else for (const id of selectedStructureIds) await apiPost(`${kind}/sync`, { structureId: id });
  };
  const runAction = async (t: Task | null, a: TaskAction) => {
    switch (a.kind) {
      case "link": if (a.href) router.push(a.href); return;
      case "fix": if (t?.repId) openBooking(t.repId); return;
      case "compila": {
        if (!t?.repId) return;
        const w = window.open(`${window.location.origin}/checkin?b=${t.repId}`, "_blank");
        if (!w) router.push(`/checkin?b=${t.repId}`); // popup bloccato: si apre qui
        return;
      }
      case "resolve": {
        const b = t?.repId ? byId.get(t.repId) : undefined;
        if (!b || !a.step) return;
        if (!stepsOf(b).some((s) => s.key === a.step)) { openBooking(b.id); return; } // passaggio non applicabile: si apre la prenotazione
        setResolve({ bookingId: b.id, step: a.step });
        return;
      }
      case "sync": {
        if (!a.sync) return;
        setBusyId(t?.id ?? `sync:${a.sync}`);
        try {
          await syncCall(a.sync);
          await dati.reload();
          setNotice({ ok: true, text: a.sync === "alloggiati" ? "Schedine aggiornate dai check-in completi. Controlla le voci qui sotto." : "Movimenti ISTAT generati dagli arrivi. Controlla le voci qui sotto." });
        } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : "Operazione non riuscita." }); }
        finally { setBusyId(""); }
      }
    }
  };

  // "Elabora tutto": stesso flusso di Adempimenti oggi (prepara → conferma esplicita se l'invio è reale → esito).
  const elabora = useElabora({ structureIds: selectedStructureIds, bookings, getStructure, reload: dati.reload });

  // Finestra "Risolvi" (azioni vere: sollecito, link di pagamento, invio schedina con conferma, ecc.).
  const modalB = resolve ? byId.get(resolve.bookingId) : undefined;
  const modalSteps = useMemo(() => (modalB ? stepsOf(modalB) : []), [modalB, stepsOf]);
  const modalStep = resolve ? modalSteps.find((s) => s.key === resolve.step) : undefined;

  // ── Testi ──
  const dateLabel = cap(parseISO(today).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }));
  const scopeLabel = selectedStructureIds.length === 1 ? getStructure(selectedStructureIds[0])?.name ?? "" : selectedStructureIds.length >= allStructures.length ? (structures.length > 1 ? "Tutte le strutture" : structures[0]?.name ?? "") : `${selectedStructureIds.length} strutture`;
  const loading = !dati.ready;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Adempimenti"
        subtitle="Versione 2 · tutto ciò che va gestito o inviato, per ente e per urgenza"
        actions={
          <>
            <Link href="/adempimenti" className="rounded-lg px-2.5 py-2 text-xs font-semibold text-dim transition hover:bg-wash hover:text-txt focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]">Torna alla versione classica</Link>
            <ElaboraButton busy={elabora.busy} onClick={elabora.start} />
          </>
        }
      />

      {notice && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: tint(notice.ok ? "var(--ok)" : "var(--err)", 12), color: notice.ok ? "var(--ok)" : "var(--err)" }}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 rounded-md px-1.5 text-xs opacity-70 transition hover:opacity-100" aria-label="Chiudi">✕</button>
        </div>
      )}

      <Hero
        summary={summary} next={next} nextStruct={next ? structName(next.structureId) : undefined} dateLabel={dateLabel} scopeLabel={scopeLabel}
        loading={loading} onAction={runAction} busyId={busyId} onEnte={onEnte}
      />

      {dati.ready && dati.failed && (
        <div role="status" className="rounded-xl px-4 py-3 text-xs font-medium" style={{ backgroundColor: tint("var(--warn)", 12), color: "var(--warn)" }}>
          Alcuni dati (Questura, ISTAT, fatture) non si sono caricati: i numeri qui sotto potrebbero essere incompleti. Riprova tra un attimo.
        </div>
      )}

      <ElaboraPanel busy={elabora.busy} steps={elabora.steps} onClose={elabora.closeSteps} />

      <div className="grid items-start gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          {!loading && res.tasks.length > 0 && <Toolbar view={view} onView={setView} filter={filter} onFilter={setFilter} summary={summary} totalSoon={summary.soon} />}
          {loading ? (
            <div className="flex flex-col gap-3" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-40 rounded-2xl border border-line bg-surface motion-safe:animate-pulse" style={{ opacity: 0.8 - i * 0.2 }} />)}</div>
          ) : (
            <>
              {res.tasks.length > 0 && shown.length === 0 && <EmptyFilter onReset={() => setFilter("all")} />}
              {view === "ente"
                ? <EnteView tasks={shown} summary={summary} structOf={structOf} busyId={busyId} onAction={runAction} />
                : <UrgencyView tasks={shown} structOf={structOf} busyId={busyId} onAction={runAction} />}
              {filter === "all" && <RegolaPanel enti={regola} summary={summary} open={regolaOpen || res.tasks.length === 0} onToggle={() => setRegolaOpen((o) => !o)} />}
            </>
          )}
        </div>
        <aside className="flex min-w-0 flex-col gap-4 lg:col-span-4" aria-label="Calendario e cronologia">
          <Calendario days={calendar} loading={loading} />
          <Cronologia entries={timeline} structOf={(id) => structName(id)} nameOf={(bid) => { const b = bid ? byId.get(bid) : undefined; return b ? nameOf(b) : undefined; }} loading={loading} />
        </aside>
      </div>

      <ElaboraConfirm prepared={elabora.confirm} busy={elabora.busy} onConfirm={elabora.doConfirm} onClose={elabora.closeConfirm} />

      {resolve && modalB && modalStep && (
        <StepActions
          key={`${modalB.id}:${resolve.step}`}
          b={modalB} step={modalStep}
          guest={guestMap.get(modalB.guestId)} structure={getStructure(modalB.structureId)}
          checkinDone={modalSteps.find((s) => s.key === "checkin")?.state === "done"}
          schedina={dati.schedBy.get(modalB.id) ?? "none"} istat={dati.istatBy.get(modalB.id) ?? "none"}
          paySentInChat={(dati.threads[modalB.guestId] ?? []).some((m) => m.dir === "out" && m.text.includes("chat-pay/go"))}
          onClose={() => setResolve(null)} onSwitch={(key) => setResolve({ bookingId: modalB.id, step: key as StepKey })} onChanged={() => { void dati.reload(); }}
        />
      )}
    </div>
  );
}
