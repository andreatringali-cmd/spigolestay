"use client";

// «Altri indicatori»: pickup (prenotazioni ricevute), provenienza degli ospiti, anticipo e durata. Chiusi di norma: i calcoli partono solo quando si aprono.
// Come tutta la Dashboard: prenotazioni in corso e future, stessi numeri di Prenotazioni.
import { useEffect, useId, useMemo, useState } from "react";
import Flag from "@/components/Flag";
import Icon from "@/components/Icon";
import type { Guest } from "@/lib/types";
import { fmtDM } from "@/lib/dates";
import { histogram, LEAD_LABELS, LEAD_UPPER, leadDays, pickupDaily, STAY_LABELS, STAY_UPPER, stayNights, topCountries, type Histo } from "@/lib/dashboard";
import { TONE_TEXT } from "./_kit";

const OPEN_KEY = "xn-dash-altri"; // preferenza per dispositivo: sezione aperta o chiusa
const FLAG_CODE: Record<string, string> = { IT: "it", FR: "fr", DE: "de", ES: "es", GB: "gb" };

type B = { id: string; guestId: string; checkIn: string; checkOut: string; bookedOn?: string };

/** Mini colonne (decorative: i numeri stanno nel testo accanto). */
function MiniBars({ values, height = 40, highlight }: { values: number[]; height?: number; highlight?: (i: number) => boolean }) {
  const max = Math.max(...values, 1);
  return (
    <div aria-hidden className="flex items-end gap-px" style={{ height }}>
      {values.map((v, i) => (
        <div key={i} className="flex h-full min-w-0 flex-1 items-end">
          <div className={`w-full rounded-t-[2px] ${v > 0 ? (!highlight || highlight(i) ? "bg-focus" : "bg-focus/40") : "bg-line-strong"}`} style={{ height: v > 0 ? `${Math.max(8, (v / max) * 100)}%` : 2 }} />
        </div>
      ))}
    </div>
  );
}

function HistoBlock({ title, unit, h, fmtAvg }: { title: string; unit: string; h: Histo; fmtAvg: (n: number) => string }) {
  const peak = h.counts.indexOf(Math.max(...h.counts));
  return (
    <div>
      <p className="flex items-baseline justify-between gap-2 text-xs text-dim">
        <span>{title}, media</span>
        <span><b className="font-display text-base font-bold tabular-nums text-txt">{h.avg !== null ? fmtAvg(h.avg) : "–"}</b> {unit}</span>
      </p>
      <div className="mt-1.5"><MiniBars values={h.counts} height={36} highlight={(i) => i === peak} /></div>
      <div className="mt-0.5 grid text-center text-xs text-dim" style={{ gridTemplateColumns: `repeat(${h.labels.length}, minmax(0, 1fr))`, columnGap: 1 }}>
        {h.labels.map((l, i) => <span key={l} className={i === peak ? "font-semibold text-txt" : ""}>{l}</span>)}
      </div>
      <p className="sr-only">Fascia più frequente: {h.labels[peak]}</p>
    </div>
  );
}

function Dettagli({ list, guests, today }: { list: B[]; guests: Map<string, Guest>; today: string }) {
  const pickup = useMemo(() => pickupDaily(list, today, 30), [list, today]);
  const lead = useMemo(() => histogram(list.map(leadDays).filter((v): v is number => v !== null), LEAD_UPPER, LEAD_LABELS), [list]);
  const stay = useMemo(() => histogram(list.map(stayNights), STAY_UPPER, STAY_LABELS), [list]);
  const countries = useMemo(() => topCountries(list.map((b) => guests.get(b.guestId)?.country), 5), [list, guests]);
  const d = pickup.deltaPct;
  return (
    <div className="grid gap-x-8 gap-y-5 border-t border-line px-3 py-3 lg:grid-cols-3">
      <div>
        <h3 className="mb-1.5 text-xs font-semibold text-txt">Prenotazioni ricevute, ultimi 30 giorni</h3>
        {pickup.total === 0 ? <p className="text-xs text-dim">Nessuna prenotazione ricevuta.</p> : (
          <>
            <p className="flex flex-wrap items-baseline gap-x-3 text-xs text-dim">
              <b className="font-display text-xl font-bold tabular-nums text-txt">{pickup.total}</b>
              <span><b className="font-mono font-semibold text-txt">{pickup.last7}</b> negli ultimi 7 giorni</span>
              {d !== null && <span className={`font-medium ${d >= 0 ? TONE_TEXT.ok : TONE_TEXT.dim}`} title="Ultimi 7 giorni contro i 7 precedenti">{d >= 0 ? "+" : "−"}{Math.abs(d)}% sui 7 giorni prima</span>}
            </p>
            <div className="mt-2"><MiniBars values={pickup.days.map((x) => x.count)} height={44} highlight={(i) => i >= pickup.days.length - 7} /></div>
            <p className="mt-0.5 flex justify-between text-xs text-dim"><span>{fmtDM(pickup.days[0].iso)}</span><span>oggi</span></p>
          </>
        )}
      </div>
      <div>
        <h3 className="mb-1.5 text-xs font-semibold text-txt">Provenienza degli ospiti</h3>
        {countries.rows.length === 0 ? <p className="text-xs text-dim">Nessun Paese indicato.</p> : (
          <ul className="space-y-1.5">
            {countries.rows.map((r) => (
              <li key={r.code} className="flex items-center gap-2" title={`${r.name}: ${r.count} ${r.count === 1 ? "prenotazione" : "prenotazioni"}`}>
                {FLAG_CODE[r.code] ? <Flag code={FLAG_CODE[r.code]} className="h-4 w-6 shrink-0" /> : <span className="grid h-4 w-6 shrink-0 place-items-center rounded-[2px] bg-wash text-[11px] font-semibold leading-none text-dim">{r.code}</span>}
                <span className="w-24 shrink-0 truncate text-xs font-medium text-txt">{r.name}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-wash" aria-hidden><span className="block h-full rounded-full bg-focus" style={{ width: `${(r.count / (countries.rows[0]?.count || 1)) * 100}%` }} /></span>
                <span className="w-9 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-txt">{r.share}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-txt">Anticipo e durata</h3>
        {lead.total > 0 && <HistoBlock title="Anticipo" unit="giorni" h={lead} fmtAvg={(v) => String(Math.round(v))} />}
        {stay.total > 0 && <HistoBlock title="Durata" unit="notti" h={stay} fmtAvg={(v) => (Math.round(v * 10) / 10).toString().replace(".", ",")} />}
        {lead.total === 0 && stay.total === 0 && <p className="text-xs text-dim">Nessun dato.</p>}
      </div>
    </div>
  );
}

export default function Altri({ list, guests, today }: { list: B[]; guests: Map<string, Guest>; today: string }) {
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { setOpen(localStorage.getItem(OPEN_KEY) === "1"); } catch { /* nessuna preferenza salvata */ } }, []);
  const hid = useId(), pid = useId();
  const toggle = () => { setOpen((v) => { const n = !v; try { localStorage.setItem(OPEN_KEY, n ? "1" : "0"); } catch { /* preferenza non salvata: resta per questa sessione */ } return n; }); };
  return (
    <section aria-labelledby={hid} className="rounded-[var(--r-lg)] border border-line bg-surface">
      <h2 id={hid}>
        <button type="button" aria-expanded={open} aria-controls={pid} onClick={toggle} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--r-lg)] px-3 py-1.5 text-left hover:bg-wash">
          <span className="min-w-0 truncate text-sm font-semibold text-txt">Altri indicatori <span className="font-normal text-dim max-sm:hidden">· pickup, provenienza, anticipo e durata</span></span>
          <span aria-hidden className={`shrink-0 text-dim transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}><Icon name="chevron" size={14} /></span>
        </button>
      </h2>
      <div id={pid}>{open && <Dettagli list={list} guests={guests} today={today} />}</div>
    </section>
  );
}
