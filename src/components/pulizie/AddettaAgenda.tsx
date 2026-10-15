"use client";

// Arrivi, partenze e fermi (ospiti in casa) per i giorni a venire, camera per camera.
import { useEffect, useMemo, useState } from "react";
import type { Booking, Guest, RoomType, Structure, Unit } from "@/lib/types";
import { buildAgenda, WEEKDAY_LONG, isoWeekday } from "@/lib/pulizie-addetta";
import { fmtDMY, parseISO, toISO } from "@/lib/dates";
import { ACT_LABEL, type PlanRoom } from "@/lib/puliziePlan";
import { cleanBar, cleanText, cleanTint } from "@/lib/pulizie-colors";
import Icon from "@/components/Icon";
import { Card, Seg } from "./addetta-ui";

const dm = (iso: string) => fmtDMY(iso).slice(0, 5); // gg.mm

/** Azioni di riga (solo nella pagina Pulizie): segna come fatta e segnala un problema. */
export interface AgendaActions {
  isDone: (date: string, unitId: string) => boolean;
  toggle: (date: string, unitId: string) => void;
  issue: (r: PlanRoom, date: string) => void;
  hasIssue?: (date: string, unitId: string) => boolean;
}

type Flt = "tutte" | "dafare" | "riassetto" | "partenze" | "arrivi";
const FLT_MATCH: Record<Flt, (r: PlanRoom) => boolean> = {
  tutte: () => true,
  dafare: () => true, // l'elenco mostra già solo le camere con qualcosa da fare
  riassetto: (r) => r.action === "riassetto",
  partenze: (r) => r.action === "partenza" || r.action === "turnover",
  arrivi: (r) => r.action === "arrivo" || r.action === "turnover",
};

export default function AddettaAgenda({ structures, units, roomTypes, bookings, guests, cards = false, from, filter, span: spanProp, openAll, actions }: { structures: Structure[]; units: Unit[]; roomTypes: RoomType[]; bookings: Booking[]; guests: Guest[]; cards?: boolean; from?: string; filter?: Flt; span?: "3" | "7" | "14"; openAll?: { open: boolean; n: number }; actions?: AgendaActions }) {
  const today = toISO(new Date());
  const start = from ?? today; // la lista parte dal giorno scelto nella barra della pagina (se c'è)
  const [spanOwn, setSpan] = useState<"3" | "7" | "14">("7");
  const span = spanProp ?? spanOwn; // se la pagina lo passa, 3/7/14 giorni sta nella sua barra dei filtri
  const [open, setOpen] = useState<Record<string, boolean>>({ [start]: true });
  const [fltOwn, setFlt] = useState<Flt>("tutte");
  const flt = filter ?? fltOwn;
  const allDays = useMemo(() => buildAgenda({ from: start, days: Number(span), structures, units, roomTypes, bookings }), [start, span, structures, units, roomTypes, bookings]);
  // con le card in alto, toccarne una filtra l'elenco (di nuovo per toglierla)
  const days = useMemo(() => {
    if (flt === "tutte" || flt === "dafare") return allDays;
    return allDays.map((d) => {
      const rooms = d.rooms.filter(FLT_MATCH[flt]);
      return { ...d, rooms, arrivi: rooms.filter((r) => !!r.arr).length, partenze: rooms.filter((r) => !!r.dep).length, fermi: rooms.filter((r) => r.action === "riassetto").length };
    });
  }, [allDays, flt]);
  const tot = useMemo(() => {
    const all = allDays.flatMap((d) => d.rooms);
    return { dafare: all.length, riassetto: all.filter(FLT_MATCH.riassetto).length, partenze: all.filter(FLT_MATCH.partenze).length, arrivi: all.filter(FLT_MATCH.arrivi).length };
  }, [allDays]);
  const guestName = (id: string) => guests.find((g) => g.id === id)?.fullName || "Ospite";
  const isOpen = (d: string) => open[d] ?? false;
  const allOpen = days.every((d) => isOpen(d.date));
  useEffect(() => { if (openAll && openAll.n > 0) setOpen(Object.fromEntries(days.map((d) => [d.date, openAll.open]))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [openAll?.n]);
  const label = (iso: string) => (iso === today ? "Oggi" : iso === toISO(new Date(parseISO(today).getTime() + 86_400_000)) ? "Domani" : WEEKDAY_LONG[isoWeekday(iso) - 1]);

  const rowText = (r: PlanRoom): string => {
    const pers = (b: Booking) => `${b.adults + b.children} pers.`;
    if (r.dep && r.arr) return `Esce ${guestName(r.dep.guestId)} · entra ${guestName(r.arr.guestId)} (${pers(r.arr)}, fino al ${dm(r.arr.checkOut)})`;
    if (r.arr) return `Entra ${guestName(r.arr.guestId)} (${pers(r.arr)}, fino al ${dm(r.arr.checkOut)})`;
    if (r.dep) return `Esce ${guestName(r.dep.guestId)}`;
    if (r.stay) return `${guestName(r.stay.guestId)} in casa (${pers(r.stay)}, fino al ${dm(r.stay.checkOut)})`;
    return "";
  };

  return (
    <div className="flex flex-col gap-3">
      {cards && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            { key: "dafare", label: "Da fare", count: tot.dafare, color: "var(--txt)" },
            { key: "riassetto", label: "Riassetti", count: tot.riassetto, color: "#0891B2" },
            { key: "partenze", label: "Partenze", count: tot.partenze, color: "var(--err)" },
            { key: "arrivi", label: "Arrivi", count: tot.arrivi, color: "var(--ok)" },
          ] as const).map((c) => {
            const on = flt === c.key;
            return (
              <button key={c.key} onClick={() => setFlt((f) => (f === c.key ? "tutte" : c.key))} aria-pressed={on}
                className={`w-full rounded-xl border bg-surface p-4 text-left shadow-sm transition-transform ${on ? "border-focus ring-2 ring-[color:var(--focus)]" : "border-line"}`}>
                <span className="block text-xs font-medium uppercase tracking-wide text-dim">{c.label}</span>
                <span className="mt-1 block font-mono text-2xl font-bold tabular-nums" style={{ color: c.color }}>{c.count}</span>
              </button>
            );
          })}
        </div>
      )}
      {spanProp === undefined && <div className="flex flex-wrap items-center gap-2">
        <Seg value={span} onChange={setSpan} options={[{ key: "3", label: "3 giorni" }, { key: "7", label: "7 giorni" }, { key: "14", label: "14 giorni" }]} className="w-full sm:w-auto sm:min-w-[16rem]" />
        <button onClick={() => setOpen(Object.fromEntries(days.map((d) => [d.date, !allOpen])))} className="ml-auto min-h-[40px] rounded-lg border border-line px-3 text-xs font-medium text-dim hover:bg-wash">{allOpen ? "Chiudi tutti" : "Apri tutti"}</button>
      </div>}

      {days.map((d) => {
        const empty = d.rooms.length === 0;
        const o = isOpen(d.date);
        return (
          <Card key={d.date} className="overflow-hidden">
            <button onClick={() => setOpen((s) => ({ ...s, [d.date]: !o }))} disabled={empty} className="flex w-full items-center gap-2 px-3 py-3 text-left disabled:cursor-default" aria-expanded={o}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-txt">{label(d.date)} <span className="font-normal text-dim">· {fmtDMY(d.date)}</span></span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                  {empty ? <span className="text-faint">Nessun movimento</span> : (<>
                    <span style={{ color: "var(--ok)" }}>{d.arrivi} {d.arrivi === 1 ? "arrivo" : "arrivi"}</span>
                    <span style={{ color: "var(--err)" }}>{d.partenze} {d.partenze === 1 ? "partenza" : "partenze"}</span>
                    <span style={{ color: "#0891B2" }}>{d.fermi} {d.fermi === 1 ? "fermo" : "fermi"}</span>
                  </>)}
                </span>
              </span>
              {!empty && <span className="shrink-0 text-xs text-dim">{o ? "▲" : "▼"}</span>}
            </button>
            {o && !empty && (
              <div className="border-t border-line">
                {structures.map((s) => {
                  const rs = d.rooms.filter((r) => r.structure.id === s.id);
                  if (!rs.length) return null;
                  return (
                    <div key={s.id}>
                      {structures.length > 1 && <div className="bg-wash px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-faint">{s.name}</div>}
                      {rs.map((r) => (
                        <div key={r.unit.id} className="relative flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-line px-3 py-2 first:border-t-0" title={rowText(r)}>
                          <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: cleanBar(r.action) }} />
                          <span className="w-20 shrink-0 truncate pl-1 font-display text-sm font-bold text-txt">{r.unit.name}</span>
                          <span className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: cleanTint(r.action), color: cleanText(r.action) }}>{ACT_LABEL[r.action]}</span>
                          <span className="min-w-0 basis-full pl-1 text-xs text-dim sm:basis-0 sm:flex-1 sm:truncate sm:pl-0">{rowText(r)}</span>
                          {actions && (() => {
                            const fatta = actions.isDone(d.date, r.unit.id);
                            const prob = actions.hasIssue?.(d.date, r.unit.id);
                            return (
                              <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
                                <button onClick={() => actions.issue(r, d.date)} title="Segnala problema" aria-label="Segnala problema" className={`grid h-8 w-8 place-items-center rounded-md border transition ${prob ? "border-[color:var(--err)] text-[color:var(--err)]" : "border-line text-dim hover:bg-wash"}`}><Icon name="alertTriangle" size={15} /></button>
                                <button onClick={() => actions.toggle(d.date, r.unit.id)} title={fatta ? "Fatta (tocca per annullare)" : "Segna come fatta"} aria-label={fatta ? "Fatta (tocca per annullare)" : "Segna come fatta"} aria-pressed={fatta} className={`grid h-8 w-8 place-items-center rounded-md border transition ${fatta ? "border-transparent bg-[color:var(--ok)] text-white" : "border-line text-dim hover:bg-wash"}`}>
                                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>
                                </button>
                              </span>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
      <p className="text-[11px] text-faint">Arrivo = entra un ospite · Partenza = esce un ospite · Fermo = l&apos;ospite è in casa (riassetto). Le camere senza movimenti non compaiono.</p>
    </div>
  );
}
