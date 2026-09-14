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

  // Camere e tipologie della struttura.
  const sUnits = useMemo(() => units.filter((u) => u.structureId === struct?.id && !u.outOfService), [units, struct?.id]);
  const sRooms = sUnits.length;
  const sTypes = useMemo(() => roomTypes.filter((rt) => rt.structureId === struct?.id), [roomTypes, struct?.id]);
  const mainType = useMemo(() => {
    if (!sTypes.length) return undefined;
    const counts = sTypes.map((rt) => ({ rt, n: sUnits.filter((u) => u.roomTypeId === rt.id).length }));
    counts.sort((a, b) => b.n - a.n);
    return counts[0].rt;
  }, [sTypes, sUnits]);

  // Storico giornaliero (mio) — ultimi 90 giorni.
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

  // Metriche mie aggregate.
  const my = useMemo(() => {
    const rt = myDaily.reduce((s, r) => s + r.rooms_total, 0);
    const rs = myDaily.reduce((s, r) => s + r.rooms_sold, 0);
    const rev = myDaily.reduce((s, r) => s + r.revenue, 0);
    return { occ: rt ? rs / rt : 0, adr: rs ? rev / rs : 0, revpar: rt ? rev / rt : 0 };
  }, [myDaily]);

  // Occupazione storica per giorno-della-settimana (stagionalità mia).
  const dowOcc = useMemo(() => {
    const acc: Record<number, { s: number; t: number }> = {};
    for (const r of myDaily) { const a = acc[r.dow] ?? (acc[r.dow] = { s: 0, t: 0 }); a.s += r.rooms_sold; a.t += r.rooms_total; }
    const out: Record<number, number> = {};
    for (let d = 0; d < 7; d++) out[d] = acc[d]?.t ? acc[d].s / acc[d].t : my.occ;
    return out;
  }, [myDaily, my.occ]);

  // Prezzo base di riferimento (per il motore): ADR realizzato o basePrice della tipologia principale.
  const basePrice = useMemo(() => {
    const fromAdr = my.adr > 0 ? Math.round(my.adr) : 0;
    const fromType = mainType?.basePrice ?? 0;
    return fromAdr || fromType || 90;
  }, [my.adr, mainType]);

  // ── MOTORE PREZZI DINAMICI LOCALE ──
  // Per ogni giorno futuro calcola un fattore (moltiplicatore) dai segnali disponibili:
  //  stagionalità (giorno settimana), pickup attuale (on-the-books), gap col mercato città (ADR/occupazione).
  const cityHot = pulse?.occupancy != null && pulse.occupancy > my.occ + 0.05;
  const adrGap = pulse?.adr != null && my.adr > 0 ? (pulse.adr - my.adr) / my.adr : 0; // >0 = sotto la media città
  const engine = useMemo(() => {
    if (!struct || sRooms === 0) return [] as { date: string; factor: number; price: number; occ: number; sold: number; reason: string; level: number }[];
    const today = toISO(new Date());
    const mine = bookings.filter((b) => b.structureId === struct.id && b.status !== "cancelled" && b.channel !== "blocked");
    const out = [];
    for (let i = 0; i < FUTURE; i++) {
      const D = shiftISO(today, i);
      const wd = dow(D);
      const sold = mine.filter((b) => b.checkIn <= D && b.checkOut > D).length;
      const pickup = sRooms ? sold / sRooms : 0;
      let f = 1; const reasons: { w: number; txt: string }[] = [];
      // 1) stagionalità weekend/settimana
      if (wd === 5 || wd === 6) { f *= 1.12; reasons.push({ w: 0.12, txt: t("weekend") }); }
      else if (wd === 0) { f *= 0.97; }
      // 2) pickup (on-the-books)
      if (pickup >= 0.7) { f *= 1.15; reasons.push({ w: 0.15, txt: t("richiesta alta (quasi pieno)") }); }
      else if (pickup <= 0.2 && i <= 10) { f *= 0.92; reasons.push({ w: 0.08, txt: t("last-minute da riempire") }); }
      // 3) segnale città
      if (cityHot) { f *= 1.08; reasons.push({ w: 0.08, txt: t("città molto piena") }); }
      if (adrGap > 0.05) { const up = clamp(adrGap, 0, 0.15); f *= 1 + up; reasons.push({ w: up, txt: t("sotto la media prezzi città") }); }
      else if (adrGap < -0.08) { f *= 0.96; reasons.push({ w: 0.05, txt: t("sopra la media città") }); }
      f = clamp(f, 0.8, 1.5);
      reasons.sort((a, b) => b.w - a.w);
      const price = Math.round(basePrice * f);
      const level = clamp((f - 0.85) / (1.4 - 0.85), 0, 1); // 0..1 per heatmap
      out.push({ date: D, factor: f, price, occ: dowOcc[wd] ?? my.occ, sold, reason: reasons[0]?.txt || t("prezzo stabile"), level });
    }
    return out;
  }, [struct, sRooms, bookings, basePrice, cityHot, adrGap, dowOcc, my.occ, t]);

  const potential = useMemo(() => {
    // stima ricavo aggiuntivo/30gg: differenza prezzo consigliato vs base sulle camere prevedibilmente vendute
    const extra = engine.reduce((s, d) => s + (d.price - basePrice) * Math.max(d.sold, Math.round((dowOcc[dow(d.date)] ?? my.occ) * sRooms)), 0);
    return Math.round(extra);
  }, [engine, basePrice, dowOcc, my.occ, sRooms]);

  // ── consensi + sync ──
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
      const row = Array.isArray(data) ? data[0] : data;
      setPulse((row as Pulse) ?? null);
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
    for (const rt of sTypes) {
      const base = rt.basePrice ?? basePrice;
      for (const d of engine) map[`${rt.id}|${d.date}`] = Math.max(0, Math.round(base * d.factor));
    }
    setDayRates(map);
    setApplied(true); setTimeout(() => setApplied(false), 2200);
  };

  if (!struct) return (<div><PageHeader title={t("Rete città")} subtitle={t("Confronta la tua struttura con il mercato locale")} /><Card><p className="text-sm text-dim">{t("Aggiungi prima una struttura.")}</p></Card></div>);
  if (!city) return (<div><PageHeader title={t("Rete città")} subtitle={t("Confronta la tua struttura con il mercato locale")} /><Card><p className="text-sm text-dim">{t("Imposta la città nella scheda della struttura per attivare la rete.")}</p></Card></div>);

  return (
    <div>
      <PageHeader title={t("Rete città")} subtitle={`${t("Il mercato di")} ${city} · ${t("anonimo e aggregato")}`} />

      {/* ── Cruscotto KPI ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Gauge label={t("Occupazione")} you={my.occ} city={enough && consents.occupancy ? pulse?.occupancy ?? null : null} fmt={pctS} />
        <Gauge label={t("ADR · prezzo medio")} you={my.adr ? my.adr / Math.max(my.adr, pulse?.adr ?? my.adr, 1) : 0} youRaw={my.adr} cityRaw={enough && consents.adr ? pulse?.adr ?? null : null} money />
        <Gauge label={t("RevPAR")} you={my.revpar ? my.revpar / Math.max(my.revpar, pulse?.revpar ?? my.revpar, 1) : 0} youRaw={my.revpar} cityRaw={enough && consents.adr ? pulse?.revpar ?? null : null} money />
      </div>

      {/* ── Motore prezzi dinamici ── */}
      <Card className="mt-4" >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-grid h-7 w-7 place-items-center rounded-lg text-white" style={{ background: "linear-gradient(135deg,var(--focus),#7c3aed)" }}>⚡</span>
            <SectionTitle>{t("Motore prezzi dinamici")}</SectionTitle>
          </div>
          <div className="flex items-center gap-2">
            {potential > 0 && <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "color-mix(in srgb,var(--ok) 15%,transparent)", color: "var(--ok)" }}>+{eur(potential)} {t("potenziale/30gg")}</span>}
            <button onClick={applyPrices} className="rounded-lg px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90" style={{ background: "linear-gradient(135deg,var(--focus),#7c3aed)" }}>{applied ? `${t("Applicati")} ✓` : `${t("Applica prossimi")} ${FUTURE}gg`}</button>
          </div>
        </div>
        <p className="mb-3 mt-1 text-xs text-dim">{t("Prezzo consigliato per i prossimi 30 giorni, dai tuoi dati")} {cityHot || adrGap > 0.05 ? `+ ${t("segnali della città")}` : ""}. {t("Base")}: <b className="text-txt">{eur(basePrice)}</b>. {t("Puoi applicarli e poi ritoccarli a mano.")}</p>

        {/* heatmap domanda / prezzo */}
        <Heatmap days={engine} base={basePrice} t={t} />

        {/* dettaglio prossimi giorni salienti */}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {engine.filter((d) => Math.abs(d.factor - 1) >= 0.06).slice(0, 6).map((d) => (
            <div key={d.date} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2" style={{ background: "var(--wash)" }}>
              <div>
                <div className="text-sm font-semibold text-txt">{new Date(d.date + "T00:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" })}</div>
                <div className="text-[11px] text-dim">{d.reason}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-base font-bold" style={{ color: d.factor >= 1 ? "var(--ok)" : "var(--warn)" }}>{eur(d.price)}</div>
                <div className="text-[11px] font-semibold" style={{ color: d.factor >= 1 ? "var(--ok)" : "var(--warn)" }}>{d.factor >= 1 ? "+" : ""}{Math.round((d.factor - 1) * 100)}%</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Andamento occupazione (tu vs città storico) ── */}
      <Card className="mt-4">
        <SectionTitle>{t("Andamento occupazione")} · {WINDOW}gg</SectionTitle>
        <TrendChart data={myDaily} t={t} />
      </Card>

      {/* ── Polso del mercato ── */}
      <Card className="mt-4">
        <div className="flex items-center justify-between">
          <SectionTitle>{t("Polso del mercato")}</SectionTitle>
          <span className="text-xs text-faint">{loading ? t("Aggiorno…") : `${pulse?.n_structures ?? 0} ${t("strutture nella rete")}`}</span>
        </div>
        {!enough && (
          <div className="mb-3 rounded-lg border border-line p-3 text-xs text-dim" style={{ background: "var(--wash)" }}>
            {t("Servono almeno")} {THRESHOLD} {t("strutture della tua città nella rete per mostrare i dati aggregati (anonimato). Più siete, più i prezzi dinamici sono precisi.")}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Compare label={t("Occupazione")} shared={consents.occupancy} enough={enough} cityStr={pctS(pulse?.occupancy)} youStr={pctS(pulse?.my_occupancy)} t={t} />
          <Compare label={t("ADR")} shared={consents.adr} enough={enough} cityStr={pulse?.adr != null ? eur(Math.round(pulse.adr)) : "—"} youStr={pulse?.my_adr != null ? eur(Math.round(pulse.my_adr)) : "—"} t={t} />
          <Compare label={t("RevPAR")} shared={consents.adr} enough={enough} cityStr={pulse?.revpar != null ? eur(Math.round(pulse.revpar)) : "—"} youStr={pulse?.my_revpar != null ? eur(Math.round(pulse.my_revpar)) : "—"} t={t} />
        </div>
      </Card>

      {/* ── Elenco anonimo delle strutture della rete ── */}
      <Card className="mt-4">
        <div className="flex items-center justify-between">
          <SectionTitle>{t("Le strutture della rete")} · {city}</SectionTitle>
          <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "color-mix(in srgb,var(--focus) 12%,transparent)", color: "var(--focus)" }}>{breakdown.length || pulse?.n_structures || 0} {t("strutture")}</span>
        </div>
        <p className="mb-3 text-xs text-dim">{t("Elenco anonimo: sono queste strutture, insieme, a formare le medie qui sopra. Ogni riga è una struttura (senza nome), la tua è evidenziata.")}</p>
        {breakdown.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="border-b border-line py-2 pr-3 font-medium">{t("Struttura")}</th>
                  <th className="border-b border-line py-2 pr-3 text-right font-medium">{t("Occupazione")}</th>
                  <th className="border-b border-line py-2 pr-3 text-right font-medium">ADR</th>
                  <th className="border-b border-line py-2 text-right font-medium">RevPAR</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((r) => (
                  <tr key={r.idx} style={r.is_me ? { background: "color-mix(in srgb,var(--focus) 8%,transparent)" } : undefined}>
                    <td className="border-b border-line py-2 pr-3">
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-grid h-6 w-6 place-items-center rounded-md text-[11px] font-bold" style={{ background: r.is_me ? "var(--focus)" : "var(--wash)", color: r.is_me ? "#fff" : "var(--dim)" }}>{r.is_me ? "★" : r.idx}</span>
                        <span className={r.is_me ? "font-semibold text-txt" : "text-dim"}>{r.is_me ? t("La tua struttura") : `${t("Struttura")} ${r.idx}`}</span>
                      </span>
                    </td>
                    <td className="border-b border-line py-2 pr-3 text-right font-mono">{r.occupancy != null ? `${Math.round(r.occupancy * 100)}%` : "—"}</td>
                    <td className="border-b border-line py-2 pr-3 text-right font-mono">{r.adr != null ? eur(Math.round(r.adr)) : "—"}</td>
                    <td className="border-b border-line py-2 text-right font-mono">{r.revpar != null ? eur(Math.round(r.revpar)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-faint">{t("Le colonne mostrano un dato solo se quella struttura lo condivide e se lo condividi anche tu (reciprocità). “—” = non condiviso.")}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-line p-3 text-xs text-dim" style={{ background: "var(--wash)" }}>
            {t("L'elenco compare quando nella tua città ci sono almeno")} {THRESHOLD} {t("strutture nella rete. Invita altri gestori: più siete, più i dati (e i prezzi dinamici) sono precisi.")}
          </div>
        )}
      </Card>

      {/* ── Consensi ── */}
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

function Gauge({ label, you, city, youRaw, cityRaw, fmt, money }: { label: string; you: number; city?: number | null; youRaw?: number; cityRaw?: number | null; fmt?: (v: number | null | undefined) => string; money?: boolean }) {
  const v = clamp(you, 0, 1);
  const R = 46, C = Math.PI * R, off = C * (1 - v);
  const youLabel = money ? (youRaw ? eur(Math.round(youRaw)) : "—") : (fmt ? fmt(you) : `${Math.round(you * 100)}%`);
  const cityLabel = money ? (cityRaw != null ? eur(Math.round(cityRaw)) : null) : (city != null ? (fmt ? fmt(city) : `${Math.round(city * 100)}%`) : null);
  return (
    <div className="rounded-2xl border border-line p-4" style={{ background: "linear-gradient(180deg,var(--surface),color-mix(in srgb,var(--focus) 5%,var(--surface)))" }}>
      <div className="text-xs font-medium text-dim">{label}</div>
      <div className="relative mt-1 flex items-end justify-center" style={{ height: 74 }}>
        <svg viewBox="0 0 110 60" width="150" height="82" style={{ overflow: "visible" }}>
          <path d="M8,56 A46,46 0 0 1 102,56" fill="none" stroke="var(--line)" strokeWidth="9" strokeLinecap="round" />
          <path d="M8,56 A46,46 0 0 1 102,56" fill="none" stroke="url(#gg)" strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off} />
          <defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--focus)" /><stop offset="1" stopColor="#7c3aed" /></linearGradient></defs>
        </svg>
        <div className="absolute bottom-0 text-center">
          <div className="font-mono text-xl font-extrabold text-txt">{youLabel}</div>
          <div className="text-[10px] text-faint">{money ? "ADR/RevPAR" : ""}</div>
        </div>
      </div>
      <div className="mt-1 text-center text-[11px]">
        {cityLabel != null ? <span className="text-dim">{"città "}<b className="text-txt">{cityLabel}</b></span> : <span className="text-faint">città: —</span>}
      </div>
    </div>
  );
}

function Heatmap({ days, base, t }: { days: { date: string; price: number; level: number; factor: number }[]; base: number; t: (s: string) => string }) {
  if (!days.length) return <p className="text-xs text-faint">{t("Aggiungi camere e prezzi per vedere i consigli.")}</p>;
  const col = (lvl: number) => {
    // 0 (sconto) → blu ; 0.5 neutro ; 1 (alta domanda) → arancio/rosso
    if (lvl < 0.45) return `color-mix(in srgb, #3b82f6 ${Math.round((0.45 - lvl) / 0.45 * 70) + 15}%, var(--surface))`;
    if (lvl > 0.55) return `color-mix(in srgb, #f59e0b ${Math.round((lvl - 0.55) / 0.45 * 75) + 15}%, var(--surface))`;
    return "color-mix(in srgb, var(--dim) 12%, var(--surface))";
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {days.map((d) => (
          <div key={d.date} title={`${new Date(d.date + "T00:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" })} · ${eur(d.price)} (${d.factor >= 1 ? "+" : ""}${Math.round((d.factor - 1) * 100)}%)`}
            className="grid place-items-center rounded-md border text-[10px] font-bold"
            style={{ width: 40, height: 40, background: col(d.level), borderColor: "var(--line)", color: "var(--txt)" }}>
            <span>{new Date(d.date + "T00:00:00").getDate()}</span>
            <span className="text-[9px] font-mono opacity-80">{d.price}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-faint">
        <span className="flex items-center gap-1"><i className="inline-block h-3 w-3 rounded" style={{ background: "#3b82f6" }} /> {t("sconto / bassa domanda")}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-3 w-3 rounded" style={{ background: "#f59e0b" }} /> {t("rialzo / alta domanda")}</span>
        <span className="ml-auto">{t("Base")} {eur(base)}</span>
      </div>
    </div>
  );
}

function TrendChart({ data, t }: { data: { date: string; rooms_total: number; rooms_sold: number }[]; t: (s: string) => string }) {
  if (data.length < 2) return <p className="text-xs text-faint">{t("Dati insufficienti per il grafico.")}</p>;
  const W = 640, H = 120, pad = 6;
  const pts = data.map((r, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const occ = r.rooms_total ? r.rooms_sold / r.rooms_total : 0;
    const y = H - pad - occ * (H - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - pad} L${pts[0][0].toFixed(1)},${H - pad} Z`;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
        <defs><linearGradient id="tr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--focus)" stopOpacity="0.35" /><stop offset="1" stopColor="var(--focus)" stopOpacity="0" /></linearGradient></defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={pad} x2={W - pad} y1={H - pad - g * (H - pad * 2)} y2={H - pad - g * (H - pad * 2)} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 4" />)}
        <path d={area} fill="url(#tr)" />
        <path d={line} fill="none" stroke="var(--focus)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-faint"><span>{new Date(data[0].date + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}</span><span>{t("oggi")}</span></div>
    </div>
  );
}

function Compare({ label, shared, enough, cityStr, youStr, t }: { label: string; shared: boolean; enough: boolean; cityStr: string; youStr: string; t: (s: string) => string }) {
  return (
    <div className="rounded-xl border border-line p-4" style={{ background: "var(--surface)" }}>
      <div className="text-xs text-dim">{label}</div>
      {!shared ? <div className="mt-1 text-sm font-semibold text-faint">🔒 {t("Condividi per vedere")}</div>
        : !enough ? <div className="mt-1 text-sm font-semibold text-faint">{t("Dati insufficienti")}</div>
        : (<><div className="mt-0.5 font-mono text-2xl font-bold text-txt">{cityStr}</div><div className="mt-1 text-xs text-dim">{t("Media città")}</div><div className="mt-2 border-t border-dashed border-line pt-2 text-xs"><span className="text-faint">{t("La tua struttura")}: </span><span className="font-mono font-semibold text-txt">{youStr}</span></div></>)}
    </div>
  );
}

function ToggleRow({ on, onClick, label, hint, disabled }: { on: boolean; onClick: () => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div><div className="text-sm font-medium text-txt">{label}</div>{hint && <div className="text-[11px] text-faint">{hint}</div>}</div>
      <button type="button" disabled={disabled} onClick={onClick} aria-pressed={on} className="relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40" style={{ backgroundColor: on ? "var(--ok)" : "var(--line)" }}>
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: on ? 22 : 2 }} />
      </button>
    </div>
  );
}
