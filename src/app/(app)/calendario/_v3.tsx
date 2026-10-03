"use client";

// Calendario v3: la griglia classica e, sotto, le prenotazioni del giorno scelto in righe alte (stile Prenotazioni · Dettagliata)
// divise per categoria: Arrivi, In casa, Partenze.
import { useMemo, useState } from "react";
import CalendarGrid from "@/components/CalendarGrid";
import { useData } from "@/lib/store";
import { addDays, parseISO, toISO } from "@/lib/dates";
import { isLiveBooking } from "@/lib/booking-journey";
import { inScope } from "@/lib/scope";
import PrenotazioniDettaglio, { type DettaglioSection } from "../prenotazioni/_dettaglio";
import type { Booking } from "@/lib/types";

export default function CalendarioV3() {
  const { bookings, guests, units, roomTypes, activeStructureId } = useData();
  const todayIso = toISO(new Date());
  const [day, setDay] = useState(todayIso);

  const guestName = (b: Booking) => {
    const g = guests.find((x) => x.id === b.guestId);
    if (g?.fullName?.trim()) return g.fullName.trim();
    const p = b.primaryGuest;
    return p && (p.firstName || p.lastName) ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : "";
  };
  const unitLabel = (b: Booking): string | null => {
    const u = units.find((x) => x.id === b.unitId);
    if (!u) return null;
    const rt = roomTypes.find((r) => r.id === u.roomTypeId);
    const num = u.name.replace(/^camera\s*/i, "");
    return rt ? `${rt.name} · ${num}` : num;
  };

  const { all, sections } = useMemo(() => {
    const live = bookings.filter((b) => isLiveBooking(b) && inScope(b.structureId, activeStructureId));
    const arr = live.filter((b) => b.checkIn === day);
    const stay = live.filter((b) => b.checkIn < day && day < b.checkOut);
    const dep = live.filter((b) => b.checkOut === day);
    const secs: DettaglioSection[] = [
      { key: "arr", title: "Arrivi", color: "var(--ok)", ids: arr.map((b) => b.id), empty: "Nessun arrivo in questa giornata." },
      { key: "stay", title: "In casa", color: "var(--focus)", ids: stay.map((b) => b.id), empty: "Nessun ospite in casa (oltre agli arrivi e alle partenze del giorno)." },
      { key: "dep", title: "Partenze", color: "var(--warn)", ids: dep.map((b) => b.id), empty: "Nessuna partenza in questa giornata." },
    ];
    const seen = new Set<string>();
    const union = [...arr, ...stay, ...dep].filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
    return { all: union, sections: secs };
  }, [bookings, activeStructureId, day]);

  const label = parseISO(day).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const nav = "grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-dim transition hover:border-focus hover:text-focus";
  return (
    <div>
      <CalendarGrid />
      <div className="mt-6 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3 shadow-sm">
        <button onClick={() => setDay(toISO(addDays(parseISO(day), -1)))} className={nav} aria-label="Giorno precedente" title="Giorno precedente">‹</button>
        <button onClick={() => setDay(toISO(addDays(parseISO(day), 1)))} className={nav} aria-label="Giorno successivo" title="Giorno successivo">›</button>
        <button onClick={() => setDay(todayIso)} disabled={day === todayIso} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-txt transition hover:border-focus hover:text-focus disabled:opacity-50">Oggi</button>
        <div className="min-w-0 flex-1 truncate font-display text-sm font-bold capitalize text-txt sm:text-base">{label}</div>
        <input type="date" value={day} onChange={(e) => { if (e.target.value) setDay(e.target.value); }} aria-label="Vai alla data" className="h-8 w-[130px] rounded-lg border border-line bg-paper px-2 text-xs text-txt outline-none focus:border-focus" />
      </div>
      <PrenotazioniDettaglio bookings={all} guestName={guestName} unitLabel={unitLabel} showStructure={activeStructureId === "all"} sections={sections} />
    </div>
  );
}
