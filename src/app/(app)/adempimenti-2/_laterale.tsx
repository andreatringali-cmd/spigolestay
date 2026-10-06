"use client";

// Colonna laterale (stretta): calendario dei prossimi 7 giorni, una riga per giorno, e ultimi invii, una riga per invio.
import Icon from "@/components/Icon";
import { ENTE_META, nWord, plural, type CalDay, type Ente, type TimelineEntry } from "@/lib/adempimenti2";
import { whenLabel } from "@/lib/guest-messages";
import { EmptyLine, tint } from "../_ui";
import { Panel, URG_COLOR } from "./_kit";

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline gap-2 px-1">
      <h2 className="font-display text-sm font-bold leading-tight tracking-tight text-txt">{title}</h2>
      {sub && <span className="truncate text-[11px] text-faint">{sub}</span>}
    </div>
  );
}

// ───────────── Calendario ─────────────
export function Calendario({ days, loading }: { days: CalDay[]; loading: boolean }) {
  const quiet = days.every((d) => d.due === 0 && d.arrivals === 0);
  return (
    <Panel className="p-2.5" delay={90} label="Prossimi sette giorni">
      <Head title="Prossimi 7 giorni" sub="scadenze e arrivi" />
      {loading ? (
        <div className="space-y-1" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-8 rounded-lg bg-wash motion-safe:animate-pulse" style={{ opacity: 0.7 - i * 0.12 }} />)}</div>
      ) : quiet ? (
        <EmptyLine icon="calendar">Niente in programma.</EmptyLine>
      ) : (
        <ul className="flex flex-col" title="Gli arrivi dei giorni futuri mostrano il check-in; le altre scadenze compaiono quando maturano.">
          {days.map((d) => {
            const c = d.late > 0 ? URG_COLOR.late : d.isToday ? URG_COLOR.today : URG_COLOR.soon;
            const tags = (Object.entries(d.byEnte) as [Ente, number][]).map(([e, n]) => `${ENTE_META[e].short} ${n}`).join(", ");
            const arr = d.arrivals > 0 ? `${nWord(d.arrivals, "arrivo", "arrivi")}${d.arrivalsMissing > 0 ? `, ${d.arrivalsMissing} senza check-in` : ""}` : "";
            const text = [tags, arr].filter(Boolean).join(" · ");
            return (
              <li key={d.iso} className={`flex items-center gap-2 rounded-lg px-1.5 py-1 ${d.isToday ? "bg-wash" : ""}`} title={text || undefined}>
                <span className="w-9 shrink-0 text-center leading-none" style={d.isToday ? { color: "var(--focus)" } : { color: "var(--dim)" }}>
                  <span className="block text-[9px] font-semibold uppercase tracking-wide">{d.dow}</span>
                  <span className="block font-display text-[15px] font-bold tabular-nums">{Number(d.iso.slice(8, 10))}</span>
                </span>
                <span className={`min-w-0 flex-1 truncate text-[11.5px] ${text ? "text-dim" : "text-faint"}`}>{text || "Niente in programma"}</span>
                {d.due > 0 && <span className="shrink-0 rounded-full px-1.5 py-px font-mono text-[10px] font-bold tabular-nums" style={{ backgroundColor: tint(c, 14), color: c }} title={`${d.due} ${plural(d.due, "scadenza", "scadenze")}${d.late > 0 ? `, di cui ${d.late} in ritardo` : ""}`}>{d.due}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ───────────── Cronologia ─────────────
export function Cronologia({ entries, structOf, nameOf, loading }: { entries: TimelineEntry[]; structOf: (id?: string | null) => string | undefined; nameOf: (bookingId?: string) => string | undefined; loading: boolean }) {
  return (
    <Panel className="p-2.5" delay={140} label="Ultimi invii">
      <Head title="Ultimi invii" sub="Questura e solleciti" />
      {loading ? (
        <div className="space-y-1" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded-lg bg-wash motion-safe:animate-pulse" style={{ opacity: 0.7 - i * 0.15 }} />)}</div>
      ) : entries.length === 0 ? (
        <EmptyLine icon="clock">Nessun invio recente.</EmptyLine>
      ) : (
        <ul className="flex flex-col">
          {entries.slice(0, 5).map((e) => {
            const col = e.ok === false ? "var(--err)" : e.kind === "questura" ? "var(--ok)" : "var(--focus)";
            const who = e.kind === "questura" ? structOf(e.structureId) : nameOf(e.bookingId);
            return (
              <li key={e.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5" title={[e.title, who, e.detail].filter(Boolean).join(" · ")}>
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ backgroundColor: tint(col, 14), color: col }}><Icon name={e.ok === false ? "alertTriangle" : e.kind === "questura" ? "shield" : "chat"} size={11} /></span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] leading-tight"><span className="font-semibold text-txt">{e.title}</span>{who && <span className="text-faint"> · {who}</span>}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-faint">{whenLabel(e.ts)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
