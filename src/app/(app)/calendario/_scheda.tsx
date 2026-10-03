"use client";

// Scheda alta di una prenotazione per la vista Calendario · Dettagliato. Stesso linguaggio di
// "Prenotazioni · Dettagliata" (anteprima camera, ospite, date, passaggi con pallini, segnalazioni, avanzamento),
// impaginata in verticale per stare nelle tre colonne Arrivi / In casa / Partenze, più una fascia di avvisi.
import type { Booking, Structure, Unit, RoomType } from "@/lib/types";
import { CHANNELS } from "@/lib/types";
import { parseISO, nights } from "@/lib/dates";
import { bookingPaidTotal } from "@/lib/booking";
import { eur } from "@/lib/format";
import { type JourneyStep, type StepState, type journeyOf } from "@/lib/booking-journey";
import ChannelLogo from "@/components/ChannelLogo";

export type Journey = ReturnType<typeof journeyOf>;
export interface Avviso { key: string; label: string; tone: "err" | "warn" | "info"; title?: string }

const STATE_COLOR: Record<StepState, string> = { done: "var(--ok)", todo: "var(--warn)", late: "var(--err)", na: "var(--faint)" };
const STATE_GLYPH: Record<StepState, string> = { done: "✓", todo: "", late: "!", na: "–" };
const TONE: Record<Avviso["tone"], string> = { err: "var(--err)", warn: "var(--warn)", info: "var(--dim)" };
const dayLabel = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });

export default function SchedaGiorno({ b, j, guestName, unit, roomType, structure, showStructure, tag, tagTone, avvisi, onOpen, onStep }: {
  b: Booking;
  j: Journey;
  guestName: string;
  unit?: Unit;
  roomType?: RoomType;
  structure?: Structure;
  showStructure: boolean;
  tag: string;
  tagTone: string;
  avvisi: Avviso[];
  onOpen: () => void;
  onStep: (s: JourneyStep) => void;
}) {
  const photo = unit?.photos?.[0];
  const tint = roomType?.color || structure?.photoColor || "var(--focus)";
  const n = nights(b.checkIn, b.checkOut);
  const total = bookingPaidTotal(b);
  const resid = Math.max(0, total - (b.paid ?? 0));
  const people = b.adults + b.children;
  const steps = j.steps.filter((s) => s.state !== "na" || s.key === "checkout");
  const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
  const anyLate = j.steps.some((s) => s.state === "late");
  const hasErr = avvisi.some((a) => a.tone === "err");
  const unitName = unit ? unit.name.replace(/^camera\s*/i, "") : null;
  const chips = j.chips.filter((c) => c.key !== "unit"); // "Camera da assegnare" è già tra gli avvisi

  return (
    <article
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
      className="group flex min-w-0 cursor-pointer flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3 shadow-sm transition hover:border-focus hover:shadow-md focus-visible:border-focus focus-visible:outline-none"
      style={anyLate || hasErr ? { borderLeft: "3px solid var(--err)" } : undefined}
    >
      {/* Anteprima camera + ospite + date */}
      <div className="flex min-w-0 items-start gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl" style={photo ? undefined : { background: `linear-gradient(145deg, color-mix(in srgb, ${tint} 85%, #fff), color-mix(in srgb, ${tint} 70%, #000))` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 text-white">
            <div className="truncate text-xs font-bold leading-tight">{unitName ?? <span className="italic">Da assegnare</span>}</div>
            <div className="truncate text-[10px] opacity-90">{roomType?.name ?? ""}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate text-base font-bold text-txt">{guestName}</h3>
            <span className="shrink-0"><ChannelLogo channel={b.channel} size={16} title={b.channel === "direct" ? "xenora.it" : CHANNELS[b.channel].label} /></span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-dim">
            <span className="font-medium capitalize text-txt">{dayLabel(b.checkIn)}</span><span className="text-faint">→</span><span className="font-medium capitalize text-txt">{dayLabel(b.checkOut)}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-dim">
            <span>{n} {n === 1 ? "notte" : "notti"}</span><span className="text-faint">·</span><span>{people} {people === 1 ? "ospite" : "ospiti"}</span>
            {b.groupId && <span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-focus">Gruppo</span>}
            {b.status === "tentative" && <span className="rounded-full bg-[color:color-mix(in_srgb,var(--warn)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--warn)]">Opzione</span>}
            {showStructure && structure && <span className="max-w-full truncate text-[11px] font-semibold text-faint">{structure.name}</span>}
          </div>
          {tag && <span className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: tagTone, background: `color-mix(in srgb, ${tagTone} 12%, transparent)` }}>{tag}</span>}
        </div>
      </div>

      {/* Avvisi: le cose da non perdere di vista */}
      {avvisi.length > 0 && (
        <div className="flex flex-col gap-1">
          {avvisi.map((a) => (
            <div key={a.key} title={a.title} className="flex items-start gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold leading-snug" style={{ color: TONE[a.tone], background: `color-mix(in srgb, ${a.tone === "info" ? "var(--faint)" : TONE[a.tone]} 13%, transparent)` }}>
              <span aria-hidden className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE[a.tone] }} />
              <span className="min-w-0">{a.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Passaggi */}
      {steps.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {steps.map((s) => <StepButton key={s.key} s={s} onStep={onStep} />)}
        </div>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.slice(0, 4).map((c) => <Chip key={c.key} c={c} />)}
          {chips.length > 4 && <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-faint">+{chips.length - 4}</span>}
        </div>
      )}

      {/* Importo e avanzamento */}
      <div className="mt-auto flex flex-row items-center justify-between gap-3 border-t border-line pt-2">
        <div className="min-w-0">
          <div className="font-mono text-base font-bold text-txt">{total ? eur(total) : "—"}</div>
          <div className="truncate text-[11px] text-faint">{total ? (resid <= 0.005 ? "Saldato" : `Mancano ${eur(resid)}`) : ""}</div>
        </div>
        {j.total > 0 && (
          <div className="min-w-[110px] flex-1 sm:max-w-[170px]">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-dim"><span>{j.done} di {j.total}</span><span>{pct}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: anyLate ? "var(--err)" : pct === 100 ? "var(--ok)" : "var(--focus)" }} /></div>
            {j.next
              ? <button onClick={(e) => { e.stopPropagation(); onStep(j.next!); }} className="mt-1.5 block w-full truncate text-right text-[11px] font-semibold" style={{ color: j.next.state === "late" ? "var(--err)" : "var(--focus)" }}>Prossimo: {j.next.label} →</button>
              : <div className="mt-1.5 text-right text-[11px] font-semibold" style={{ color: "var(--ok)" }}>Tutto in ordine ✓</div>}
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
