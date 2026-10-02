"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle, StatCard } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import ImpactPreview from "@/components/ImpactPreview";
import PriceHistoryCard from "@/components/PriceHistoryCard";
import { simulateImpact } from "@/lib/revenue-impact";
import { buildChanges, recordBatches, type PriceBatch } from "@/lib/revenue-history";
import { yoyCompare, lastYearDayOcc, realChannelCommission } from "@/lib/revenue-yoy";
import { CHANNELS, type Channel } from "@/lib/types";
import { useLang } from "@/lib/i18n";
import { inScope } from "@/lib/scope";
import { rateForDay, loadWeekendPct } from "@/lib/pricing";
import { shiftISO, nights, toISO } from "@/lib/dates";
import { fetchCityPulse, computeMarketSignal, revenueSuggestion, pulseHasDemo, MARKET_WINDOW, type MarketPulse } from "@/lib/market";

const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const todayISO = () => toISO(new Date());

// Canali OTA per il confronto "parità": la commissione usata è quella REALE delle tue prenotazioni
// (se registrata); altrimenti l'aliquota di listino del canale, dichiarata come stima.
const COMM_CHANNELS: Channel[] = ["booking", "airbnb", "expedia"];
const MIN_COMM_SAMPLE = 3;
const pctFmt = (x: number) => `${Math.round(x * 100)}%`;

export default function RevenuePage() {
  const { units, bookings, roomTypes, events, rateOverrides, setDayRates, structures, activeStructureId, addActivity } = useData();
  const [preview, setPreview] = useState(false);
  const { user } = useAuth();
  const { t } = useLang();
  const [days] = useState(21);
  const [applied, setApplied] = useState<Set<string>>(new Set()); // giorni già applicati (spunta permanente, per struttura+data)
  const APPLIED_KEY = "spigolestay:revenueapplied";
  useEffect(() => { try { const r = localStorage.getItem(APPLIED_KEY); if (r) setApplied(new Set(JSON.parse(r))); } catch {} }, []);
  const markApplied = (key: string) => setApplied((p) => { const n = new Set(p).add(key); try { localStorage.setItem(APPLIED_KEY, JSON.stringify([...n])); } catch {} return n; });

  const activeUnits = units.filter((u) => !u.outOfService && (activeStructureId === "all" || u.structureId === activeStructureId));
  const totalUnits = activeUnits.length || 1;
  const scopedTypes = roomTypes.filter((rt) => (activeStructureId === "all" || rt.structureId === activeStructureId) && units.some((u) => u.roomTypeId === rt.id && !u.outOfService));

  // ── Benchmark di zona "Rete città" (onesto): struttura di riferimento + i MIEI dati reali. ──
  const struct = useMemo(() => {
    // Con una struttura selezionata il riferimento è SOLO quella (anche senza città: segnale neutro),
    // mai un'altra struttura. Con "Tutte" si usa la prima struttura con città.
    if (activeStructureId !== "all") return structures.find((s) => s.id === activeStructureId);
    return structures.find((s) => (s.city || "").trim()) || structures[0];
  }, [structures, activeStructureId]);
  const city = (struct?.city || "").trim();
  const my = useMemo(() => {
    const sRooms = units.filter((u) => u.structureId === struct?.id && !u.outOfService).length;
    if (!struct || sRooms === 0) return { occ: 0, adr: 0 };
    const mine = bookings.filter((b) => b.structureId === struct.id && b.status !== "cancelled" && b.channel !== "blocked");
    let rt = 0, rs = 0, rev = 0;
    for (let i = 0; i < MARKET_WINDOW; i++) {
      const D = shiftISO(toISO(new Date()), -i);
      const a = mine.filter((b) => b.checkIn <= D && b.checkOut > D);
      rt += sRooms; rs += a.length; rev += a.reduce((s, b) => s + (b.total || 0) / Math.max(1, nights(b.checkIn, b.checkOut)), 0);
    }
    return { occ: rt ? rs / rt : 0, adr: rs ? rev / rs : 0 };
  }, [struct, units, bookings]);
  const [pulse, setPulse] = useState<MarketPulse | null>(null);
  const refreshPulse = useCallback(async () => { setPulse(await fetchCityPulse(supabase, city)); }, [city]);
  useEffect(() => { void refreshPulse(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [city, user?.id]);
  const signal = useMemo(() => computeMarketSignal(my.occ, my.adr, pulse), [my.occ, my.adr, pulse]);

  // Tariffa effettiva per (tipologia, giorno): logica unica (override calendario,
  // altrimenti base effettiva con derivazione + maggiorazione weekend configurabile).
  const rateKey = (typeId: string, iso: string) => `${typeId}|${iso}`;
  const rateForType = (typeId: string, iso: string) => rateForDay(typeId, iso, roomTypes, rateOverrides, loadWeekendPct());
  // Piano di applicazione di una variazione % a tutte le tipologie attive di UN giorno: rispetta il prezzo minimo
  // della tipologia (se impostato in Camere). Scrive SOLO sulle tipologie della struttura selezionata.
  const planDay = (iso: string, pct: number) => scopedTypes.map((rt) => {
    const cur = rateForType(rt.id, iso);
    const next = Math.max(rt.minPrice && rt.minPrice > 0 ? Math.round(rt.minPrice) : 0, Math.max(0, Math.round(cur * (1 + pct / 100))));
    return { rt, iso, cur, next };
  });
  // Applica le variazioni (scrive gli override del calendario) registrando lo storico per "Annulla".
  const applyDays = (list: { iso: string; pct: number }[], label: string) => {
    const drafts = list.filter((x) => x.pct).flatMap((x) => planDay(x.iso, x.pct).map(({ rt, iso, cur, next }) => ({ key: rateKey(rt.id, iso), typeName: rt.name, iso, structureId: rt.structureId, effBefore: cur, after: next })));
    if (!drafts.length) return 0;
    const map: Record<string, number> = {};
    for (const d of drafts) map[d.key] = d.after;
    recordBatches("revenue", label, buildChanges(drafts, rateOverrides));
    setDayRates(map);
    for (const x of list) if (x.pct) markApplied(`${activeStructureId}|${x.iso}`); // resta spuntato anche dopo il refresh: niente doppia applicazione
    return Object.keys(map).length;
  };
  const applyDay = (iso: string, pct: number) => { if (applyDays([{ iso, pct }], `Revenue · ${iso}`)) addActivity("rate", `Revenue: applicata variazione ${pct > 0 ? "+" : ""}${pct}% al ${iso}.`, activeStructureId === "all" ? undefined : activeStructureId); };
  // L'annullamento ripristina le tariffe: tolgo la spunta "Applicato" dai giorni di quell'applicazione.
  const onUndone = (b: PriceBatch) => setApplied((prev) => { const n = new Set(prev); for (const c of b.changes) { n.delete(`${b.structureId}|${c.iso}`); n.delete(`all|${c.iso}`); } try { localStorage.setItem(APPLIED_KEY, JSON.stringify([...n])); } catch {} return n; });

  const rows = useMemo(() => {
    const start = todayISO();
    const out: { iso: string; occ: number; sold: number; hasEvent: boolean; base: number }[] = [];
    // Prezzo base medio delle tipologie attive.
    const rts = roomTypes.filter((rt) => activeStructureId === "all" || rt.structureId === activeStructureId);
    const avgBase = rts.length ? Math.round(rts.reduce((a, rt) => a + rt.basePrice, 0) / rts.length) : 80;
    for (let i = 0; i < days; i++) {
      const iso = addDays(start, i);
      const sold = bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && (activeStructureId === "all" || b.structureId === activeStructureId) && b.checkIn <= iso && b.checkOut > iso).length;
      const hasEvent = events.some((e) => inScope(e.structureId, activeStructureId) && iso >= e.from && iso < e.to);
      // Prezzo attuale = media effettiva per tipologia (include gli override applicati con chiave tipo|iso).
      const base = rts.length ? Math.round(rts.reduce((a, rt) => a + rateForType(rt.id, iso), 0) / rts.length) : avgBase;
      out.push({ iso, occ: sold / totalUnits, sold, hasEvent, base });
    }
    return out;
  }, [bookings, events, roomTypes, rateOverrides, activeStructureId, totalUnits, days]);

  const avgOcc = rows.reduce((a, r) => a + r.occ, 0) / (rows.length || 1);

  // Giorni con un suggerimento ancora da applicare + impatto SIMULATO sulle camere ancora libere
  // (le camere già vendute non cambiano prezzo: l'effetto è solo su quelle libere).
  const pending = useMemo(() => rows.map((r) => ({ iso: r.iso, pct: revenueSuggestion(r.occ, r.hasEvent, signal).pct })).filter((x) => x.pct !== 0 && !applied.has(`${activeStructureId}|${x.iso}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, signal, applied, activeStructureId]);
  const impact = useMemo(() => simulateImpact(pending.flatMap((x) => planDay(x.iso, x.pct).map(({ rt, iso, cur, next }) => ({ typeId: rt.id, iso, current: cur, next }))), bookings, units),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, scopedTypes, rateOverrides, bookings, units]);

  // Confronto con lo stesso periodo dell'anno scorso (prenotazioni reali, 52 settimane prima).
  const yoy = useMemo(() => yoyCompare(bookings, units, activeStructureId, todayISO(), days, todayISO()), [bookings, units, activeStructureId, days]);

  // Commissioni reali per canale (ultimi 12 mesi), con ripiego dichiarato sull'aliquota di listino.
  const commissions = useMemo(() => {
    const since = shiftISO(todayISO(), -365);
    return COMM_CHANNELS.map((ch) => {
      const real = realChannelCommission(bookings, ch, activeStructureId, since);
      const isReal = !!real && real.n >= MIN_COMM_SAMPLE;
      return { ch, label: CHANNELS[ch].label, pct: isReal ? real!.pct : CHANNELS[ch].commission, isReal, n: real?.n ?? 0 };
    });
  }, [bookings, activeStructureId]);
  const avgToday = rows[0]?.base ?? 0;

  if (activeUnits.length === 0) {
    return (
      <div>
        <PageHeader title={t("Revenue · prezzi dinamici")} subtitle={t("Suggerimenti di prezzo in base a occupazione ed eventi")} />
        <Card><EmptyState title="Nessuna camera attiva" sub="Aggiungi camere e tipologie (o rimetti in servizio quelle spente) per vedere occupazione e suggerimenti di prezzo." /></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("Revenue · prezzi dinamici")} subtitle={t("Suggerimenti di prezzo in base a occupazione ed eventi")} />

      {/* Fonti dati: onesto su cosa è reale ora e cosa arriva */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-semibold text-txt" style={{ background: "color-mix(in srgb,var(--ok) 12%,var(--surface))" }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--ok)" }} />{t("Dati tuoi · occupazione reale dalle prenotazioni")}</span>
        {signal.hasZoneData
          ? <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-semibold text-txt" style={{ background: "color-mix(in srgb,var(--focus) 12%,var(--surface))" }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--focus)" }} />{t("Media di zona attiva")}{city ? ` · ${city}` : ""}</span>
          : <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-2.5 py-1 font-medium text-faint">{t("Media di zona (Rete città): in arrivo")}</span>}
        {signal.hasZoneData && pulseHasDemo(pulse) && (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold" style={{ color: "#B45309", background: "color-mix(in srgb,#f59e0b 16%,transparent)" }} title={t("La media di zona include strutture demo dimostrative, non solo concorrenti reali.")}>{t("Include dati dimostrativi")}</span>
        )}
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label={`${t("Occupazione media")} ${days} ${t("gg")}`} value={`${Math.round(avgOcc * 100)}%`} />
        <StatCard label={t("Camere attive")} value={totalUnits} />
        <StatCard label={t("Effetto potenziale sulle camere libere")} value={`${impact.net >= 0 ? "+" : "−"}${eur(Math.abs(impact.net))}`} color={impact.net >= 0 ? "var(--ok)" : "var(--warn)"} hint={`${impact.freeNightRooms} ${t("notti-camera libere, se si vendessero tutte")}`} />
      </div>

      {/* Confronto con lo stesso periodo dell'anno scorso (dati reali) */}
      <Card className="mb-5">
        <SectionTitle>Confronto con l&apos;anno scorso · stessi {days} giorni (52 settimane prima)</SectionTitle>
        {!yoy.hasHistory ? (
          <p className="text-sm text-faint">Nessuna prenotazione registrata per lo stesso periodo dell&apos;anno scorso: il confronto compare appena c&apos;è storico (importa le prenotazioni passate da Importa).</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-paper p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Occupazione già a libro</div>
                <div className="font-mono text-xl font-bold text-txt">{pctFmt(yoy.now.occ)}</div>
                <div className="text-[11px] text-dim">anno scorso a consuntivo {pctFmt(yoy.lastYear.occ)}{yoy.deltaOccPts != null && <b style={{ color: yoy.deltaOccPts >= 0 ? "var(--ok)" : "var(--warn)" }}> ({yoy.deltaOccPts > 0 ? "+" : ""}{yoy.deltaOccPts} pt)</b>}</div>
              </div>
              <div className="rounded-xl border border-line bg-paper p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Alla stessa data dell&apos;anno scorso</div>
                {yoy.lastYearAtSameDate ? (<>
                  <div className="font-mono text-xl font-bold text-txt">{pctFmt(yoy.lastYearAtSameDate.occ)}</div>
                  <div className="text-[11px] text-dim">ritmo di vendita: ora {pctFmt(yoy.now.occ)}{yoy.deltaPaceOccPts != null && <b style={{ color: yoy.deltaPaceOccPts >= 0 ? "var(--ok)" : "var(--warn)" }}> ({yoy.deltaPaceOccPts > 0 ? "+" : ""}{yoy.deltaPaceOccPts} pt)</b>}</div>
                </>) : (<>
                  <div className="font-mono text-xl font-bold text-faint">n/d</div>
                  <div className="text-[11px] text-faint">serve la data di prenotazione su quasi tutte le prenotazioni dell&apos;anno scorso</div>
                </>)}
              </div>
              <div className="rounded-xl border border-line bg-paper p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Prezzo medio a notte (ADR)</div>
                <div className="font-mono text-xl font-bold text-txt">{yoy.now.adr ? eur(Math.round(yoy.now.adr)) : "—"}</div>
                <div className="text-[11px] text-dim">anno scorso {yoy.lastYear.adr ? eur(Math.round(yoy.lastYear.adr)) : "—"}{yoy.deltaAdrPct != null && <b style={{ color: yoy.deltaAdrPct >= 0 ? "var(--ok)" : "var(--warn)" }}> ({yoy.deltaAdrPct > 0 ? "+" : ""}{yoy.deltaAdrPct}%)</b>}</div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-faint">Dalle tue prenotazioni reali (annullate e blocchi esclusi). Si assume lo stesso numero di camere vendibili di oggi; il confronto &quot;alla stessa data&quot; usa la data di prenotazione.</p>
          </>
        )}
      </Card>

      {/* Parità canali & vantaggio diretto */}
      <Card className="mb-5">
        <SectionTitle>{t("Parità canali · vantaggio della prenotazione diretta")}</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          {commissions.map(({ ch, label: name, pct: comm, isReal, n }) => {
            const base = avgToday;
            const lost = Math.round(base * comm);
            return (
              <div key={ch} className="rounded-xl border border-line bg-paper p-3">
                <div className="text-xs font-semibold text-txt">{name} <span className="font-normal text-faint">· {String(Math.round(comm * 1000) / 10).replace(".", ",")}%</span> <span className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={isReal ? { color: "var(--ok)", background: "color-mix(in srgb,var(--ok) 14%,transparent)" } : { color: "#B45309", background: "color-mix(in srgb,#f59e0b 16%,transparent)" }} title={isReal ? `Media reale su ${n} tue prenotazioni degli ultimi 12 mesi` : "Nessuna commissione registrata sulle tue prenotazioni di questo canale: aliquota di listino indicativa"}>{isReal ? `reale · ${n}` : "stima"}</span></div>
                <div className="mt-1 text-[11px] text-dim">{t("Su una notte a")} <span className="font-mono">{eur(base)}</span> {t("perdi")}</div>
                <div className="font-mono text-lg font-bold" style={{ color: "var(--err)" }}>−{eur(lost)}</div>
                <div className="text-[11px] text-faint">{t("che tieni con la prenotazione diretta")}</div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-faint">{t("Mantieni lo stesso prezzo su tutti i canali (parità): il cliente non paga di più, ma sul diretto")} <b className="text-dim">{t("tu incassi la commissione")}</b>. {t("Spingi il motore diretto per risparmiarla.")}</p>
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>{t("Prossimi")} {days} {t("giorni")}</SectionTitle>
          <button onClick={() => setPreview(true)} disabled={pending.length === 0} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Applica tutti i suggerimenti")}{pending.length ? ` (${pending.length})` : ""}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-2 py-2 font-semibold">{t("Giorno")}</th>
                <th className="px-2 py-2 font-semibold">{t("Occupazione")}</th>
                <th className="px-2 py-2 font-semibold" title="Occupazione a consuntivo dello stesso giorno della settimana, 52 settimane prima">Anno scorso</th>
                <th className="px-2 py-2 font-semibold">{t("Prezzo attuale")}</th>
                <th className="px-2 py-2 font-semibold">{t("Suggerimento")}</th>
                <th className="px-2 py-2 font-semibold">{t("Prezzo consigliato")}</th>
                <th className="px-2 py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = revenueSuggestion(r.occ, r.hasEvent, signal);
                const nuovo = Math.round(r.base * (1 + s.pct / 100));
                return (
                  <tr key={r.iso} className="border-b border-line last:border-0">
                    <td className="px-2 py-2 font-medium text-txt">
                      {new Date(r.iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" })}
                      {r.hasEvent && <span className="ml-1.5 rounded bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-focus">{t("evento")}</span>}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full" style={{ width: `${r.occ * 100}%`, backgroundColor: s.color }} /></div>
                        <span className="font-mono text-xs text-dim">{Math.round(r.occ * 100)}%</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-dim">{(() => { const ly = lastYearDayOcc(bookings, units, activeStructureId, r.iso); return ly == null ? <span className="text-faint">—</span> : pctFmt(ly); })()}</td>
                    <td className="px-2 py-2 font-mono text-dim">{eur(r.base)}</td>
                    <td className="px-2 py-2"><span title={s.reasons.join(" · ")} className="cursor-help rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${s.color} 15%, transparent)`, color: s.color }}>{t(s.label)}{s.pct !== 0 ? ` ${s.pct > 0 ? "+" : ""}${s.pct}%` : ""}</span><div className="mt-1 max-w-[260px] text-[10px] leading-snug text-faint">{s.reasons.join(" · ")}</div></td>
                    <td className="px-2 py-2 font-mono font-semibold text-txt">{eur(nuovo)}</td>
                    <td className="px-2 py-2 text-right">
                      {applied.has(`${activeStructureId}|${r.iso}`)
                        ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--ok)]"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>{t("Applicato")}</span>
                        : <button onClick={() => applyDay(r.iso, s.pct)} disabled={s.pct === 0} className="rounded-md border border-line px-2 py-1 text-[11px] font-medium text-dim hover:bg-wash hover:text-focus disabled:opacity-30">{t("Applica")}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-faint">{t("Basati sulla tua occupazione reale ed eventi; con la Rete città attiva entra anche la media di zona (passa sopra al suggerimento per il perché).")} <b className="text-dim">{t("Applica")}</b> {t("scrive la tariffa su tutte le tipologie di quel giorno (modificabile dal Calendario).")}</p>
      </Card>

      <PriceHistoryCard structureId={activeStructureId} sources={["revenue"]} onUndone={onUndone} />

      <ImpactPreview
        open={preview}
        title={`Applica ${pending.length} giorni di suggerimenti`}
        subtitle={activeStructureId !== "all" ? `Solo su ${structures.find((x) => x.id === activeStructureId)?.name ?? "questa struttura"}` : "Su tutte le strutture"}
        impact={impact}
        examples={pending.slice(0, 5).flatMap((x) => planDay(x.iso, x.pct).slice(0, 1).map(({ rt, iso, cur, next }) => ({ label: `${rt.name} · ${new Date(iso + "T00:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" })}`, from: cur, to: next })))}
        notes={["Rispetta il prezzo minimo di ogni tipologia (se impostato in Camere)."]}
        confirmLabel={`Applica ${pending.length} giorni`}
        onConfirm={() => { const n = applyDays(pending, `Revenue · ${pending.length} giorni`); setPreview(false); if (n) addActivity("rate", `Revenue: applicati ${pending.length} giorni di suggerimenti (${n} tariffe).`, activeStructureId === "all" ? undefined : activeStructureId); }}
        onCancel={() => setPreview(false)}
      />
    </div>
  );
}
