"use client";

// Vista "Dettagliata" delle prenotazioni: righe alte con anteprima della camera, ospite, date e tutti i
// passaggi da fare (check-in, pagamento, schedina, ISTAT…). Mostra l'elenco già filtrato dalla pagina.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { CHANNELS, type Booking } from "@/lib/types";
import { parseISO, toISO, nights } from "@/lib/dates";
import { bookingPaidTotal } from "@/lib/booking";
import { eur } from "@/lib/format";
import { bookingCode } from "@/lib/bookingCode";
import { journeyBucket, journeyOf, isLiveBooking, type JourneyStep, type StepState } from "@/lib/booking-journey";
import { ChannelWordmark } from "@/components/ChannelLogo";
import EmptyState from "@/components/EmptyState";
import { groupSizes, isRealGroup } from "@/lib/groups";
import { readReminders, reminderNotes, useReminderLog } from "@/lib/guest-messages";
import StepActions from "./_azioni";
import BookingAmounts from "@/components/BookingAmounts";

type SchedRow = { booking_id: string | null; stato: string };
type IstatRow = { booking_id: string | null; stato: string };
type DocRow = { booking_id: string | null; stato: string };

const STATE_COLOR: Record<StepState, string> = { done: "var(--ok)", todo: "var(--warn)", late: "var(--err)", na: "var(--faint)" };
const STATE_GLYPH: Record<StepState, string> = { done: "✓", todo: "", late: "!", na: "–" };
const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Tutte" },
  { key: "late", label: "In ritardo" },
  { key: "todo", label: "Da fare" },
  { key: "arrive", label: "Arrivano oggi" },
  { key: "inhouse", label: "In casa" },
  { key: "leave", label: "Partono oggi" },
];
const dayLabel = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
const GUIDE_RE = /guest-guide|\/guida|guida ospiti/i;

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
      guideSent: !!rems[b.id]?.guide || (threads[b.guestId] ?? []).some((m) => m.dir === "out" && GUIDE_RE.test(m.text)),
      invoiceStato: docBy.get(b.id),
      reminderNotes: reminderNotes(remLog[b.id]),
    }) : null;
    return { b, j, buckets: j ? journeyBucket(b, today, j) : [] };
  }), [ordered, guests, getStructure, today, schedBy, istatBy, threads, docBy, rems, remLog]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, f.key === "all" ? rows.length : rows.filter((r) => r.buckets.includes(f.key)).length])), [rows]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.buckets.includes(filter));

  // Un passaggio da fare apre la finestra "Risolvi" con le azioni vere; uno già fatto porta alla pagina di dettaglio.
  const openStep = (e: React.MouseEvent, b: Booking, s: JourneyStep) => {
    e.stopPropagation();
    if (s.state !== "done" && s.state !== "na") setModal({ id: b.id, key: s.key });
    else if (s.href) router.push(s.href);
  };
  const modalRow = modal ? rows.find((r) => r.b.id === modal.id) : undefined;
  const modalStep = modalRow?.j?.steps.find((x) => x.key === modal?.key);

  const renderRows = (list: typeof rows) => list.map(({ b, j }) => {
          const unit = units.find((u) => u.id === b.unitId);
          const rt = roomTypes.find((r) => r.id === (unit?.roomTypeId ?? b.roomTypeId));
          const st = getStructure(b.structureId);
          const photo = unit?.photos?.[0];
          const tint = rt?.color || st?.photoColor || "var(--focus)";
          const n = nights(b.checkIn, b.checkOut);
          const arrivesIn = Math.round((Date.parse(b.checkIn) - Date.parse(today)) / 86400000);
          const live = isLiveBooking(b);
          const total = bookingPaidTotal(b);
          const people = b.adults + b.children;
          const when = !live ? (b.status === "no_show" ? "No-show" : b.status === "cancelled" ? "Cancellata" : "") :
            b.checkOut < today ? "Partita" :
            b.checkOut === today ? "Parte oggi" :
            b.checkIn === today ? "Arriva oggi" :
            b.checkIn > today ? (arrivesIn === 1 ? "Arriva domani" : `Tra ${arrivesIn} giorni`) :
            `In casa · notte ${Math.round((Date.parse(today) - Date.parse(b.checkIn)) / 86400000) + 1} di ${n}`;
          const whenTone = !live ? "var(--err)" : b.checkIn === today || b.checkOut === today ? "var(--focus)" : b.checkOut < today ? "var(--faint)" : "var(--dim)";
          const steps = (j?.steps ?? []).filter((s) => s.state !== "na" || s.key === "checkout");
          const pct = j && j.total ? Math.round((j.done / j.total) * 100) : 0;
          return (
            <article key={b.id} onClick={() => openBooking(b.id)} className={`group flex cursor-pointer flex-col gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm transition hover:border-focus hover:shadow-md md:flex-row md:items-stretch md:gap-4 ${live ? "" : "opacity-70"}`}>
              {/* Anteprima camera */}
              <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-xl md:h-auto md:w-40" style={photo ? undefined : { background: `linear-gradient(145deg, color-mix(in srgb, ${tint} 85%, #fff), color-mix(in srgb, ${tint} 70%, #000))` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-white">
                  <div className="truncate text-sm font-bold leading-tight">{unit ? unit.name.replace(/^camera\s*/i, "") : <span className="italic">Da assegnare</span>}</div>
                  <div className="truncate text-[11px] opacity-90">{rt?.name ?? unitLabel(b) ?? ""}</div>
                </div>
                {showStructure && st && <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">{st.name}</span>}
              </div>

              {/* Ospite, date, passaggi */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <h3 className="truncate text-base font-bold text-txt">{guestName(b) || "—"}</h3>
                  <ChannelWordmark channel={b.channel} height={18} title={b.channel === "direct" ? "xenora.it" : CHANNELS[b.channel].label} />
                  <span className="font-mono text-[11px] text-faint">{bookingCode(b)}</span>
                  {isRealGroup(gSizes, b.groupId) && <span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-focus">Gruppo · {gSizes.get(b.groupId!)} camere</span>}
                  {b.status === "tentative" && <span className="rounded-full bg-[color:color-mix(in_srgb,var(--warn)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--warn)]">Opzione</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-dim">
                  <span className="font-medium capitalize text-txt">{dayLabel(b.checkIn)}</span><span className="text-faint">→</span><span className="font-medium capitalize text-txt">{dayLabel(b.checkOut)}</span>
                  <span className="text-faint">·</span><span>{n} {n === 1 ? "notte" : "notti"}</span>
                  <span className="text-faint">·</span><span>{people} {people === 1 ? "ospite" : "ospiti"}</span>
                  {when && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: whenTone, background: `color-mix(in srgb, ${whenTone} 12%, transparent)` }}>{when}</span>}
                </div>

                {steps.length > 0 && (
                  <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 xl:grid-cols-4">
                    {steps.map((s) => (
                      <button key={s.key} onClick={(e) => openStep(e, b, s)} title={`${s.label}: ${s.detail}`} className="flex min-w-0 items-start gap-2 rounded-lg text-left transition hover:bg-wash">
                        <span className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px] font-extrabold" style={{ color: STATE_COLOR[s.state], border: `1.5px solid ${STATE_COLOR[s.state]}`, background: s.state === "done" ? `color-mix(in srgb, ${STATE_COLOR[s.state]} 14%, transparent)` : "transparent" }}>{STATE_GLYPH[s.state]}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-txt">{s.label}</span>
                          <span className="block truncate text-[11px]" style={{ color: s.state === "late" ? "var(--err)" : "var(--faint)" }}>{s.detail}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {j && j.chips.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {j.chips.map((c) => (
                      <span key={c.key} className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: c.tone === "err" ? "var(--err)" : c.tone === "warn" ? "var(--warn)" : "var(--dim)", background: `color-mix(in srgb, ${c.tone === "err" ? "var(--err)" : c.tone === "warn" ? "var(--warn)" : "var(--faint)"} 14%, transparent)` }}>{c.label}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Importi e avanzamento */}
              <div className="flex shrink-0 flex-col gap-3 border-t border-line pt-2 md:w-60 md:justify-between md:border-l md:border-t-0 md:pl-4 md:pt-0">
                <div className="md:text-right">
                  <div className="font-mono text-lg font-bold text-txt">{total ? eur(total) : "—"}{total > 0 && <span className="ml-1.5 font-sans text-[11px] font-normal text-faint">{(b.cleaningFee ?? 0) > 0 || (b.extras ?? []).length > 0 ? "totale" : `soggiorno · ${n} ${n === 1 ? "notte" : "notti"}`}</span>}</div>
                </div>
                <BookingAmounts b={b} structure={st} />
                {j && j.total > 0 && (
                  <div className="min-w-[110px] md:w-full">
                    <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-dim"><span>{j.done} di {j.total}</span><span>{pct}%</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: j.steps.some((s) => s.state === "late") ? "var(--err)" : pct === 100 ? "var(--ok)" : "var(--focus)" }} /></div>
                    {!j.next && <div className="mt-1.5 text-[11px] font-semibold md:text-right" style={{ color: "var(--ok)" }}>Tutto in ordine ✓</div>}
                  </div>
                )}
              </div>
            </article>
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
