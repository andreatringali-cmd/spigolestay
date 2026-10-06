"use client";

// Colonna laterale: calendario dei prossimi 7 giorni (scadenze e arrivi) e cronologia degli ultimi invii.
import Icon from "@/components/Icon";
import { ENTE_META, nWord, plural, type CalDay, type Ente, type TimelineEntry } from "@/lib/adempimenti2";
import { whenLabel } from "@/lib/guest-messages";
import { EmptyLine, IconTile, tint } from "../_ui";
import { Panel, URG_COLOR } from "./_kit";

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-display text-base font-bold leading-tight tracking-tight text-txt">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-faint">{sub}</p>}
    </div>
  );
}

// ───────────── Calendario ─────────────
export function Calendario({ days, loading }: { days: CalDay[]; loading: boolean }) {
  const quiet = days.every((d) => d.due === 0 && d.arrivals === 0);
  return (
    <Panel className="p-4 sm:p-5" delay={120} label="Prossimi sette giorni">
      <Head title="Prossimi 7 giorni" sub="Scadenze e arrivi, giorno per giorno" />
      {loading ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-11 rounded-xl bg-wash motion-safe:animate-pulse" style={{ opacity: 0.7 - i * 0.12 }} />)}</div>
      ) : quiet ? (
        <EmptyLine icon="calendar">Nessuna scadenza né arrivo nei prossimi giorni.</EmptyLine>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {days.map((d) => {
            const c = d.late > 0 ? URG_COLOR.late : d.isToday ? URG_COLOR.today : URG_COLOR.soon;
            const tags = (Object.entries(d.byEnte) as [Ente, number][]).map(([e, n]) => `${ENTE_META[e].short} ${n}`);
            const arr = d.arrivals > 0 ? `${nWord(d.arrivals, "arrivo", "arrivi")}${d.arrivalsMissing > 0 ? ` · ${d.arrivalsMissing} senza check-in` : " · check-in completi"}` : "";
            const empty = d.due === 0 && d.arrivals === 0;
            return (
              <li key={d.iso} className={`flex items-center gap-3 rounded-xl px-2 py-2 ${d.isToday ? "bg-wash" : ""}`}>
                <div className="w-11 shrink-0 rounded-lg py-1 text-center" style={d.isToday ? { backgroundColor: tint("var(--focus)", 14), color: "var(--focus)" } : { color: "var(--dim)" }}>
                  <div className="text-[10px] font-semibold uppercase leading-none tracking-wide">{d.dow}</div>
                  <div className="mt-0.5 font-display text-lg font-bold leading-none tabular-nums">{Number(d.iso.slice(8, 10))}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-txt">{d.label}</div>
                  <div className="break-words text-xs text-faint">{empty ? "Niente in programma" : [tags.join(" · "), arr].filter(Boolean).join(" · ")}</div>
                </div>
                {d.due > 0 && <span className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums" style={{ backgroundColor: tint(c, 14), color: c }} title={`${d.due} ${plural(d.due, "scadenza", "scadenze")}${d.late > 0 ? `, di cui ${d.late} in ritardo` : ""}`}>{d.due}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-faint">Gli arrivi dei giorni futuri mostrano il check-in; le altre scadenze compaiono quando maturano.</p>
    </Panel>
  );
}

// ───────────── Cronologia ─────────────
export function Cronologia({ entries, structOf, nameOf, loading }: { entries: TimelineEntry[]; structOf: (id?: string | null) => string | undefined; nameOf: (bookingId?: string) => string | undefined; loading: boolean }) {
  return (
    <Panel className="p-4 sm:p-5" delay={180} label="Ultimi invii">
      <Head title="Ultimi invii" sub="Schedine alla Questura e solleciti agli ospiti" />
      {loading ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-11 rounded-xl bg-wash motion-safe:animate-pulse" style={{ opacity: 0.7 - i * 0.15 }} />)}</div>
      ) : entries.length === 0 ? (
        <EmptyLine icon="clock">Nessun invio recente.</EmptyLine>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {entries.slice(0, 6).map((e) => {
            const col = e.ok === false ? "var(--err)" : e.kind === "questura" ? "var(--ok)" : "var(--focus)";
            const who = e.kind === "questura" ? structOf(e.structureId) : nameOf(e.bookingId);
            return (
              <li key={e.id} className="flex items-start gap-3 rounded-xl px-2 py-2">
                <IconTile icon={e.ok === false ? "alertTriangle" : e.kind === "questura" ? "shield" : "chat"} color={col} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="break-words text-[13px] font-semibold leading-snug text-txt">{e.title}</div>
                  <div className="break-words text-xs text-faint">{[who, e.detail].filter(Boolean).join(" · ")}</div>
                </div>
                <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-faint"><Icon name="clock" size={10} /> {whenLabel(e.ts)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
