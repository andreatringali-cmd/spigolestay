"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";
import { toISO, shiftISO, nights } from "@/lib/dates";
import { eur } from "@/lib/format";
import { PageHeader, Card } from "@/components/ui";
import { useLang } from "@/lib/i18n";

const WINDOW = 90;
const FUTURE = 30;
const THRESHOLD = 3;

type Consents = { occupancy: boolean; adr: boolean; demand: boolean; channels: boolean };
type Pulse = { n_structures: number; occupancy: number | null; adr: number | null; revpar: number | null; my_occupancy: number | null; my_adr: number | null; my_revpar: number | null };
type Day = { date: string; factor: number; price: number; sold: number; reason: string };

const dow = (iso: string) => new Date(iso + "T00:00:00").getDay();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function MercatoPage() {
  const { t } = useLang();
  const { structures, roomTypes, units, bookings, activeStructureId } = useData();
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
    return fromAdr || (mainType?.basePrice ?? 0) || 90;
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
      if (pickup >= 0.7) { f *= 1.15; reasons.push({ w: 0.15, txt: t("quasi al completo") }); }
      else if (pickup <= 0.2 && i <= 10) { f *= 0.92; reasons.push({ w: 0.08, txt: t("ancora vuoto: last-minute") }); }
      if (cityHot) { f *= 1.08; reasons.push({ w: 0.08, txt: t("città molto piena") }); }
      if (adrGap > 0.05) { const up = clamp(adrGap, 0, 0.15); f *= 1 + up; reasons.push({ w: up, txt: t("sotto la media città") }); }
      else if (adrGap < -0.08) { f *= 0.96; reasons.push({ w: 0.05, txt: t("sopra la media città") }); }
      f = clamp(f, 0.8, 1.5);
      reasons.sort((a, b) => b.w - a.w);
      out.push({ date: D, factor: f, price: Math.round(basePrice * f), sold, reason: reasons[0]?.txt || t("in linea") });
    }
    return out;
  }, [struct, sRooms, bookings, basePrice, cityHot, adrGap, t]);

  const potential = useMemo(() => {
    const extra = engine.reduce((s, d) => s + (d.price - basePrice) * Math.max(d.sold, Math.round((dowOcc[dow(d.date)] ?? my.occ) * sRooms)), 0);
    return Math.round(extra);
  }, [engine, basePrice, dowOcc, my.occ, sRooms]);

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

  if (!struct) return (<div><PageHeader title={t("Rete città")} subtitle={t("Confronta la tua struttura con il mercato locale")} /><Card><p className="text-sm text-dim">{t("Aggiungi prima una struttura.")}</p></Card></div>);
  if (!city) return (<div><PageHeader title={t("Rete città")} subtitle={t("Confronta la tua struttura con il mercato locale")} /><Card><p className="text-sm text-dim">{t("Imposta la città nella scheda della struttura per attivare la rete.")}</p></Card></div>);

  // Normalizzazioni per le barre "tu vs città"
  const adrMax = Math.max(my.adr, pulse?.adr ?? 0, 1);
  const revMax = Math.max(my.revpar, pulse?.revpar ?? 0, 1);

  return (
    <div>
      <PageHeader title={t("Rete città")} subtitle={`${city} · ${t("confronto anonimo con i B&B della tua città")}`} />

      {/* Banner Nèttare — i prezzi vivono nella pagina Nèttare */}
      <Link href="/nettare" className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-line p-4 transition hover:brightness-[1.02]" style={{ background: "linear-gradient(100deg, color-mix(in srgb,var(--focus) 8%,var(--surface)), var(--surface))" }}>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-line text-lg" style={{ background: "color-mix(in srgb,var(--focus) 10%,transparent)" }}>🦋</span>
          <div>
            <div className="text-sm font-bold text-txt">Nèttare · {t("prezzi dinamici")}</div>
            <div className="text-[11px] text-dim">{potential > 0 ? <>{t("Ricavo in più stimato")}: <b style={{ color: "var(--ok)" }}>+{eur(potential)}/30gg</b></> : t("Prezzi consigliati per i prossimi 30 giorni, dai dati della rete")}</div>
          </div>
        </div>
        <span className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--focus)" }}>{t("Apri Nèttare")} →</span>
      </Link>

      {/* TU VS CITTÀ */}
      <section className="mt-4">
        <h3 className="text-[15px] font-bold tracking-tight text-txt">{t("Come vai rispetto alla città")}</h3>
        <p className="mb-2 mt-0.5 text-xs text-dim">{t("Barra piena = tu; trattino = media città (ultimi 90 giorni).")}</p>
        <div className="rounded-2xl border border-line px-4" style={{ background: "var(--surface)" }}>
          <CmpRow label={t("Occupazione")} youStr={`${Math.round(my.occ * 100)}%`} cityStr={enough && consents.occupancy && pulse?.occupancy != null ? `${Math.round(pulse.occupancy * 100)}%` : null}
            youW={my.occ} cityW={pulse?.occupancy ?? null} delta={pulse?.occupancy != null ? Math.round((my.occ - pulse.occupancy) * 100) : null} unit="pt" shared={consents.occupancy} enough={enough} t={t} />
          <CmpRow label="ADR" youStr={my.adr ? eur(Math.round(my.adr)) : "—"} cityStr={enough && consents.adr && pulse?.adr != null ? eur(Math.round(pulse.adr)) : null}
            youW={my.adr / adrMax} cityW={pulse?.adr != null ? pulse.adr / adrMax : null} delta={pulse?.adr != null ? Math.round(my.adr - pulse.adr) : null} unit="€" shared={consents.adr} enough={enough} t={t} />
          <CmpRow label="RevPAR" youStr={my.revpar ? eur(Math.round(my.revpar)) : "—"} cityStr={enough && consents.adr && pulse?.revpar != null ? eur(Math.round(pulse.revpar)) : null}
            youW={my.revpar / revMax} cityW={pulse?.revpar != null ? pulse.revpar / revMax : null} delta={pulse?.revpar != null ? Math.round(my.revpar - pulse.revpar) : null} unit="€" shared={consents.adr} enough={enough} t={t} last />
        </div>
      </section>

      {/* riga 3: strutture + consensi */}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
      {/* ── STRUTTURE DELLA RETE ── */}
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-bold tracking-tight text-txt">{t("Le strutture della rete")} · {city}</h3>
          <span className="inline-flex items-center gap-1.5 text-xs text-faint"><span className={`h-2 w-2 rounded-full ${loading ? "animate-pulse" : ""}`} style={{ background: enough ? "var(--ok)" : "var(--warn)" }} />{pulse?.n_structures ?? 0} {t("nella rete")}</span>
        </div>
        <p className="mb-2 mt-0.5 text-xs text-dim">{t("Sono queste strutture, insieme, a formare le medie. Anonime; la tua è evidenziata.")}</p>
        <div className="rounded-2xl border border-line px-4 py-3" style={{ background: "var(--surface)" }}>
          {breakdown.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] border-collapse text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="pb-3 font-semibold">{t("Struttura")}</th><th className="pb-3 font-semibold">{t("Occupazione")}</th><th className="pb-3 text-right font-semibold">ADR</th><th className="pb-3 text-right font-semibold">RevPAR</th>
                </tr></thead>
                <tbody>
                  {breakdown.map((r) => (
                    <tr key={r.idx} style={r.is_me ? { background: "color-mix(in srgb,var(--focus) 6%,transparent)" } : undefined}>
                      <td className="border-t border-line py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-grid h-6 w-6 place-items-center rounded-lg text-[11px] font-bold" style={{ background: r.is_me ? "var(--focus)" : "var(--wash)", color: r.is_me ? "#fff" : "var(--dim)" }}>{r.is_me ? "★" : r.idx}</span>
                          <span className={r.is_me ? "font-semibold text-txt" : "text-dim"}>{r.is_me ? t("La tua struttura") : `${t("Struttura")} ${r.idx}`}</span>
                        </span>
                      </td>
                      <td className="border-t border-line py-2.5">{r.occupancy != null ? (<span className="inline-flex items-center gap-2"><span className="inline-block h-1.5 w-16 overflow-hidden rounded-full" style={{ background: "var(--wash)" }}><span className="block h-full rounded-full" style={{ width: `${Math.round(r.occupancy * 100)}%`, background: r.is_me ? "var(--focus)" : "var(--dim)" }} /></span><span className="font-mono text-xs text-txt">{Math.round(r.occupancy * 100)}%</span></span>) : <span className="text-faint">—</span>}</td>
                      <td className="border-t border-line py-3 text-right font-mono">{r.adr != null ? eur(Math.round(r.adr)) : <span className="text-faint">—</span>}</td>
                      <td className="border-t border-line py-3 text-right font-mono">{r.revpar != null ? eur(Math.round(r.revpar)) : <span className="text-faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-faint">{t("Un dato compare solo se quella struttura lo condivide e se lo condividi anche tu (reciprocità). “—” = non condiviso.")}</p>
            </div>
          ) : (
            <p className="text-[13px] text-dim">{t("L'elenco compare quando nella tua città ci sono almeno")} {THRESHOLD} {t("strutture nella rete. Invita altri gestori: più siete, più i dati (e i prezzi) sono precisi.")}</p>
          )}
        </div>
      </section>

      {/* ── COSA CONDIVIDI ── */}
      <section>
        <h3 className="text-[15px] font-bold tracking-tight text-txt">{t("Cosa condividi")}</h3>
        <p className="mb-2 mt-0.5 text-xs text-dim">{t("Dai per ricevere: vedi un dato della città solo se lo condividi anche tu. Sempre anonimo e aggregato.")}</p>
        <div className="rounded-2xl border border-line px-4" style={{ background: "var(--surface)" }}>
          <ToggleRow on={consents.occupancy} onClick={() => toggle("occupancy")} label={t("Occupazione")} hint={t("% camere vendute")} />
          <ToggleRow on={consents.adr} onClick={() => toggle("adr")} label={t("Prezzi (ADR / RevPAR)")} hint={t("prezzo medio e ricavo per camera")} />
          <ToggleRow on={consents.demand} onClick={() => toggle("demand")} label={t("Domanda futura")} hint={t("in arrivo")} disabled />
          <ToggleRow on={consents.channels} onClick={() => toggle("channels")} label={t("Mix canali")} hint={t("in arrivo")} disabled last />
        </div>
      </section>
      </div>
    </div>
  );
}

/* ───────── componenti ───────── */

function CmpRow({ label, youStr, cityStr, youW, cityW, delta, unit, shared, enough, last, t }: { label: string; youStr: string; cityStr: string | null; youW: number; cityW: number | null; delta: number | null; unit: string; shared: boolean; enough: boolean; last?: boolean; t: (s: string) => string }) {
  const show = shared && enough && cityStr != null;
  const up = (delta ?? 0) >= 0;
  return (
    <div className="grid items-center gap-3 py-3 sm:grid-cols-[84px_1fr_auto]" style={last ? undefined : { borderBottom: "1px solid var(--hair, color-mix(in srgb,var(--line) 60%,transparent))" }}>
      <div className="text-[13px] font-medium text-dim">{label}</div>
      <div className="relative h-2 rounded-full" style={{ background: "var(--wash)" }}>
        <div className="absolute left-0 top-0 h-2 rounded-full" style={{ width: `${clamp(youW, 0, 1) * 100}%`, background: "var(--focus)" }} />
        {show && cityW != null && <div className="absolute -top-1 h-4 w-0.5 rounded" style={{ left: `${clamp(cityW, 0, 1) * 100}%`, background: "var(--faint)" }} />}
      </div>
      <div className="flex items-baseline justify-end gap-2 text-right">
        <span className="font-mono text-xl font-bold text-txt">{youStr}</span>
        {show ? <span className="text-xs text-dim">{t("città")} {cityStr}</span> : <span className="text-xs text-faint">{shared ? t("città: —") : `🔒 ${t("condividi")}`}</span>}
        {show && delta != null && <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: up ? "var(--ok)" : "var(--err)", background: up ? "color-mix(in srgb,var(--ok) 12%,transparent)" : "color-mix(in srgb,var(--err) 12%,transparent)" }}>{up ? "+" : ""}{unit === "€" ? eur(delta) : `${delta} pt`}</span>}
      </div>
    </div>
  );
}

function ToggleRow({ on, onClick, label, hint, disabled, last }: { on: boolean; onClick: () => void; label: string; hint?: string; disabled?: boolean; last?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3" style={last ? undefined : { borderBottom: "1px solid var(--hair, color-mix(in srgb,var(--line) 60%,transparent))" }}>
      <div><div className="text-sm font-medium text-txt">{label}</div>{hint && <div className="text-[11px] text-faint">{hint}</div>}</div>
      <button type="button" disabled={disabled} onClick={onClick} aria-pressed={on} className="relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40" style={{ backgroundColor: on ? "var(--ok)" : "var(--line)" }}>
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all" style={{ left: on ? 22 : 2 }} />
      </button>
    </div>
  );
}
