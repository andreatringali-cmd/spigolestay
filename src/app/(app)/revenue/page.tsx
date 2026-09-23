"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle, StatCard } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { rateForDay, loadWeekendPct } from "@/lib/pricing";

const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const todayISO = () => new Date().toISOString().slice(0, 10);

// Suggerimento prezzo in base a occupazione + eventi.
function suggest(occ: number, hasEvent: boolean): { pct: number; label: string; color: string } {
  if (occ >= 0.85) return { pct: 25, label: "Alza forte", color: "var(--err)" };
  if (occ >= 0.65 || hasEvent) return { pct: 12, label: "Alza", color: "#D97706" };
  if (occ >= 0.35) return { pct: 0, label: "Mantieni", color: "var(--ok)" };
  return { pct: -12, label: "Abbassa", color: "#2563EB" };
}

const CHANNEL_COMM: [string, number][] = [["Booking.com", 0.15], ["Airbnb", 0.15], ["Expedia/Vrbo", 0.18]];

export default function RevenuePage() {
  const { units, bookings, roomTypes, events, rateOverrides, setDayRates, activeStructureId } = useData();
  const { t } = useLang();
  const [days] = useState(21);
  const [applied, setApplied] = useState<Set<string>>(new Set()); // giorni già applicati (spunta permanente, per struttura+data)
  const APPLIED_KEY = "spigolestay:revenueapplied";
  useEffect(() => { try { const r = localStorage.getItem(APPLIED_KEY); if (r) setApplied(new Set(JSON.parse(r))); } catch {} }, []);
  const markApplied = (key: string) => setApplied((p) => { const n = new Set(p).add(key); try { localStorage.setItem(APPLIED_KEY, JSON.stringify([...n])); } catch {} return n; });

  const activeUnits = units.filter((u) => !u.outOfService && (activeStructureId === "all" || u.structureId === activeStructureId));
  const totalUnits = activeUnits.length || 1;
  const scopedTypes = roomTypes.filter((rt) => (activeStructureId === "all" || rt.structureId === activeStructureId) && units.some((u) => u.roomTypeId === rt.id && !u.outOfService));

  // Tariffa effettiva per (tipologia, giorno): logica unica (override calendario,
  // altrimenti base effettiva con derivazione + maggiorazione weekend configurabile).
  const rateKey = (typeId: string, iso: string) => `${typeId}|${iso}`;
  const rateForType = (typeId: string, iso: string) => rateForDay(typeId, iso, roomTypes, rateOverrides, loadWeekendPct());
  // Applica una variazione % a tutte le tipologie attive per un giorno (scrive gli override del calendario).
  const applyDay = (iso: string, pct: number) => {
    if (!pct) return;
    const map: Record<string, number> = {};
    for (const rt of scopedTypes) map[rateKey(rt.id, iso)] = Math.max(0, Math.round(rateForType(rt.id, iso) * (1 + pct / 100)));
    setDayRates(map);
    markApplied(`${activeStructureId}|${iso}`); // resta spuntato anche dopo il refresh: niente doppia applicazione
  };

  const rows = useMemo(() => {
    const start = todayISO();
    const out: { iso: string; occ: number; sold: number; hasEvent: boolean; base: number }[] = [];
    // Prezzo base medio delle tipologie attive.
    const rts = roomTypes.filter((rt) => activeStructureId === "all" || rt.structureId === activeStructureId);
    const avgBase = rts.length ? Math.round(rts.reduce((a, rt) => a + rt.basePrice, 0) / rts.length) : 80;
    for (let i = 0; i < days; i++) {
      const iso = addDays(start, i);
      const sold = bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && (activeStructureId === "all" || b.structureId === activeStructureId) && b.checkIn <= iso && b.checkOut > iso).length;
      const hasEvent = events.some((e) => iso >= e.from && iso < e.to);
      // Prezzo attuale = media effettiva per tipologia (include gli override applicati con chiave tipo|iso).
      const base = rts.length ? Math.round(rts.reduce((a, rt) => a + rateForType(rt.id, iso), 0) / rts.length) : avgBase;
      out.push({ iso, occ: sold / totalUnits, sold, hasEvent, base });
    }
    return out;
  }, [bookings, events, roomTypes, rateOverrides, activeStructureId, totalUnits, days]);

  const avgOcc = rows.reduce((a, r) => a + r.occ, 0) / (rows.length || 1);
  const upside = rows.reduce((a, r) => { const s = suggest(r.occ, r.hasEvent); return a + Math.round(r.base * (s.pct / 100)) * r.sold; }, 0);

  return (
    <div>
      <PageHeader title={t("Revenue · prezzi dinamici")} subtitle={t("Suggerimenti di prezzo in base a occupazione ed eventi")} />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label={`${t("Occupazione media")} ${days} ${t("gg")}`} value={`${Math.round(avgOcc * 100)}%`} />
        <StatCard label={t("Camere attive")} value={totalUnits} />
        <StatCard label={t("Ricavo extra potenziale")} value={eur(Math.max(0, upside))} color="var(--ok)" hint={t("applicando i suggerimenti")} />
      </div>

      {/* Parità canali & vantaggio diretto */}
      <Card className="mb-5">
        <SectionTitle>{t("Parità canali · vantaggio della prenotazione diretta")}</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          {CHANNEL_COMM.map(([name, comm]) => {
            const base = scopedTypes.length ? Math.round(scopedTypes.reduce((a, rt) => a + rt.basePrice, 0) / scopedTypes.length) : 80;
            const lost = Math.round(base * comm);
            return (
              <div key={name} className="rounded-xl border border-line bg-paper p-3">
                <div className="text-xs font-semibold text-txt">{name} <span className="font-normal text-faint">· {Math.round(comm * 100)}%</span></div>
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
          <button onClick={() => rows.forEach((r) => applyDay(r.iso, suggest(r.occ, r.hasEvent).pct))} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">{t("Applica tutti i suggerimenti")}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-2 py-2 font-semibold">{t("Giorno")}</th>
                <th className="px-2 py-2 font-semibold">{t("Occupazione")}</th>
                <th className="px-2 py-2 font-semibold">{t("Prezzo attuale")}</th>
                <th className="px-2 py-2 font-semibold">{t("Suggerimento")}</th>
                <th className="px-2 py-2 font-semibold">{t("Prezzo consigliato")}</th>
                <th className="px-2 py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = suggest(r.occ, r.hasEvent);
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
                    <td className="px-2 py-2 font-mono text-dim">{eur(r.base)}</td>
                    <td className="px-2 py-2"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${s.color} 15%, transparent)`, color: s.color }}>{t(s.label)}{s.pct !== 0 ? ` ${s.pct > 0 ? "+" : ""}${s.pct}%` : ""}</span></td>
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
        <p className="mt-3 text-xs text-faint">{t("I suggerimenti sono indicativi: alta occupazione o eventi in città → alza; bassa occupazione → abbassa per riempire.")} <b className="text-dim">{t("Applica")}</b> {t("scrive la tariffa su tutte le tipologie di quel giorno (modificabile dal Calendario).")}</p>
      </Card>
    </div>
  );
}
