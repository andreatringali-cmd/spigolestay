"use client";

// Camere · Dettagliata, versione sobria: una scheda per camera nello stesso linguaggio delle schede Prenotazioni
// (targa col numero, pillola di stato tenue, dati in chiaro, colonna a destra con tariffa e occupazione).
// Nessuna anteprima, nessun avviso e nessun pulsante: toccando la scheda si apre la modifica della camera.
import { useMemo } from "react";
import { useData } from "@/lib/store";
import type { Booking, RoomType, Unit } from "@/lib/types";
import { toISO } from "@/lib/dates";
import { eur } from "@/lib/format";
import { occupies } from "@/app/(app)/calendario/_modello";
import { snapshotOf, TONE_VAR, dayLabel, type Snapshot } from "./_modello";

/** Stato di oggi, prossimo arrivo e occupazione di ogni camera (una sola passata sulle prenotazioni). */
export function useSnapshots(): Map<string, Snapshot> {
  const { bookings, guests, units } = useData();
  return useMemo(() => {
    const today = toISO(new Date());
    const gname = new Map(guests.map((g) => [g.id, g.fullName]));
    const name = (b: Booking) => gname.get(b.guestId) || [b.primaryGuest?.firstName, b.primaryGuest?.lastName].filter(Boolean).join(" ") || "Ospite";
    const by = new Map<string, Booking[]>();
    for (const b of bookings) if (b.unitId && occupies(b)) (by.get(b.unitId) ?? by.set(b.unitId, []).get(b.unitId)!).push(b);
    return new Map(units.map((u) => [u.id, snapshotOf(u, by.get(u.id) ?? [], today, name)]));
  }, [bookings, guests, units]);
}

const MAX_AMENITIES = 4;

export default function SchedaCamera({ u, rt, color, snap, onEdit }: { u: Unit; rt?: RoomType; color: string; snap?: Snapshot; onEdit: () => void }) {
  const num = u.name.replace(/^camera\s*/i, "");
  const tone = snap ? TONE_VAR[snap.stato.tone] : "var(--dim)";
  const size = u.size ?? rt?.size;
  const bedCfg = u.bedConfig || rt?.bedConfig;
  const facts = [u.floor ? `Piano ${u.floor}` : "", u.view || "", bedCfg || (rt?.beds ? `${rt.beds} posti letto` : ""), size ? `${size} m²` : ""].filter(Boolean);
  const amen = (u.amenities?.length ? u.amenities : rt?.amenities) ?? [];

  return (
    <article role="button" tabIndex={0} onClick={onEdit} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit(); } }}
      className="group flex cursor-pointer flex-col gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm transition hover:border-focus hover:shadow-md focus-visible:border-focus focus-visible:outline-none md:flex-row md:items-center md:gap-4">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg text-base font-bold" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>{num}</div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="font-display text-base font-bold text-txt">{u.name}</h3>
          {u.code && <span className="font-mono text-[11px] text-faint">{u.code}</span>}
          {snap && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: tone, background: `color-mix(in srgb, ${tone} 13%, transparent)` }}>{snap.stato.label}</span>}
          {snap?.stato.detail && snap.stato.kind !== "oos" && <span className="text-xs text-dim">{snap.stato.detail}</span>}
        </div>
        {snap?.stato.kind === "oos" && snap.stato.detail && <div className="mt-0.5 text-xs text-dim">{snap.stato.detail}</div>}
        {facts.length > 0 && <div className="mt-1 text-xs text-dim">{facts.join(" · ")}</div>}
        {amen.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {amen.slice(0, MAX_AMENITIES).map((a) => <span key={a} className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-dim">{a}</span>)}
            {amen.length > MAX_AMENITIES && <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-faint">+{amen.length - MAX_AMENITIES}</span>}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-t border-line pt-2 md:w-64 md:border-l md:border-t-0 md:pl-4 md:pt-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-faint">Tariffa base</span>
          <span className="font-mono text-base font-bold text-txt">{rt ? eur(rt.basePrice) : "—"}<span className="ml-0.5 font-sans text-[11px] font-normal text-faint">/notte</span></span>
        </div>
        {snap && (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-dim"><span>Prossimi 30 giorni</span><span className="font-semibold">{snap.occ30n}/30 notti</span></div>
            <div className="flex h-1.5 gap-px overflow-hidden rounded-full bg-wash">
              {snap.occ30.map((o, i) => <span key={i} className="h-full flex-1" style={{ background: o === "b" ? "var(--focus)" : o === "x" ? "var(--faint)" : "transparent" }} />)}
            </div>
          </div>
        )}
        {snap?.next && <div className="truncate text-[11px] text-dim">Prossimo arrivo: <span className="font-medium capitalize text-txt">{dayLabel(snap.next.checkIn)}</span>{snap.nextGuest ? ` · ${snap.nextGuest}` : ""}</div>}
      </div>
    </article>
  );
}
