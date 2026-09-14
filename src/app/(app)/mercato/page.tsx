"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";
import { toISO, shiftISO, nights } from "@/lib/dates";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { useConfirm } from "@/components/ConfirmProvider";

const WINDOW = 90;   // giorni di storico
const FUTURE = 30;   // giorni futuri per il motore prezzi
const THRESHOLD = 3; // soglia anonimato (coerente con la funzione DB)

type Consents = { occupancy: boolean; adr: boolean; demand: boolean; channels: boolean };
type Pulse = { n_structures: number; occupancy: number | null; adr: number | null; revpar: number | null; my_occupancy: number | null; my_adr: number | null; my_revpar: number | null };
type Day = { date: string; factor: number; price: number; occ: number; sold: number; reason: string; level: number };

const dow = (iso: string) => new Date(iso + "T00:00:00").getDay(); // 0=Dom … 6=Sab
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function MercatoPage() {
  const { t } = useLang();
  const ask = useConfirm();
  const { structures, roomTypes, units, bookings, activeStructureId, setDayRates } = useData();
  const { user } = useAuth();

  const struct = useMemo(() => {
    const active = structures.find((s) => s.id === activeStructureId && (s.city || "").trim());
    return active || structures.find((s) => (s.city || "").trim()) || structures[0];
  }, [structures, activeStructureId]);
  const city = (struct?.city || "").trim();

  const [consents, setConsents] = useState<Consents>({ occupancy: true, adr: true, demand: false, channels: false });
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [breakdown, setBreakdown] = useState<{ idx: number; is_me: boolean; occupancy: number | null; adr: number | null; revpar: number | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState(false);

  const sUnits = useMemo(() => units.filter((u) => u.structureId === struct?.id && !u.outOfService), [units, struct?.id]);
  const sRooms = sUnits.length;
  const sTypes = useMemo(() => roomTypes.filter((rt) => rt.structureId === struct?.id), [roomTypes, struct?.id]);
  const mainType = useMemo(() => {
    if (!sTypes.length) return undefined;
    const counts = sTypes.map((rt) => ({ rt, n: sUnits.filter((u) => u.roomTypeId === rt.id).length }));
    counts.sort((a, b) => b.n - a.n);
    return counts[0].rt;
  }, [sTypes, sUnits]);

  const myDaily = useMemo(() => {
    if (!struct || sRooms === 0) return [] as { date: string; rooms_total: number; rooms_sold: number; revenue: number; dow: number }[];
    const today = toISO(new Date());
    const mine = bookings.filter((b) => b.structureId === struct.id && b.status !== "cancelled" && b.channel !== "blocked");
    const rows = [];
    for (let i = 0; i < WINDOW; i++) {
      const D = shiftISO(today, -i);
      const active = mine.filter((b) => b.checkIn <= D && b.checkOut > D);
      const revenue = active.reduce((s, b) => s + (b.total || 0) / Math.max(1, nights(b.checkIn, b.checkOut)), 0);
      rows.push({ date: D, rooms_total: sRooms, rooms_sold: active.length, revenue: Math.round(revenue), dow: dow(D) });
    }
    return rows.reverse();
  }, [struct, sRooms, bookings]);

  const my = useMemo(() => {
    const rt = myDaily.reduce((s, r) => s + r.rooms_total, 0);
    const rs = myDaily.reduce((s, r) => s + r.rooms_sold, 0);
    const rev = myDaily.reduce((s, r) => s + r.revenue, 0);
    return { occ: rt ? rs / rt : 0, adr: rs ? rev / rs : 0, revpar: rt ? rev / rt : 0 };
  }, [myDaily]);

  const dowOcc = useMemo(() => {
    const acc: Record<number, { s: number; t: number }> = {};
    for (const r of myDaily) { const a = acc[r.dow] ?? (acc[r.dow] = { s: 0, t: 0 }); a.s += r.rooms_sold; a.t += r.rooms_total; }
    const out: Record<number, number> = {};
    for (let d = 0; d < 7; d++) out[d] = acc[d]?.t ? acc[d].s / acc[d].t : my.occ;
    return out;
  }, [myDaily, my.occ]);

  const basePrice = useMemo(() => {
    const fromAdr = my.adr > 0 ? Math.round(my.adr) : 0;
    const fromType = mainType?.basePrice ?? 0;
    return fromAdr || fromType || 90;
  }, [my.adr, mainType]);

  const cityHot = pulse?.occupancy != null && pulse.occupancy > my.occ + 0.05;
  const adrGap = pulse?.adr != null && my.adr > 0 ? (pulse.adr - my.adr) / my.adr : 0;
  const engine = useMemo<Day[]>(() => {
    if (!struct || sRooms === 0) return [];
    const today = toISO(new Date());
    const mine = bookings.filter((b) => b.structureId === struct.id && b.status !== "cancelled" && b.channel !== "blocked");
    const out: Day[] = [];
    for (let i = 0; i < FUTURE; i++) {
      const D = shiftISO(today, i);
      const wd = dow(D);
      const sold = mine.filter((b) => b.checkIn <= D && b.checkOut > D).length;
      const pickup = sRooms ? sold / sRooms : 0;
      let f = 1; const reasons: { w: number; txt: string }[] = [];
      if (wd === 5 || wd === 6) { f *= 1.12; reasons.push({ w: 0.12, txt: t("weekend") }); }
      else if (wd === 0) { f *= 0.97; }
      if (pickup >= 0.7) { f *= 1.15; reasons.push({ w: 0.15, txt: t("richiesta alta (quasi pieno)") }); }
      else if (pickup <= 0.2 && i <= 10) { f *= 0.92; reasons.push({ w: 0.08, txt: t("last-minute da riempire") }); }
      if (cityHot) { f *= 1.08; reasons.push({ w: 0.08, txt: t("città molto piena") }); }
      if (adrGap > 0.05) { const up = clamp(adrGap, 0, 0.15); f *= 1 + up; reasons.push({ w: up, txt: t("sotto la media prezzi città") }); }
      else if (adrGap < -0.08) { f *= 0.96; reasons.push({ w: 0.05, txt: t("sopra la media città") }); }
      f = clamp(f, 0.8, 1.5);
      reasons.sort((a, b) => b.w - a.w);
      const price = Math.round(basePrice * f);
      const level = clamp((f - 0.85) / (1.4 - 0.85), 0, 1);
      out.push({ date: D, factor: f, price, occ: dowOcc[wd] ?? my.occ, sold, reason: reasons[0]?.txt || t("prezzo stabile"), level });
    }
    return out;
  }, [struct, sRooms, bookings, basePrice, cityHot, adrGap, dowOcc, my.occ, t]);

  const potential = useMemo(() => {
    const extra = engine.reduce((s, d) => s + (d.price - basePrice) * Math.max(d.sold, Math.round((dowOcc[dow(d.date)] ?? my.occ) * sRooms)), 0);
    return Math.round(extra);
  }, [engine, basePrice, dowOcc, my.occ, sRooms]);

  const peak = useMemo(() => engine.reduce<Day | null>((m, d) => (!m || d.factor > m.factor ? d : m), null), [engine]);

  useEffect(() => {
    if (!supabase || !user?.id || !struct?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase!.from("market_share").select("*").eq("user_id", user.id).eq("structure_id", struct.id).maybeSingle();
        if (cancelled || !data) return;
        setConsents({ occupancy: !!data.share_occupancy, adr: !!data.share_adr, demand: !!data.share_demand, channels: !!data.share_channels });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user?.id, struct?.id]);

  const dailyForUpload = useMemo(() => myDaily.map((r) => ({ date: r.date, rooms_total: r.rooms_total, rooms_sold: r.rooms_sold, revenue: r.revenue })), [myDaily]);

  const refresh = useCallback(async () => {
    if (!supabase || !user?.id || !struct?.id || !city) return;
    setLoading(true);
    try {
      const anyShare = consents.occupancy || consents.adr || consents.demand || consents.channels;
      await supabase.from("market_share").upsert({ user_id: user.id, structure_id: struct.id, city, share_occupancy: consents.occupancy, share_adr: consents.adr, share_demand: consents.demand, share_channels: consents.channels, updated_at: new Date().toISOString() });
      if (anyShare && dailyForUpload.length) await supabase.from("market_daily").upsert(dailyForUpload.map((r) => ({ user_id: user.id, structure_id: struct.id, city, ...r })));
      else await supabase.from("market_daily").delete().eq("user_id", user.id).eq("structure_id", struct.id);
      const from = shiftISO(toISO(new Date()), -WINDOW), to = toISO(new Date());
      const { data } = await supabase.rpc("market_pulse", { p_city: city, p_from: from, p_to: to });
      setPulse((Array.isArray(data) ? data[0] : data) as Pulse ?? null);
      const { data: bd } = await supabase.rpc("market_breakdown", { p_city: city, p_from: from, p_to: to });
      setBreakdown(Array.isArray(bd) ? (bd as typeof breakdown) : []);
    } catch {} finally { setLoading(false); }
  }, [consents, user?.id, struct?.id, city, dailyForUpload]);

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [consents, struct?.id, city]);

  const toggle = (k: keyof Consents) => setConsents((c) => ({ ...c, [k]: !c[k] }));
  const enough = (pulse?.n_structures ?? 0) >= THRESHOLD;
  const pctS = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

  const applyPrices = async () => {
    if (!engine.length || !sTypes.length) return;
    const ok = await ask({ title: t("Applica prezzi consigliati"), message: `${t("Imposto i prezzi consigliati per i prossimi")} ${FUTURE} ${t("giorni su tutte le tipologie di")} ${struct?.name}. ${t("Potrai modificarli a mano quando vuoi.")}`, confirmLabel: t("Applica") });
    if (!ok) return;
    const map: Record<string, number> = {};
    for (const rt of sTypes) { const base = rt.basePrice ?? basePrice; for (const d of engine) map[`${rt.id}|${d.date}`] = Math.max(0, Math.round(base * d.factor)); }
    setDayRates(map);
    setApplied(true); setTimeout(() => setApplied(false), 2200);
  };

  if (!struct) return (<div><PageHeader title={t("Rete città")} subtitle={t("Confronta la tua struttura con il mercato locale")} /><Card><p className="text-sm text-dim">{t("Aggiungi prima una struttura.")}</p></Card></div>);
  if (!city) return (<div><PageHeader title={t("Rete città")} subtitle={t("Confronta la tua struttura con il mercato locale")} /><Card><p className="text-sm text-dim">{t("Imposta la città nella scheda della struttura per attivare la rete.")}</p></Card></div>);

  const signals: string[] = [];
  if (peak && peak.factor > 1.05) signals.push(t("picchi di domanda in vista"));
  if (cityHot) signals.push(t("città molto piena"));
  if (adrGap > 0.05) signals.push(t("sei sotto la media prezzi città"));

  return (
    <div>
      <PageHeader title={t("Rete città")} subtitle={`${t("Il mercato di")} ${city} · ${t("anonimo e aggregato")}`} />

      {/* ═══ NÈTTARE — motore prezzi dinamici (hero) ═══ */}
      <div className="relative overflow-hidden rounded-3xl p-5 text-white shadow-lg sm:p-6" style={{ background: "radial-gradient(120% 140% at 0% 0%, #7c3aed 0%, #4f46e5 38%, #285f92 100%)" }}>
        <div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 85% 20%, #fff 0, transparent 32%), radial-gradient(circle at 60% 120%, #fff 0, transparent 30%)" }} />
        {/* sparkline dei prezzi in filigrana */}
        {engine.length > 1 && <PriceSpark days={engine} />}
        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl text-lg" style={{ background: "rgba(255,255,255,.16)", backdropFilter: "blur(4px)" }}>🦋</span>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[.14em] text-white/70">{t("Motore prezzi dinamici")}</div>
              <div className="font-display text-2xl font-extrabold leading-none">Nèttare</div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-white/70">{t("Ricavo potenziale")} · 30gg</div>
              <div className="font-mono text-4xl font-black leading-none tabular-nums">{potential > 0 ? `+${eur(potential)}` : eur(0)}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-white/70">{t("Prezzo base")}</div>
              <div className="font-mono text-2xl font-bold leading-none">{eur(basePrice)}</div>
            </div>
            {peak && peak.factor > 1.03 && (
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-white/70">{t("Picco consigliato")}</div>
                <div className="font-mono text-2xl font-bold leading-none">{eur(peak.price)} <span className="text-sm font-semibold text-emerald-300">+{Math.round((peak.factor - 1) * 100)}%</span></div>
              </div>
            )}
          </div>

          {signals.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {signals.map((s, i) => <span key={i} className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "rgba(255,255,255,.16)" }}>✦ {s}</span>)}
            </div>
          )}

          <button onClick={applyPrices} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#4f46e5] shadow-sm transition hover:scale-[1.02] active:scale-95">
            {applied ? `✓ ${t("Prezzi applicati")}` : `${t("Applica ai prossimi")} ${FUTURE} ${t("giorni")}`}
          </button>
          <p className="mt-2 text-[11px] text-white/70">{t("dai tuoi dati")}{cityHot || adrGap > 0.05 ? ` + ${t("segnali della Rete città")}` : ""} · {t("poi li ritocchi a mano quando vuoi")}</p>
        </div>
      </div>

      {/* Heatmap + giorni salienti */}
      <Card className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <SectionTitle>{t("Prezzi consigliati")} · {FUTURE}gg</SectionTitle>
          <span className="text-xs text-faint">{t("passa sopra un giorno per il dettaglio")}</span>
        </div>
        <CalHeatmap days={engine} base={basePrice} t={t} />
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {engine.filter((d) => Math.abs(d.factor - 1) >= 0.06).slice(0, 6).map((d) => (
            <div key={d.date} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5" style={{ background: "var(--wash)" }}>
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[10px] font-bold leading-none" style={{ background: d.factor >= 1 ? "color-mix(in srgb,#f59e0b 22%,var(--surface))" : "color-mix(in srgb,#3b82f6 22%,var(--surface))", color: "var(--txt)" }}>
                  <span className="text-sm">{new Date(d.date + "T00:00:00").getDate()}</span>
                  <span className="opacity-70">{new Date(d.date + "T00:00:00").toLocaleDateString("it-IT", { month: "short" })}</span>
                </span>
                <div>
                  <div className="text-sm font-semibold capitalize text-txt">{new Date(d.date + "T00:00:00").toLocaleDateString("it-IT", { weekday: "long" })}</div>
                  <div className="text-[11px] text-dim">{d.reason}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-base font-bold text-txt">{eur(d.price)}</div>
                <div className="text-[11px] font-bold" style={{ color: d.factor >= 1 ? "var(--ok)" : "#3b82f6" }}>{d.factor >= 1 ? "▲ +" : "▼ "}{Math.round((d.factor - 1) * 100)}%</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ═══ Cruscotto: tu vs città ═══ */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatGauge label={t("Occupazione")} you={my.occ} cityVal={enough && consents.occupancy ? pulse?.occupancy ?? null : null} kind="pct" />
        <StatGauge label={t("ADR · prezzo medio")} you={my.adr} youMax={Math.max(my.adr, pulse?.adr ?? 0, 1)} cityVal={enough && consents.adr ? pulse?.adr ?? null : null} kind="eur" />
        <StatGauge label="RevPAR" you={my.revpar} youMax={Math.max(my.revpar, pulse?.revpar ?? 0, 1)} cityVal={enough && consents.adr ? pulse?.revpar ?? null : null} kind="eur" />
      </div>

      {/* ═══ Polso del mercato ═══ */}
      <Card className="mt-4">
        <div className="flex items-center justify-between">
          <SectionTitle>{t("Polso del mercato")}</SectionTitle>
          <span className="inline-flex items-center gap-1.5 text-xs text-faint">
            <span className={`h-2 w-2 rounded-full ${loading ? "animate-pulse" : ""}`} style={{ background: enough ? "var(--ok)" : "var(--warn)" }} />
            {loading ? t("Aggiorno…") : `${pulse?.n_structures ?? 0} ${t("strutture nella rete")}`}
          </span>
        </div>
        {!enough && (
          <div className="mb-3 mt-1 rounded-xl border border-dashed border-line p-3 text-xs text-dim" style={{ background: "var(--wash)" }}>
            {t("Servono almeno")} {THRESHOLD} {t("strutture della tua città nella rete per mostrare i dati aggregati (anonimato). Più siete, più i prezzi dinamici sono precisi.")}
          </div>
        )}
        <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Compare label={t("Occupazione")} shared={consents.occupancy} enough={enough} cityStr={pctS(pulse?.occupancy)} youStr={pctS(pulse?.my_occupancy)} up={(pulse?.my_occupancy ?? 0) >= (pulse?.occupancy ?? 0)} t={t} />
          <Compare label="ADR" shared={consents.adr} enough={enough} cityStr={pulse?.adr != null ? eur(Math.round(pulse.adr)) : "—"} youStr={pulse?.my_adr != null ? eur(Math.round(pulse.my_adr)) : "—"} up={(pulse?.my_adr ?? 0) >= (pulse?.adr ?? 0)} t={t} />
          <Compare label="RevPAR" shared={consents.adr} enough={enough} cityStr={pulse?.revpar != null ? eur(Math.round(pulse.revpar)) : "—"} youStr={pulse?.my_revpar != null ? eur(Math.round(pulse.my_revpar)) : "—"} up={(pulse?.my_revpar ?? 0) >= (pulse?.revpar ?? 0)} t={t} />
        </div>
      </Card>

      {/* ═══ Elenco anonimo strutture ═══ */}
      <Card className="mt-4">
        <div className="flex items-center justify-between">
          <SectionTitle>{t("Le strutture della rete")} · {city}</SectionTitle>
          <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "color-mix(in srgb,var(--focus) 12%,transparent)", color: "var(--focus)" }}>{breakdown.length || pulse?.n_structures || 0} {t("strutture")}</span>
        </div>
        <p className="mb-3 text-xs text-dim">{t("Elenco anonimo: sono queste strutture, insieme, a formare le medie. Ogni riga è una struttura senza nome; la tua è evidenziata.")}</p>
        {breakdown.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-semibold">{t("Struttura")}</th>
                  <th className="py-2 pr-3 font-semibold">{t("Occupazione")}</th>
                  <th className="py-2 pr-3 text-right font-semibold">ADR</th>
                  <th className="py-2 text-right font-semibold">RevPAR</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((r) => (
                  <tr key={r.idx} className="group" style={r.is_me ? { background: "color-mix(in srgb,var(--focus) 9%,transparent)" } : undefined}>
                    <td className="border-t border-line py-2.5 pr-3" style={r.is_me ? { boxShadow: "inset 3px 0 0 var(--focus)" } : undefined}>
                      <span className="inline-flex items-center gap-2 pl-1">
                        <span className="inline-grid h-6 w-6 place-items-center rounded-md text-[11px] font-bold" style={{ background: r.is_me ? "var(--focus)" : "var(--wash)", color: r.is_me ? "#fff" : "var(--dim)" }}>{r.is_me ? "★" : r.idx}</span>
                        <span className={r.is_me ? "font-semibold text-txt" : "text-dim"}>{r.is_me ? t("La tua struttura") : `${t("Struttura")} ${r.idx}`}</span>
                      </span>
                    </td>
                    <td className="border-t border-line py-2.5 pr-3">
                      {r.occupancy != null ? (
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: "var(--line)" }}><span className="block h-full rounded-full" style={{ width: `${Math.round(r.occupancy * 100)}%`, background: r.is_me ? "var(--focus)" : "var(--dim)" }} /></span>
                          <span className="font-mono text-xs text-txt">{Math.round(r.occupancy * 100)}%</span>
                        </span>
                      ) : <span className="text-faint">—</span>}
                    </td>
                    <td className="border-t border-line py-2.5 pr-3 text-right font-mono">{r.adr != null ? eur(Math.round(r.adr)) : <span className="text-faint">—</span>}</td>
                    <td className="border-t border-line py-2.5 text-right font-mono">{r.revpar != null ? eur(Math.round(r.revpar)) : <span className="text-faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-faint">{t("Una colonna mostra un dato solo se quella struttura lo condivide e se lo condividi anche tu (reciprocità). “—” = non condiviso.")}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line p-3 text-xs text-dim" style={{ background: "var(--wash)" }}>
            {t("L'elenco compare quando nella tua città ci sono almeno")} {THRESHOLD} {t("strutture nella rete. Invita altri gestori: più siete, più i dati (e i prezzi dinamici) sono precisi.")}
          </div>
        )}
      </Card>

      {/* ═══ Andamento ═══ */}
      <Card className="mt-4">
        <SectionTitle>{t("Andamento occupazione")} · {WINDOW}gg</SectionTitle>
        <TrendChart data={myDaily} cityAvg={enough && consents.occupancy ? pulse?.occupancy ?? null : null} t={t} />
      </Card>

      {/* ═══ Consensi ═══ */}
      <Card className="mt-4">
        <SectionTitle>{t("Cosa condividi")}</SectionTitle>
        <p className="mb-1 text-xs text-dim">{t("Dai per ricevere: vedi un dato della città solo se lo condividi anche tu. Sempre anonimo e aggregato.")}</p>
        <div className="divide-y divide-[color:var(--line)]">
          <ToggleRow on={consents.occupancy} onClick={() => toggle("occupancy")} label={t("Occupazione")} hint={t("% camere vendute")} />
          <ToggleRow on={consents.adr} onClick={() => toggle("adr")} label={t("Prezzi (ADR / RevPAR)")} hint={t("prezzo medio e ricavo per camera")} />
          <ToggleRow on={consents.demand} onClick={() => toggle("demand")} label={t("Domanda futura")} hint={t("in arrivo (v2)")} disabled />
          <ToggleRow on={consents.channels} onClick={() => toggle("channels")} label={t("Mix canali")} hint={t("in arrivo")} disabled />
        </div>
      </Card>
    </div>
  );
}

/* ───────── componenti visivi ───────── */

// Sparkline della curva prezzi in filigrana nell'hero.
function PriceSpark({ days }: { days: Day[] }) {
  const W = 400, H = 90;
  const min = Math.min(...days.map((d) => d.price)), max = Math.max(...days.map((d) => d.price));
  const rng = Math.max(1, max - min);
  const pts = days.map((d, i) => [(i / (days.length - 1)) * W, H - ((d.price - min) / rng) * (H - 8) - 4] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="pointer-events-none absolute bottom-0 right-0 h-24 w-2/3 opacity-30" aria-hidden>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="rgba(255,255,255,.25)" />
      <path d={line} fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function StatGauge({ label, you, youMax, cityVal, kind }: { label: string; you: number; youMax?: number; cityVal: number | null; kind: "pct" | "eur" }) {
  const fill = kind === "pct" ? clamp(you, 0, 1) : clamp(you / (youMax || 1), 0, 1);
  const R = 46, C = Math.PI * R, off = C * (1 - fill);
  const youStr = kind === "pct" ? `${Math.round(you * 100)}%` : (you ? eur(Math.round(you)) : "—");
  const cityStr = cityVal == null ? null : kind === "pct" ? `${Math.round(cityVal * 100)}%` : eur(Math.round(cityVal));
  const delta = cityVal == null ? null : kind === "pct" ? Math.round((you - cityVal) * 100) : Math.round(you - cityVal);
  const up = (delta ?? 0) >= 0;
  return (
    <div className="rounded-2xl border border-line p-4" style={{ background: "linear-gradient(180deg,var(--surface),color-mix(in srgb,var(--focus) 5%,var(--surface)))" }}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-dim">{label}</div>
        {delta != null && (
          <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: up ? "color-mix(in srgb,var(--ok) 15%,transparent)" : "color-mix(in srgb,var(--warn) 15%,transparent)", color: up ? "var(--ok)" : "var(--warn)" }}>
            {up ? "▲" : "▼"} {kind === "pct" ? `${Math.abs(delta)} pt` : eur(Math.abs(delta))}
          </span>
        )}
      </div>
      <div className="relative mt-1 flex items-end justify-center" style={{ height: 76 }}>
        <svg viewBox="0 0 110 62" width="156" height="86" style={{ overflow: "visible" }}>
          <path d="M8,56 A46,46 0 0 1 102,56" fill="none" stroke="var(--line)" strokeWidth="9" strokeLinecap="round" />
          <path d="M8,56 A46,46 0 0 1 102,56" fill="none" stroke="url(#gg)" strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off} style={{ transition: "stroke-dashoffset .6s ease" }} />
          <defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--focus)" /><stop offset="1" stopColor="#7c3aed" /></linearGradient></defs>
        </svg>
        <div className="absolute bottom-1 text-center">
          <div className="font-mono text-2xl font-extrabold text-txt">{youStr}</div>
        </div>
      </div>
      <div className="mt-1 text-center text-[11px]">
        {cityStr != null ? <span className="text-dim">{t2("città")} <b className="text-txt">{cityStr}</b></span> : <span className="text-faint">{t2("città")}: —</span>}
      </div>
    </div>
  );
}
// piccola util per testo fisso nei componenti figli (evita passare t ovunque)
function t2(s: string) { return s; }

function CalHeatmap({ days, base, t }: { days: Day[]; base: number; t: (s: string) => string }) {
  if (!days.length) return <p className="text-xs text-faint">{t("Aggiungi camere e prezzi per vedere i consigli.")}</p>;
  const WD = ["Lu", "Ma", "Me", "Gi", "Ve", "Sa", "Do"];
  const lead = (dow(days[0].date) + 6) % 7; // offset lunedì-primo
  const col = (lvl: number) => {
    if (lvl < 0.42) return `color-mix(in srgb, #3b82f6 ${Math.round((0.42 - lvl) / 0.42 * 62) + 16}%, var(--surface))`;
    if (lvl > 0.58) return `color-mix(in srgb, #f59e0b ${Math.round((lvl - 0.58) / 0.42 * 70) + 18}%, var(--surface))`;
    return "color-mix(in srgb, var(--dim) 10%, var(--surface))";
  };
  return (
    <div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(7,minmax(0,1fr))", maxWidth: 420 }}>
        {WD.map((w) => <div key={w} className="text-center text-[10px] font-semibold text-faint">{w}</div>)}
        {Array.from({ length: lead }).map((_, i) => <div key={`e${i}`} />)}
        {days.map((d) => {
          const dt = new Date(d.date + "T00:00:00");
          const hot = d.factor >= 1.1, cold = d.factor <= 0.92;
          return (
            <div key={d.date} title={`${dt.toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" })} · ${eur(d.price)} (${d.factor >= 1 ? "+" : ""}${Math.round((d.factor - 1) * 100)}%) · ${d.reason}`}
              className="grid aspect-square place-items-center rounded-lg border text-[10px] font-bold transition hover:scale-[1.06]"
              style={{ background: col(d.level), borderColor: hot || cold ? (hot ? "#f59e0b" : "#3b82f6") : "var(--line)", color: "var(--txt)" }}>
              <span className="text-[13px] leading-none">{dt.getDate()}</span>
              <span className="font-mono text-[9px] leading-none opacity-75">{d.price}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-faint">
        <span className="flex items-center gap-1"><i className="inline-block h-3 w-3 rounded" style={{ background: "#3b82f6" }} /> {t("sconto / bassa domanda")}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-3 w-3 rounded" style={{ background: "#f59e0b" }} /> {t("rialzo / alta domanda")}</span>
        <span className="ml-auto">{t("Base")} <b className="text-dim">{eur(base)}</b></span>
      </div>
    </div>
  );
}

function TrendChart({ data, cityAvg, t }: { data: { date: string; rooms_total: number; rooms_sold: number }[]; cityAvg: number | null; t: (s: string) => string }) {
  if (data.length < 2) return <p className="text-xs text-faint">{t("Dati insufficienti per il grafico.")}</p>;
  const W = 660, H = 130, pad = 6;
  const pts = data.map((r, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const occ = r.rooms_total ? r.rooms_sold / r.rooms_total : 0;
    return [x, H - pad - occ * (H - pad * 2)] as const;
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - pad} L${pts[0][0].toFixed(1)},${H - pad} Z`;
  const last = pts[pts.length - 1];
  const cityY = cityAvg == null ? null : H - pad - cityAvg * (H - pad * 2);
  return (
    <div>
      <div className="overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
          <defs><linearGradient id="tr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--focus)" stopOpacity="0.4" /><stop offset="1" stopColor="var(--focus)" stopOpacity="0" /></linearGradient></defs>
          {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={pad} x2={W - pad} y1={H - pad - g * (H - pad * 2)} y2={H - pad - g * (H - pad * 2)} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 5" />)}
          <path d={area} fill="url(#tr)" />
          <path d={line} fill="none" stroke="var(--focus)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {cityY != null && <line x1={pad} x2={W - pad} y1={cityY} y2={cityY} stroke="#f59e0b" strokeWidth="2" strokeDasharray="6 4" />}
          <circle cx={last[0]} cy={last[1]} r="4" fill="var(--focus)" stroke="var(--surface)" strokeWidth="2" />
        </svg>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-faint">
        <span>{new Date(data[0].date + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 rounded" style={{ background: "var(--focus)" }} /> {t("tu")}</span>
          {cityAvg != null && <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3" style={{ background: "#f59e0b" }} /> {t("media città")}</span>}
          <span>{t("oggi")}</span>
        </span>
      </div>
    </div>
  );
}

function Compare({ label, shared, enough, cityStr, youStr, up, t }: { label: string; shared: boolean; enough: boolean; cityStr: string; youStr: string; up: boolean; t: (s: string) => string }) {
  return (
    <div className="rounded-2xl border border-line p-4" style={{ background: "var(--surface)" }}>
      <div className="text-xs text-dim">{label}</div>
      {!shared ? <div className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-faint">🔒 {t("Condividi per vedere")}</div>
        : !enough ? <div className="mt-2 text-sm font-semibold text-faint">{t("Dati insufficienti")}</div>
        : (<>
            <div className="mt-0.5 flex items-baseline gap-2"><span className="font-mono text-2xl font-extrabold text-txt">{cityStr}</span><span className="text-[11px] text-dim">{t("media città")}</span></div>
            <div className="mt-2 flex items-center justify-between border-t border-dashed border-line pt-2 text-xs">
              <span className="text-faint">{t("La tua struttura")}</span>
              <span className="flex items-center gap-1 font-mono font-semibold"><span style={{ color: up ? "var(--ok)" : "var(--warn)" }}>{up ? "▲" : "▼"}</span><span className="text-txt">{youStr}</span></span>
            </div>
          </>)}
    </div>
  );
}

function ToggleRow({ on, onClick, label, hint, disabled }: { on: boolean; onClick: () => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div><div className="text-sm font-medium text-txt">{label}</div>{hint && <div className="text-[11px] text-faint">{hint}</div>}</div>
      <button type="button" disabled={disabled} onClick={onClick} aria-pressed={on} className="relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40" style={{ backgroundColor: on ? "var(--ok)" : "var(--line)" }}>
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all" style={{ left: on ? 22 : 2 }} />
      </button>
    </div>
  );
}
