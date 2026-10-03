"use client";

// Sezione "Camere libere" e "Fuori servizio / blocchi" della vista Calendario · Dettagliato.
import type { Booking, RoomType, Structure, Unit } from "@/lib/types";
import { parseISO } from "@/lib/dates";
import type { FreeUnit } from "./_modello";

const dayShort = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });

function Thumb({ unit, roomType, structure }: { unit: Unit; roomType?: RoomType; structure?: Structure }) {
  const photo = unit.photos?.[0];
  const tint = roomType?.color || structure?.photoColor || "var(--focus)";
  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl" style={photo ? undefined : { background: `linear-gradient(145deg, color-mix(in srgb, ${tint} 85%, #fff), color-mix(in srgb, ${tint} 70%, #000))` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />}
    </div>
  );
}

export function CameraLibera({ f, roomType, structure, showStructure, guestName, weekMode, onNew }: {
  f: FreeUnit;
  roomType?: RoomType;
  structure?: Structure;
  showStructure: boolean;
  guestName: (b: Booking) => string;
  weekMode: boolean;
  onNew: () => void;
}) {
  const { unit, next, departing } = f;
  const nextIsBlock = next?.channel === "blocked";
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm">
      <Thumb unit={unit} roomType={roomType} structure={structure} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <h3 className="min-w-0 truncate text-base font-bold text-txt">{unit.name}</h3>
          {showStructure && structure && <span className="truncate text-[11px] font-semibold text-faint">{structure.name}</span>}
        </div>
        <div className="truncate text-xs text-dim">{roomType?.name ?? "—"}</div>
        <div className="mt-1 text-xs text-dim">
          {next
            ? <>{nextIsBlock ? "Blocco dal" : "Prossimo arrivo"} <b className="font-semibold capitalize text-txt">{dayShort(next.checkIn)}</b>{!nextIsBlock && guestName(next) ? <> · {guestName(next)}</> : null}{nextIsBlock && next.note ? <> · {next.note}</> : null}</>
            : <span className="text-faint">Nessun arrivo previsto</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {weekMode && <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-semibold text-dim">Libera {f.freeNights} {f.freeNights === 1 ? "notte" : "notti"} su {f.totalNights}</span>}
          {departing && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 14%, transparent)" }} title={guestName(departing)}>Partenza il giorno stesso: da pulire</span>}
          <button onClick={onNew} className="ml-auto rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-focus transition hover:border-focus hover:bg-wash">
            + Nuova prenotazione{weekMode ? ` · ${dayShort(f.firstFree)}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

export function BloccoRiga({ b, unit, roomType, structure, showStructure, onOpen }: {
  b: Booking; unit?: Unit; roomType?: RoomType; structure?: Structure; showStructure: boolean; onOpen: () => void;
}) {
  return (
    <button onClick={onOpen} className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-surface p-2.5 text-left shadow-sm transition hover:border-focus">
      {unit ? <Thumb unit={unit} roomType={roomType} structure={structure} /> : <div className="h-16 w-16 shrink-0 rounded-xl bg-wash" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-txt">{unit?.name ?? "Camera"} <span className="font-medium text-dim">· Blocco</span></div>
        <div className="text-xs text-dim"><span className="capitalize">{dayShort(b.checkIn)}</span> → <span className="capitalize">{dayShort(b.checkOut)}</span></div>
        {(b.note || showStructure) && <div className="truncate text-[11px] text-faint">{[showStructure ? structure?.name : "", b.note].filter(Boolean).join(" · ")}</div>}
      </div>
    </button>
  );
}

export function FuoriServizioRiga({ unit, roomType, structure, showStructure }: { unit: Unit; roomType?: RoomType; structure?: Structure; showStructure: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-surface p-2.5 shadow-sm">
      <Thumb unit={unit} roomType={roomType} structure={structure} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-txt">{unit.name} <span className="font-medium" style={{ color: "var(--err)" }}>· Fuori servizio</span></div>
        <div className="truncate text-xs text-dim">{unit.oosReason || "Nessun motivo indicato"}</div>
        {showStructure && structure && <div className="truncate text-[11px] text-faint">{structure.name}</div>}
      </div>
    </div>
  );
}
