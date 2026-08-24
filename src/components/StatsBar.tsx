"use client";

import { useData } from "@/lib/store";
import { toISO } from "@/lib/dates";
import { eur } from "@/lib/format";

const WINDOW = 30;

export default function StatsBar() {
  const { units, bookings } = useData();

  const start = new Date();
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const todayISO = toISO(s);
  const end = new Date(s);
  end.setDate(end.getDate() + WINDOW);
  const endISO = toISO(end);

  const activeUnits = units.filter((u) => !u.outOfService);
  const sellableNights = activeUnits.length * WINDOW;

  let bookedNights = 0;
  let revenue = 0;
  let arrivals = 0;
  let departures = 0;

  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    // notti nella finestra
    for (let d = new Date(s); toISO(d) < endISO; d.setDate(d.getDate() + 1)) {
      const iso = toISO(d);
      if (b.unitId && iso >= b.checkIn && iso < b.checkOut) bookedNights++;
    }
    if (b.total) revenue += b.total;
    if (b.checkIn === todayISO) arrivals++;
    if (b.checkOut === todayISO) departures++;
  }

  const occupancy = sellableNights ? Math.round((bookedNights / sellableNights) * 100) : 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Kpi label="Occupazione (30gg)" value={`${occupancy}%`} color="var(--ok)" />
      <Kpi label="Incassi previsti" value={eur(revenue)} color="var(--txt)" />
      <Kpi label="Arrivi oggi" value={String(arrivals)} color="var(--focus)" />
      <Kpi label="Partenze oggi" value={String(departures)} color="var(--warn)" />
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="anim-in rounded-xl border border-line bg-surface p-4 shadow-sm transition-transform hover:-translate-y-0.5">
      <div className="text-xs font-medium uppercase tracking-wide text-dim">{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
