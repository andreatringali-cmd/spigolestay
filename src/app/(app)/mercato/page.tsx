"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";
import { toISO, shiftISO, nights } from "@/lib/dates";
import { eur } from "@/lib/format";
import { PageHeader, Card } from "@/components/ui";
import { useLang } from "@/lib/i18n";

const WINDOW = 90;
const THRESHOLD = 3;

type Consents = { occupancy: boolean; adr: boolean; demand: boolean; channels: boolean };
type Row = { idx: number; is_me: boolean; occupancy: number | null; adr: number | null; revpar: number | null; future_occ: number | null; pickup_pct: number | null; lead_avg: number | null; los_avg: number | null; cancel_rate: number | null; direct_pct: number | null; foreign_pct: number | null };
type Pulse = { n_structures: number; occupancy: number | null; adr: number | null; revpar: number | null; my_occupancy: number | null; my_adr: number | null; my_revpar: number | null };

const dow = (iso: string) => new Date(iso + "T00:00:00").getDay();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function MercatoPage() {
  const { t } = useLang();
  const { structures, units, bookings, guests, activeStructureId } = useData();
  const { user } = useAuth();

  const struct = useMemo(() => {
    const active = structures.find((s) => s.id === activeStructureId && (s.city || "").trim());
    return active || structures.find((s) => (s.city || "").trim()) || structures[0];
  }, [structures, activeStructureId]);
  const city = (struct?.city || "").trim();

  const [consents, setConsents] = useState<Consents>({ occupancy: true, adr: true, demand: false, channels: false });
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [breakdown, setBreakdown] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const sUnits = useMemo(() => units.filter((u) => u.structureId === struct?.id && !u.outOfService), [units, struct?.id]);
  const sRooms = sUnits.length;
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

  // Indicatori della struttura (Domanda + Ospiti & canali), calcolati dalle prenotazioni.
  const profile = useMemo(() => {
    if (!struct || sRooms === 0) return null;
    const today = toISO(new Date()), yearAgo = shiftISO(today, -365), weekAgo = shiftISO(today, -7), in30 = shiftISO(today, 30);
    const all = bookings.filter((b) => b.structureId === struct.id && b.channel !== "blocked");
    const valid = all.filter((b) => b.status !== "cancelled");
    let soldNights = 0, pickNights = 0;
    for (let i = 0; i < 30; i++) {
      const D = shiftISO(today, i);
      for (const b of valid) if (b.checkIn <= D && b.checkOut > D) { soldNights++; if (b.bookedOn && b.bookedOn >= weekAgo) pickNights++; }
    }
    const cap = sRooms * 30;
    const past = all.filter((b) => b.checkIn >= yearAgo && b.checkIn <= in30);
    const pastValid = past.filter((b) => b.status !== "cancelled");
    const leads = pastValid.filter((b) => b.bookedOn).map((b) => Math.max(0, nights(b.bookedOn!.slice(0, 10), b.checkIn)));
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const withNat = pastValid.map((b) => guests.find((g) => g.id === b.guestId)).map((g) => (g?.citizenship || g?.country || "").trim().toLowerCase()).filter(Boolean);
    return {
      future_occ: cap ? soldNights / cap : null,
      pickup_pct: cap ? pickNights / cap : null,
      lead_avg: avg(leads),
      los_avg: avg(pastValid.map((b) => nights(b.checkIn, b.checkOut))),
      cancel_rate: past.length ? (past.length - pastValid.length) / past.length : null,
      direct_pct: pastValid.length ? pastValid.filter((b) => b.channel === "direct").length / pastValid.length : null,
      foreign_pct: withNat.length ? withNat.filter((c) => !["italia", "italy", "it", "italiana", "italiano"].includes(c)).length / withNat.length : null,
    };
  }, [struct, sRooms, bookings, guests]);

  const dailyForUpload = useMemo(() => myDaily.map((r) => ({ date: r.date, rooms_total: r.rooms_total, rooms_sold: r.rooms_sold, revenue: r.revenue })), [myDaily]);

  const refresh = useCallback(async () => {
    if (!supabase || !user?.id || !struct?.id || !city) return;
    setLoading(true);
    try {
      const anyShare = consents.occupancy || consents.adr || consents.demand || consents.channels;
      await supabase.from("market_share").upsert({ user_id: user.id, structure_id: struct.id, city, share_occupancy: consents.occupancy, share_adr: consents.adr, share_demand: consents.demand, share_channels: consents.channels, updated_at: new Date().toISOString() });
      if (anyShare && dailyForUpload.length) await supabase.from("market_daily").upsert(dailyForUpload.map((r) => ({ user_id: user.id, structure_id: struct.id, city, ...r })));
      else await supabase.from("market_daily").delete().eq("user_id", user.id).eq("structure_id", struct.id);
      if (profile && (consents.demand || consents.channels)) {
        // si carica solo il gruppo di dati che condividi
        const d = consents.demand, c = consents.channels;
        await supabase.from("market_profile").upsert({
          user_id: user.id, structure_id: struct.id, city,
          future_occ: d ? profile.future_occ : null, pickup_pct: d ? profile.pickup_pct : null, lead_avg: d ? profile.lead_avg : null,
          los_avg: c ? profile.los_avg : null, cancel_rate: c ? profile.cancel_rate : null, direct_pct: c ? profile.direct_pct : null, foreign_pct: c ? profile.foreign_pct : null,
          updated_at: new Date().toISOString(),
        });
      } else await supabase.from("market_profile").delete().eq("user_id", user.id).eq("structure_id", struct.id);
      const from = shiftISO(toISO(new Date()), -WINDOW), to = toISO(new Date());
      const { data } = await supabase.rpc("market_pulse", { p_city: city, p_from: from, p_to: to });
      setPulse((Array.isArray(data) ? data[0] : data) as Pulse ?? null);
      const { data: bd } = await supabase.rpc("market_breakdown", { p_city: city, p_from: from, p_to: to });
      setBreakdown(Array.isArray(bd) ? (bd as typeof breakdown) : []);
    } catch {} finally { setLoading(false); }
  }, [consents, user?.id, struct?.id, city, dailyForUpload, profile]);

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

      {/* KPI: come vai rispetto alla città */}
      <section className="mt-4">
        <h3 className="text-[15px] font-bold tracking-tight text-txt">{t("Come vai rispetto alla città")}</h3>
        <p className="mb-2 mt-0.5 text-xs text-dim">{t("Il tuo dato (ultimi 90 giorni) a confronto con la media anonima della città.")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t("Occupazione")} youStr={`${Math.round(my.occ * 100)}%`} youW={my.occ}
            cityStr={enough && consents.occupancy && pulse?.occupancy != null ? `${Math.round(pulse.occupancy * 100)}%` : null} cityW={pulse?.occupancy ?? null}
            delta={pulse?.occupancy != null ? Math.round((my.occ - pulse.occupancy) * 100) : null} unit="pt" shared={consents.occupancy} enough={enough} t={t} />
          <StatCard label="ADR" youStr={my.adr ? eur(Math.round(my.adr)) : "—"} youW={my.adr / adrMax}
            cityStr={enough && consents.adr && pulse?.adr != null ? eur(Math.round(pulse.adr)) : null} cityW={pulse?.adr != null ? pulse.adr / adrMax : null}
            delta={pulse?.adr != null ? Math.round(my.adr - pulse.adr) : null} unit="€" shared={consents.adr} enough={enough} t={t} />
          <StatCard label="RevPAR" youStr={my.revpar ? eur(Math.round(my.revpar)) : "—"} youW={my.revpar / revMax}
            cityStr={enough && consents.adr && pulse?.revpar != null ? eur(Math.round(pulse.revpar)) : null} cityW={pulse?.revpar != null ? pulse.revpar / revMax : null}
            delta={pulse?.revpar != null ? Math.round(my.revpar - pulse.revpar) : null} unit="€" shared={consents.adr} enough={enough} t={t} />
        </div>
      </section>

      {/* ANDAMENTO OCCUPAZIONE */}
      <section className="mt-4">
        <h3 className="text-[15px] font-bold tracking-tight text-txt">{t("Andamento occupazione")} · {WINDOW}gg</h3>
        <p className="mb-2 mt-0.5 text-xs text-dim">{t("La tua occupazione giorno per giorno; la linea tratteggiata è la media della città.")}</p>
        <div className="rounded-2xl border border-line p-4" style={{ background: "var(--surface)" }}>
          <TrendChart data={myDaily} cityAvg={enough && consents.occupancy ? pulse?.occupancy ?? null : null} t={t} />
        </div>
      </section>

      {/* ── STRUTTURE DELLA RETE ── */}
      <section className="mt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-bold tracking-tight text-txt">{t("Le strutture della rete")} · {city}</h3>
          <span className="inline-flex items-center gap-1.5 text-xs text-faint"><span className={`h-2 w-2 rounded-full ${loading ? "animate-pulse" : ""}`} style={{ background: enough ? "var(--ok)" : "var(--warn)" }} />{pulse?.n_structures ?? 0} {t("nella rete")}</span>
        </div>
        <p className="mb-2 mt-0.5 text-xs text-dim">{t("Sono queste strutture, insieme, a formare le medie. Anonime; la tua è evidenziata.")}</p>
        <div className="rounded-2xl border border-line px-4 py-3" style={{ background: "var(--surface)" }}>
          {breakdown.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-faint">
                    <th />
                    <th colSpan={3} className="pb-1 text-left font-semibold"><span className="border-b border-line pb-0.5">{t("Performance · 90 gg")}</span></th>
                    <th colSpan={3} className="pb-1 pl-4 text-left font-semibold"><span className="border-b border-line pb-0.5">{t("Domanda")}</span></th>
                    <th colSpan={4} className="pb-1 pl-4 text-left font-semibold"><span className="border-b border-line pb-0.5">{t("Ospiti & canali · 12 mesi")}</span></th>
                  </tr>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                    <th className="pb-3 font-semibold">{t("Struttura")}</th><th className="pb-3 font-semibold">{t("Occupazione")}</th><th className="pb-3 text-right font-semibold">ADR</th><th className="pb-3 text-right font-semibold">RevPAR</th>
                    <th className="pb-3 pl-4 text-right font-semibold" title={t("Occupazione già prenotata nei prossimi 30 giorni")}>{t("Occ. 30 gg")}</th>
                    <th className="pb-3 text-right font-semibold" title={t("Punti di occupazione (prossimi 30 gg) prenotati negli ultimi 7 giorni")}>{t("Pickup 7 gg")}</th>
                    <th className="pb-3 text-right font-semibold" title={t("Giorni medi tra prenotazione e arrivo")}>{t("Anticipo")}</th>
                    <th className="pb-3 pl-4 text-right font-semibold" title={t("Notti medie per soggiorno")}>{t("Durata")}</th>
                    <th className="pb-3 text-right font-semibold">{t("Cancell.")}</th>
                    <th className="pb-3 text-right font-semibold" title={t("Quota di prenotazioni dirette")}>{t("Diretto")}</th>
                    <th className="pb-3 text-right font-semibold" title={t("Quota di ospiti stranieri")}>{t("Esteri")}</th>
                  </tr>
                </thead>
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
                      <Num v={r.future_occ} fmt={pct} cls="pl-4" />
                      <Num v={r.pickup_pct} fmt={(x) => `+${Math.round(x * 100)} pt`} />
                      <Num v={r.lead_avg} fmt={(x) => `${Math.round(x)} gg`} />
                      <Num v={r.los_avg} fmt={(x) => `${x.toFixed(1).replace(".", ",")} ntt`} cls="pl-4" />
                      <Num v={r.cancel_rate} fmt={pct} />
                      <Num v={r.direct_pct} fmt={pct} />
                      <Num v={r.foreign_pct} fmt={pct} />
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
      <section className="mt-4">
        <h3 className="text-[15px] font-bold tracking-tight text-txt">{t("Cosa condividi")}</h3>
        <p className="mb-2 mt-0.5 text-xs text-dim">{t("Dai per ricevere: vedi un dato della città solo se lo condividi anche tu. Sempre anonimo e aggregato.")}</p>
        <div className="rounded-2xl border border-line px-4" style={{ background: "var(--surface)" }}>
          <ToggleRow on={consents.occupancy} onClick={() => toggle("occupancy")} label={t("Occupazione")} hint={t("% camere vendute")} />
          <ToggleRow on={consents.adr} onClick={() => toggle("adr")} label={t("Prezzi (ADR / RevPAR)")} hint={t("prezzo medio e ricavo per camera")} />
          <ToggleRow on={consents.demand} onClick={() => toggle("demand")} label={t("Domanda")} hint={t("occupazione prossimi 30 gg, pickup, anticipo di prenotazione")} />
          <ToggleRow on={consents.channels} onClick={() => toggle("channels")} label={t("Ospiti & canali")} hint={t("durata soggiorno, cancellazioni, quota diretta, ospiti stranieri")} last />
        </div>
      </section>
    </div>
  );
}

/* ───────── componenti ───────── */

const pct = (x: number) => `${Math.round(x * 100)}%`;
function Num({ v, fmt, cls = "" }: { v: number | null; fmt: (x: number) => string; cls?: string }) {
  return <td className={`border-t border-line py-3 text-right font-mono text-[13px] ${cls}`}>{v != null ? fmt(Number(v)) : <span className="text-faint">—</span>}</td>;
}

function StatCard({ label, youStr, youW, cityStr, cityW, delta, unit, shared, enough, t }: { label: string; youStr: string; youW: number; cityStr: string | null; cityW: number | null; delta: number | null; unit: string; shared: boolean; enough: boolean; t: (s: string) => string }) {
  const show = shared && enough && cityStr != null;
  const up = (delta ?? 0) >= 0;
  return (
    <div className="rounded-2xl border border-line p-4" style={{ background: "var(--surface)" }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-dim">{label}</span>
        {show && delta != null && <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: up ? "var(--ok)" : "var(--err)", background: up ? "color-mix(in srgb,var(--ok) 12%,transparent)" : "color-mix(in srgb,var(--err) 12%,transparent)" }}>{up ? "▲ +" : "▼ "}{unit === "€" ? eur(delta) : `${Math.abs(delta)} pt`}</span>}
      </div>
      <div className="mt-1 font-mono text-3xl font-extrabold tracking-tight text-txt">{youStr}</div>
      <div className="relative mt-3 h-2 rounded-full" style={{ background: "var(--wash)" }}>
        <div className="absolute left-0 top-0 h-2 rounded-full" style={{ width: `${clamp(youW, 0, 1) * 100}%`, background: "var(--focus)" }} />
        {show && cityW != null && <div className="absolute -top-1 h-4 w-0.5 rounded" style={{ left: `${clamp(cityW, 0, 1) * 100}%`, background: "var(--faint)" }} title={t("media città")} />}
      </div>
      <div className="mt-2 text-[11px]">
        {show ? <span className="text-dim">{t("media città")} <b className="text-txt">{cityStr}</b></span> : <span className="text-faint">{shared ? t("città: dati insufficienti") : `🔒 ${t("condividi per vedere la città")}`}</span>}
      </div>
    </div>
  );
}

function TrendChart({ data, cityAvg, t }: { data: { date: string; rooms_total: number; rooms_sold: number }[]; cityAvg: number | null; t: (s: string) => string }) {
  if (data.length < 2) return <p className="text-xs text-faint">{t("Dati insufficienti per il grafico.")}</p>;
  const W = 660, H = 130, pad = 6;
  const pts = data.map((r, i) => { const x = pad + (i / (data.length - 1)) * (W - pad * 2); const occ = r.rooms_total ? r.rooms_sold / r.rooms_total : 0; return [x, H - pad - occ * (H - pad * 2)] as const; });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - pad} L${pts[0][0].toFixed(1)},${H - pad} Z`;
  const last = pts[pts.length - 1];
  const cityY = cityAvg == null ? null : H - pad - cityAvg * (H - pad * 2);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
        <defs><linearGradient id="tr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--focus)" stopOpacity="0.4" /><stop offset="1" stopColor="var(--focus)" stopOpacity="0" /></linearGradient></defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={pad} x2={W - pad} y1={H - pad - g * (H - pad * 2)} y2={H - pad - g * (H - pad * 2)} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 5" />)}
        <path d={area} fill="url(#tr)" />
        <path d={line} fill="none" stroke="var(--focus)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {cityY != null && <line x1={pad} x2={W - pad} y1={cityY} y2={cityY} stroke="#f59e0b" strokeWidth="2" strokeDasharray="6 4" />}
        <circle cx={last[0]} cy={last[1]} r="4" fill="var(--focus)" stroke="var(--surface)" strokeWidth="2" />
      </svg>
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
