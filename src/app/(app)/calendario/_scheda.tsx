"use client";

// Scheda alta di una prenotazione per la vista Calendario · Dettagliato. Stesso linguaggio di
// "Prenotazioni · Dettagliata" (anteprima camera, ospite, date, passaggi con pallini, segnalazioni, avanzamento),
// impaginata in riga (anteprima a sinistra, dati al centro, importo a destra), una sotto l'altra per categoria.
import type { Booking, Structure, Unit, RoomType } from "@/lib/types";
import BookingAmounts from "@/components/BookingAmounts";
import { CHANNELS } from "@/lib/types";
import { parseISO, nights } from "@/lib/dates";
import { bookingPaidTotal } from "@/lib/booking";
import { eur } from "@/lib/format";
import { type JourneyStep, type StepState, type journeyOf } from "@/lib/booking-journey";
import { ChannelWordmark } from "@/components/ChannelLogo";

export type Journey = ReturnType<typeof journeyOf>;
export interface Avviso { key: string; label: string; tone: "err" | "warn" | "info"; title?: string }

const STATE_COLOR: Record<StepState, string> = { done: "var(--ok)", todo: "var(--warn)", late: "var(--err)", na: "var(--faint)" };
const STATE_GLYPH: Record<StepState, string> = { done: "✓", todo: "", late: "!", na: "–" };
const TONE: Record<Avviso["tone"], string> = { err: "var(--err)", warn: "var(--warn)", info: "var(--dim)" };
const dayLabel = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });

// Prenotazione non più "viva" (annullata, no-show, passata): nessun percorso da mostrare.
const NO_JOURNEY = { steps: [], chips: [], done: 0, total: 0, next: null } as unknown as Journey;

export default function SchedaGiorno({ groupSize, b, j: jIn, code, dim, typeLabel, guestName, unit, roomType, structure, showStructure, tag, tagTone, avvisi, onOpen, onStep }: {
  groupSize?: number; // quante camere attive ha il gruppo (il badge compare solo da 2 in su)
  b: Booking;
  j: Journey | null;
  code?: string;      // codice prenotazione, accanto al canale
  dim?: boolean;      // prenotazione conclusa o annullata: scheda attenuata
  typeLabel?: string; // nome da mostrare sotto la camera se la tipologia non è nota
  
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
  const j = jIn ?? NO_JOURNEY;
  const photo = unit?.photos?.[0];
  const tint = roomType?.color || structure?.photoColor || "var(--focus)";
  const n = nights(b.checkIn, b.checkOut);
  const total = bookingPaidTotal(b);
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
      className={`group flex min-w-0 cursor-pointer flex-col gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm transition hover:border-focus hover:shadow-md focus-visible:border-focus focus-visible:outline-none md:flex-row md:items-stretch md:gap-4 ${dim ? "opacity-70" : ""}`}
      style={anyLate || hasErr ? { borderLeft: "3px solid var(--err)" } : undefined}
    >
      {/* Anteprima camera */}
      <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-xl md:h-auto md:w-40" style={photo ? undefined : { background: `linear-gradient(145deg, color-mix(in srgb, ${tint} 85%, #fff), color-mix(in srgb, ${tint} 70%, #000))` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-white">
          <div className="truncate text-sm font-bold leading-tight">{unitName ?? <span className="italic">Da assegnare</span>}</div>
          <div className="truncate text-[11px] opacity-90">{roomType?.name ?? typeLabel ?? ""}</div>
        </div>
        {showStructure && structure && <span className="absolute left-2 top-2 max-w-[90%] truncate rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">{structure.name}</span>}
      </div>

      {/* Ospite, date, avvisi e passaggi */}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="min-w-0 truncate text-base font-bold text-txt">{guestName}</h3>
          <span className="shrink-0"><ChannelWordmark channel={b.channel} height={18} title={b.channel === "direct" ? "xenora.it" : CHANNELS[b.channel].label} /></span>
          {code && <span className="shrink-0 font-mono text-[11px] text-faint">{code}</span>}
          {(groupSize ?? 0) > 1 && <span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-focus">Gruppo · {groupSize} camere</span>}
          {b.status === "tentative" && <span className="rounded-full bg-[color:color-mix(in_srgb,var(--warn)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--warn)]">Opzione</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-dim">
          <span className="font-medium capitalize text-txt">{dayLabel(b.checkIn)}</span><span className="text-faint">→</span><span className="font-medium capitalize text-txt">{dayLabel(b.checkOut)}</span>
          <span className="text-faint">·</span><span>{n} {n === 1 ? "notte" : "notti"}</span>
          <span className="text-faint">·</span><span>{people} {people === 1 ? "ospite" : "ospiti"}</span>
          {tag && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: tagTone, background: `color-mix(in srgb, ${tagTone} 12%, transparent)` }}>{tag}</span>}
        </div>

        {/* Avvisi: le cose da non perdere di vista */}
        {avvisi.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {avvisi.map((a) => (
              <div key={a.key} title={a.title} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold leading-snug" style={{ color: TONE[a.tone], background: `color-mix(in srgb, ${a.tone === "info" ? "var(--faint)" : TONE[a.tone]} 13%, transparent)` }}>
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE[a.tone] }} />
                <span className="min-w-0">{a.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Passaggi */}
        {steps.length > 0 && (
          <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 xl:grid-cols-4">
            {steps.map((s) => <StepButton key={s.key} s={s} onStep={onStep} />)}
          </div>
        )}

        {chips.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {chips.slice(0, 5).map((c) => <Chip key={c.key} c={c} />)}
            {chips.length > 5 && <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-faint">+{chips.length - 5}</span>}
          </div>
        )}
      </div>

      {/* Importi e avanzamento: stessa colonna di Prenotazioni · Dettagliata (totale, incassato, tassa, commissione e netto) */}
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-line pt-2 md:w-72 md:justify-center md:border-l md:border-t-0 md:pl-4 md:pt-0">
        <div className="md:text-right">
          <div className="font-mono text-lg font-bold text-txt">{total ? eur(total) : "—"}{total > 0 && <span className="ml-1.5 font-sans text-[11px] font-normal text-faint">{(b.cleaningFee ?? 0) > 0 || (b.extras ?? []).length > 0 ? "totale" : `soggiorno · ${n} ${n === 1 ? "notte" : "notti"}`}</span>}</div>
        </div>
        <BookingAmounts b={b} structure={structure} />
        {j.total > 0 && (
          <div className="min-w-[110px] md:w-full">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-dim"><span>{j.done} di {j.total}</span><span>{pct}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: anyLate ? "var(--err)" : pct === 100 ? "var(--ok)" : "var(--focus)" }} /></div>
            {!j.next && <div className="mt-1.5 text-[11px] font-semibold md:text-right" style={{ color: "var(--ok)" }}>Tutto in ordine ✓</div>}
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
