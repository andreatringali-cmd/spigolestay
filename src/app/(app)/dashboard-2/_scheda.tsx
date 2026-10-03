"use client";

// Scheda compatta di una prenotazione per la Dashboard 2: stesso linguaggio visivo delle righe alte di
// "Prenotazioni · Dettagliata" (anteprima camera, ospite, date con etichetta relativa, passaggi con pallini,
// segnalazioni, avanzamento e "Prossimo: …"), ma più stretta. È solo presentazione: i dati arrivano dalla pagina.
import type { Booking, Structure, Unit, RoomType } from "@/lib/types";
import { CHANNELS } from "@/lib/types";
import { parseISO, nights } from "@/lib/dates";
import { bookingPaidTotal } from "@/lib/booking";
import { eur } from "@/lib/format";
import { isLiveBooking, type JourneyStep, type StepState, type journeyOf } from "@/lib/booking-journey";
import ChannelLogo from "@/components/ChannelLogo";

export type Journey = ReturnType<typeof journeyOf>;

const STATE_COLOR: Record<StepState, string> = { done: "var(--ok)", todo: "var(--warn)", late: "var(--err)", na: "var(--faint)" };
const STATE_GLYPH: Record<StepState, string> = { done: "✓", todo: "", late: "!", na: "–" };
const dayLabel = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });

export default function Scheda({ b, j, today, guestName, unit, roomType, structure, showStructure, onOpen, onStep }: {
  b: Booking;
  j: Journey | null;
  today: string;
  guestName: string;
  unit?: Unit;
  roomType?: RoomType;
  structure?: Structure;
  showStructure: boolean;
  onOpen: () => void;
  onStep: (s: JourneyStep) => void;
}) {
  const photo = unit?.photos?.[0];
  const tint = roomType?.color || structure?.photoColor || "var(--focus)";
  const n = nights(b.checkIn, b.checkOut);
  const arrivesIn = Math.round((Date.parse(b.checkIn) - Date.parse(today)) / 86400000);
  const live = isLiveBooking(b);
  const total = bookingPaidTotal(b);
  const resid = Math.max(0, total - (b.paid ?? 0));
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
  const anyLate = !!j?.steps.some((s) => s.state === "late");
  const unitName = unit ? unit.name.replace(/^camera\s*/i, "") : null;

  return (
    <article
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
      className="group flex cursor-pointer flex-col gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm transition hover:border-focus hover:shadow-md focus-visible:border-focus focus-visible:outline-none md:flex-row md:items-stretch md:gap-4"
      style={anyLate ? { borderLeft: "3px solid var(--err)" } : undefined}
    >
      {/* Anteprima camera: quadratino accanto al nome su mobile, riquadro alto su desktop */}
      <div className="flex min-w-0 items-start gap-3 md:contents">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl md:h-auto md:w-32" style={photo ? undefined : { background: `linear-gradient(145deg, color-mix(in srgb, ${tint} 85%, #fff), color-mix(in srgb, ${tint} 70%, #000))` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 text-white md:px-3 md:pb-2 md:pt-6">
            <div className="truncate text-xs font-bold leading-tight md:text-sm">{unitName ?? <span className="italic">Da assegnare</span>}</div>
            <div className="hidden truncate text-[11px] opacity-90 md:block">{roomType?.name ?? ""}</div>
          </div>
          {showStructure && structure && <span className="absolute left-1.5 top-1.5 hidden max-w-[calc(100%-12px)] truncate rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white md:block">{structure.name}</span>}
        </div>

        {/* Ospite e date */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 className="truncate text-base font-bold text-txt">{guestName}</h3>
            <ChannelLogo channel={b.channel} size={16} title={b.channel === "direct" ? "xenora.it" : CHANNELS[b.channel].label} />
            {b.groupId && <span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-focus">Gruppo</span>}
            {b.status === "tentative" && <span className="rounded-full bg-[color:color-mix(in_srgb,var(--warn)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--warn)]">Opzione</span>}
            {showStructure && structure && <span className="truncate text-[11px] font-semibold text-faint md:hidden">{structure.name}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-dim">
            <span className="font-medium capitalize text-txt">{dayLabel(b.checkIn)}</span><span className="text-faint">→</span><span className="font-medium capitalize text-txt">{dayLabel(b.checkOut)}</span>
            <span className="text-faint">·</span><span>{n} {n === 1 ? "notte" : "notti"}</span>
            <span className="text-faint">·</span><span>{people} {people === 1 ? "ospite" : "ospiti"}</span>
            {when && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: whenTone, background: `color-mix(in srgb, ${whenTone} 12%, transparent)` }}>{when}</span>}
          </div>

          {steps.length > 0 && (
            <div className="mt-2.5 hidden grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 md:grid xl:grid-cols-4">
              {steps.map((s) => <StepButton key={s.key} s={s} onStep={onStep} />)}
            </div>
          )}

          {j && j.chips.length > 0 && (
            <div className="mt-2.5 hidden flex-wrap gap-1.5 md:flex">
              {j.chips.slice(0, 4).map((c) => <Chip key={c.key} c={c} />)}
              {j.chips.length > 4 && <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-faint">+{j.chips.length - 4}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Su mobile passaggi e segnalazioni stanno a tutta larghezza sotto l'intestazione */}
      {steps.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:hidden">
          {steps.map((s) => <StepButton key={s.key} s={s} onStep={onStep} />)}
        </div>
      )}
      {j && j.chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 md:hidden">
          {j.chips.slice(0, 4).map((c) => <Chip key={c.key} c={c} />)}
          {j.chips.length > 4 && <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-faint">+{j.chips.length - 4}</span>}
        </div>
      )}

      {/* Importo e avanzamento */}
      <div className="flex shrink-0 flex-row items-center justify-between gap-3 border-t border-line pt-2 md:w-40 md:flex-col md:items-end md:justify-between md:border-l md:border-t-0 md:pl-4 md:pt-0">
        <div className="md:text-right">
          <div className="font-mono text-base font-bold text-txt">{total ? eur(total) : "—"}</div>
          <div className="text-[11px] text-faint">{total ? (resid <= 0.005 ? "Saldato" : `Mancano ${eur(resid)}`) : ""}</div>
        </div>
        {j && j.total > 0 && (
          <div className="min-w-[110px] md:w-full">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-dim"><span>{j.done} di {j.total}</span><span>{pct}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: anyLate ? "var(--err)" : pct === 100 ? "var(--ok)" : "var(--focus)" }} /></div>
            {j.next
              ? <button onClick={(e) => { e.stopPropagation(); onStep(j.next!); }} className="mt-1.5 block w-full truncate text-left text-[11px] font-semibold md:text-right" style={{ color: j.next.state === "late" ? "var(--err)" : "var(--focus)" }}>Prossimo: {j.next.label} →</button>
              : <div className="mt-1.5 text-[11px] font-semibold md:text-right" style={{ color: "var(--ok)" }}>Tutto in ordine ✓</div>}
          </div>
        )}
      </div>
    </article>
  );
}

function StepButton({ s, onStep }: { s: JourneyStep; onStep: (s: JourneyStep) => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onStep(s); }} title={`${s.label}: ${s.detail}`} className="flex min-w-0 items-start gap-2 rounded-lg text-left transition hover:bg-wash">
      <span className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px] font-extrabold" style={{ color: STATE_COLOR[s.state], border: `1.5px solid ${STATE_COLOR[s.state]}`, background: s.state === "done" ? `color-mix(in srgb, ${STATE_COLOR[s.state]} 14%, transparent)` : "transparent" }}>{STATE_GLYPH[s.state]}</span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-txt">{s.label}</span>
        <span className="block truncate text-[11px]" style={{ color: s.state === "late" ? "var(--err)" : "var(--faint)" }}>{s.detail}</span>
      </span>
    </button>
  );
}

function Chip({ c }: { c: { key: string; label: string; tone: "info" | "warn" | "err" } }) {
  const col = c.tone === "err" ? "var(--err)" : c.tone === "warn" ? "var(--warn)" : "var(--dim)";
  const bg = c.tone === "err" ? "var(--err)" : c.tone === "warn" ? "var(--warn)" : "var(--faint)";
  return <span className="max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: col, background: `color-mix(in srgb, ${bg} 14%, transparent)` }}>{c.label}</span>;
}
