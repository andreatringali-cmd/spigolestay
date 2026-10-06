"use client";

// Vista "Dettagliata" delle prenotazioni: righe alte con anteprima della camera, ospite, date e tutti i
// passaggi da fare (check-in, pagamento, schedina, ISTAT…). Mostra l'elenco già filtrato dalla pagina.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import type { Booking } from "@/lib/types";
import { parseISO, toISO } from "@/lib/dates";
import { bookingCode } from "@/lib/bookingCode";
import { journeyBucket, journeyOf, isLiveBooking } from "@/lib/booking-journey";
import EmptyState from "@/components/EmptyState";
import { groupSizes, isRealGroup } from "@/lib/groups";
import { isGuideSent, readReminders, reminderNotes, useReminderLog } from "@/lib/guest-messages";
import StepActions from "./_azioni";
import SchedaGiorno from "@/app/(app)/calendario/_scheda";
import { avvisiOf, colonnaOggi, etichettaOggi } from "@/app/(app)/calendario/_avvisi";
import { turnoverIndex } from "@/app/(app)/calendario/_modello";

type SchedRow = { booking_id: string | null; stato: string };
type IstatRow = { booking_id: string | null; stato: string };
type DocRow = { booking_id: string | null; stato: string };

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Tutte" },
  { key: "late", label: "In ritardo" },
  { key: "todo", label: "Da fare" },
  { key: "arrive", label: "Arrivano oggi" },
  { key: "inhouse", label: "In casa" },
  { key: "leave", label: "Partono oggi" },
];
const dayLabel = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });

export interface DettaglioSection { key: string; title: string; color: string; ids: string[]; empty: string }

export default function PrenotazioniDettaglio({ bookings, guestName, unitLabel, showStructure, sections }: {
  bookings: Booking[];
  /** Se presente: niente filtri rapidi, le righe sono divise in queste categorie (es. Arrivi, In casa, Partenze). */
  sections?: DettaglioSection[];
  guestName: (b: Booking) => string;
  unitLabel: (b: Booking) => string | null;
  showStructure: boolean;
}) {
  const router = useRouter();
  const { guests, units, roomTypes, getStructure, openBooking, bookings: allBookings } = useData();
  const gSizes = useMemo(() => groupSizes(allBookings), [allBookings]); // "Gruppo" solo se ci sono almeno 2 camere attive col stesso groupId
  const today = toISO(new Date());
  const [filter, setFilter] = useState("all");
  const [sched, setSched] = useState<SchedRow[]>([]);
  const [istat, setIstat] = useState<IstatRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [threads, setThreads] = useState<Record<string, { dir: string; text: string }[]>>({});
  const [rems, setRems] = useState<Record<string, Record<string, number>>>({});
  const [modal, setModal] = useState<{ id: string; key: string } | null>(null);
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({}); // categorie espanse (oltre le prime righe)
  const SEC_LIMIT = 5;

  const load = useCallback(async () => {
    try { setThreads(JSON.parse(localStorage.getItem("spigolestay:threads:v1") || "{}")); } catch { setThreads({}); }
    setRems(readReminders());
    if (!supabase) return;
    const [a, i, d] = await Promise.all([
      supabase.from("alloggiati_schedine").select("booking_id, stato"),
      supabase.from("istat_rows").select("booking_id, stato"),
      supabase.from("documents").select("booking_id, stato").not("booking_id", "is", null),
    ]);
    setSched((a.data ?? []) as SchedRow[]); setIstat((i.data ?? []) as IstatRow[]); setDocs((d.data ?? []) as DocRow[]);
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
  const docBy = useMemo(() => { const m = new Map<string, string>(); for (const d of docs) if (d.booking_id && d.stato !== "scartata") { const cur = m.get(d.booking_id); if (!cur || cur === "bozza") m.set(d.booking_id, d.stato); } /* un documento emesso batte la bozza */ return m; }, [docs]);

  // Ordine pensato per il lavoro: prima in casa e in arrivo (dal più vicino), poi lo storico (dal più recente).
  const ordered = useMemo(() => {
    const live = bookings.filter((b) => b.checkOut >= today).sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.checkOut.localeCompare(b.checkOut));
    const past = bookings.filter((b) => b.checkOut < today).sort((a, b) => b.checkOut.localeCompare(a.checkOut));
    return [...live, ...past];
  }, [bookings, today]);

  const remLog = useReminderLog(ordered); // cronologia dei solleciti (da chat)
  const rows = useMemo(() => ordered.map((b) => {
    const guest = guests.find((g) => g.id === b.guestId);
    const j = isLiveBooking(b) ? journeyOf(b, {
      today, guest, structure: getStructure(b.structureId),
      schedina: schedBy.get(b.id) ?? "none", istat: istatBy.get(b.id) ?? "none",
      guideSent: isGuideSent(b, threads[b.guestId], remLog[b.id]),
      invoiceStato: docBy.get(b.id),
      reminderNotes: reminderNotes(remLog[b.id]),
    }) : null;
    return { b, j, buckets: j ? journeyBucket(b, today, j) : [] };
  }), [ordered, guests, getStructure, today, schedBy, istatBy, threads, docBy, rems, remLog]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, f.key === "all" ? rows.length : rows.filter((r) => r.buckets.includes(f.key)).length])), [rows]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.buckets.includes(filter));

  const modalRow = modal ? rows.find((r) => r.b.id === modal.id) : undefined;
  const modalStep = modalRow?.j?.steps.find((x) => x.key === modal?.key);

  // Turnover (partenza e arrivo lo stesso giorno sulla stessa camera) calcolato su tutte le prenotazioni vive, come nel calendario.
  const turn = useMemo(() => turnoverIndex(allBookings.filter((b) => b.channel !== "blocked" && isLiveBooking(b))), [allBookings]);
  const dayShort = (iso: string) => dayLabel(iso);

  // La scheda è la stessa del Calendario · Dettagliato (stesso componente), così le due viste non possono più differire.
  const renderRows = (list: typeof rows) => list.map(({ b, j }) => {
    const unit = units.find((u) => u.id === b.unitId);
    const rt = roomTypes.find((r) => r.id === (unit?.roomTypeId ?? b.roomTypeId));
    const live = isLiveBooking(b);
    const t = etichettaOggi(b, today, dayShort);
    return (
      <SchedaGiorno
        key={b.id} b={b} j={j} code={bookingCode(b)} dim={!live} guestName={guestName(b) || "—"}
        groupSize={isRealGroup(gSizes, b.groupId) ? gSizes.get(b.groupId!) : undefined}
        unit={unit} roomType={rt} typeLabel={unitLabel(b) ?? undefined}
        structure={getStructure(b.structureId)} showStructure={showStructure}
        tag={t.tag} tagTone={t.tone}
        avvisi={live && j ? avvisiOf(b, j, colonnaOggi(b, today), { today, unit, turn, getStructure }) : []}
        onOpen={() => openBooking(b.id)}
        onStep={(s) => { if (s.state !== "done" && s.state !== "na") setModal({ id: b.id, key: s.key }); else if (s.href) router.push(s.href); }}
      />
    );
  });

  return (
    <div>
      {!sections && <div className="no-print mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${filter === f.key ? "border-focus bg-focus text-white" : "border-line bg-surface text-dim hover:border-focus hover:text-focus"}`}>
            {f.label}{counts[f.key] > 0 && f.key !== "all" ? <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${filter === f.key ? "bg-white/25" : f.key === "late" ? "bg-[color:color-mix(in_srgb,var(--err)_14%,transparent)] text-[color:var(--err)]" : "bg-wash"}`}>{counts[f.key]}</span> : null}
          </button>
        ))}
        <span className="ml-auto text-xs text-faint">{shown.length} prenotazioni</span>
      </div>}

      {sections && (
        <div className="flex flex-col gap-7">
          {sections.map((sec) => {
            const ids = new Set(sec.ids);
            const list = rows.filter((r) => ids.has(r.b.id));
            return (
              <section key={sec.key}>
                <div className="mb-2.5 flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: sec.color }} />
                  <h2 className="font-display text-lg font-bold text-txt">{sec.title}</h2>
                  <span className="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums" style={{ color: sec.color, background: `color-mix(in srgb, ${sec.color} 14%, transparent)` }}>{list.length}</span>
                </div>
                {list.length ? <div className="flex flex-col gap-3">{renderRows(openSec[sec.key] ? list : list.slice(0, SEC_LIMIT))}{list.length > SEC_LIMIT && <button onClick={() => setOpenSec((o) => ({ ...o, [sec.key]: !o[sec.key] }))} className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-focus transition hover:border-focus">{openSec[sec.key] ? "Mostra meno" : `Mostra tutte le ${list.length}`}</button>}</div> : <div className="rounded-xl border border-dashed border-line px-4 py-5 text-sm text-faint">{sec.empty}</div>}
              </section>
            );
          })}
        </div>
      )}

      {!sections && <div className="flex flex-col gap-3">
        {renderRows(shown)}
        {!shown.length && <div className="rounded-xl border border-line bg-surface"><EmptyState title={filter === "all" ? "Nessuna prenotazione con questi filtri" : "Nessuna prenotazione in questa categoria"} /></div>}
      </div>}
      {modal && modalRow && modalRow.j && modalStep && (
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
