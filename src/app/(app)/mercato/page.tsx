"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";
import { toISO, shiftISO, nights } from "@/lib/dates";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";

const WINDOW = 90; // giorni di storico condivisi/analizzati
const THRESHOLD = 3; // deve combaciare con la soglia della funzione DB market_pulse

type Consents = { occupancy: boolean; adr: boolean; demand: boolean; channels: boolean };
type Pulse = { n_structures: number; occupancy: number | null; adr: number | null; revpar: number | null; my_occupancy: number | null; my_adr: number | null; my_revpar: number | null };

export default function MercatoPage() {
  const { t } = useLang();
  const { structures, units, bookings, activeStructureId } = useData();
  const { user } = useAuth();

  // Struttura di riferimento: quella attiva (se ha città), altrimenti la prima con città.
  const struct = useMemo(() => {
    const active = structures.find((s) => s.id === activeStructureId && (s.city || "").trim());
    return active || structures.find((s) => (s.city || "").trim()) || structures[0];
  }, [structures, activeStructureId]);
  const city = (struct?.city || "").trim();

  const [consents, setConsents] = useState<Consents>({ occupancy: true, adr: true, demand: false, channels: false });
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  // Calcola i dati giornalieri (ultimi 90 gg) della mia struttura dai miei dati locali.
  const myDaily = useMemo(() => {
    if (!struct) return [] as { date: string; rooms_total: number; rooms_sold: number; revenue: number }[];
    const roomsTotal = units.filter((u) => u.structureId === struct.id && !u.outOfService).length;
    if (roomsTotal === 0) return [];
    const today = toISO(new Date());
    const rows: { date: string; rooms_total: number; rooms_sold: number; revenue: number }[] = [];
    const mine = bookings.filter((b) => b.structureId === struct.id && b.status !== "cancelled" && b.channel !== "blocked");
    for (let i = 0; i < WINDOW; i++) {
      const D = shiftISO(today, -i);
      const active = mine.filter((b) => b.checkIn <= D && b.checkOut > D);
      const revenue = active.reduce((s, b) => s + (b.total || 0) / Math.max(1, nights(b.checkIn, b.checkOut)), 0);
      rows.push({ date: D, rooms_total: roomsTotal, rooms_sold: active.length, revenue: Math.round(revenue) });
    }
    return rows;
  }, [struct, units, bookings]);

  // Carica i consensi salvati per questa struttura.
  useEffect(() => {
    if (!supabase || !user?.id || !struct?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase!.from("market_share").select("*").eq("user_id", user.id).eq("structure_id", struct.id).maybeSingle();
        if (cancelled || !data) return;
        setConsents({ occupancy: !!data.share_occupancy, adr: !!data.share_adr, demand: !!data.share_demand, channels: !!data.share_channels });
      } catch { /* usa i default */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id, struct?.id]);

  // Sincronizza consensi + dati e ricarica il polso di mercato.
  const refresh = useCallback(async () => {
    if (!supabase || !user?.id || !struct?.id || !city) return;
    setLoading(true);
    try {
      const anyShare = consents.occupancy || consents.adr || consents.demand || consents.channels;
      // 1) salva i consensi
      await supabase.from("market_share").upsert({
        user_id: user.id, structure_id: struct.id, city,
        share_occupancy: consents.occupancy, share_adr: consents.adr, share_demand: consents.demand, share_channels: consents.channels,
        updated_at: new Date().toISOString(),
      });
      // 2) condividi i dati (se almeno un consenso è attivo), altrimenti ritira i miei dati
      if (anyShare && myDaily.length) {
        await supabase.from("market_daily").upsert(myDaily.map((r) => ({ user_id: user.id, structure_id: struct.id, city, ...r })));
      } else {
        await supabase.from("market_daily").delete().eq("user_id", user.id).eq("structure_id", struct.id);
      }
      // 3) leggi il polso del mercato (aggregato anonimo + reciprocità nella funzione DB)
      const from = shiftISO(toISO(new Date()), -WINDOW);
      const to = toISO(new Date());
      const { data } = await supabase.rpc("market_pulse", { p_city: city, p_from: from, p_to: to });
      const row = Array.isArray(data) ? data[0] : data;
      setPulse((row as Pulse) ?? null);
      setSaved(true); setTimeout(() => setSaved(false), 1500);
    } catch { /* silenzioso */ }
    finally { setLoading(false); }
  }, [consents, user?.id, struct?.id, city, myDaily]);

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [consents, struct?.id, city]);

  const toggle = (k: keyof Consents) => setConsents((c) => ({ ...c, [k]: !c[k] }));

  const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  const enough = (pulse?.n_structures ?? 0) >= THRESHOLD;

  if (!struct) return (<div><PageHeader title={t("Rete città")} subtitle={t("Confronta la tua struttura con il mercato locale")} /><Card><p className="text-sm text-dim">{t("Aggiungi prima una struttura.")}</p></Card></div>);
  if (!city) return (<div><PageHeader title={t("Rete città")} subtitle={t("Confronta la tua struttura con il mercato locale")} /><Card><p className="text-sm text-dim">{t("Imposta la città nella scheda della struttura per attivare la rete.")}</p></Card></div>);

  const metric = (label: string, shared: boolean, cityVal: string, myVal: string, cityRaw: number | null) => (
    <div className="rounded-xl border border-line bg-panel p-4" style={{ background: "var(--surface)" }}>
      <div className="text-xs text-dim">{label}</div>
      {!shared ? (
        <div className="mt-1 text-sm font-semibold text-faint">🔒 {t("Condividi per vedere")}</div>
      ) : !enough ? (
        <div className="mt-1 text-sm font-semibold text-faint">{t("Dati insufficienti")}</div>
      ) : (
        <>
          <div className="mt-0.5 font-mono text-2xl font-bold text-txt">{cityVal}</div>
          <div className="mt-1 text-xs text-dim">{t("Media città")}</div>
          {cityRaw != null && (
            <div className="mt-2 border-t border-dashed border-line pt-2 text-xs">
              <span className="text-faint">{t("La tua struttura")}: </span><span className="font-mono font-semibold text-txt">{myVal}</span>
            </div>
          )}
        </>
      )}
    </div>
  );

  const Row = ({ k, label, hint, disabled }: { k: keyof Consents; label: string; hint?: string; disabled?: boolean }) => (
    <div className="flex items-center justify-between gap-3 py-2">
      <div><div className="text-sm font-medium text-txt">{label}</div>{hint && <div className="text-[11px] text-faint">{hint}</div>}</div>
      <button type="button" disabled={disabled} onClick={() => toggle(k)} aria-pressed={consents[k]} className="relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40" style={{ backgroundColor: consents[k] ? "var(--ok)" : "var(--line)" }}>
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: consents[k] ? 22 : 2 }} />
      </button>
    </div>
  );

  return (
    <div>
      <PageHeader title={t("Rete città")} subtitle={`${t("Il mercato di")} ${city} · ${t("anonimo e aggregato")}`} />

      <Card>
        <div className="flex items-center justify-between">
          <SectionTitle>{t("Cosa condividi")}</SectionTitle>
          {saved && <span className="text-xs font-semibold" style={{ color: "var(--ok)" }}>{t("Salvato")} ✓</span>}
        </div>
        <p className="mb-1 text-xs text-dim">{t("Dai per ricevere: vedi un dato della città solo se lo condividi anche tu. Sempre anonimo e aggregato.")}</p>
        <div className="divide-y divide-[color:var(--line)]">
          <Row k="occupancy" label={t("Occupazione")} hint={t("% camere vendute")} />
          <Row k="adr" label={t("Prezzi (ADR / RevPAR)")} hint={t("prezzo medio e ricavo per camera")} />
          <Row k="demand" label={t("Domanda futura")} hint={t("in arrivo (v2)")} disabled />
          <Row k="channels" label={t("Mix canali")} hint={t("in arrivo")} disabled />
        </div>
      </Card>

      <Card className="mt-4">
        <div className="flex items-center justify-between">
          <SectionTitle>{t("Polso del mercato")}</SectionTitle>
          <span className="text-xs text-faint">{loading ? t("Aggiorno…") : `${pulse?.n_structures ?? 0} ${t("strutture nella rete")}`}</span>
        </div>
        {!enough && (
          <div className="mb-3 rounded-lg border border-line bg-wash p-3 text-xs text-dim">
            {t("Servono almeno")} {THRESHOLD} {t("strutture della tua città nella rete per mostrare i dati aggregati (anonimato). Invita altri gestori: più siete, più i dati sono precisi.")}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {metric(t("Occupazione"), consents.occupancy, pct(pulse?.occupancy), pct(pulse?.my_occupancy), pulse?.my_occupancy ?? null)}
          {metric(t("ADR (prezzo medio)"), consents.adr, pulse?.adr != null ? eur(Math.round(pulse.adr)) : "—", pulse?.my_adr != null ? eur(Math.round(pulse.my_adr)) : "—", pulse?.my_adr ?? null)}
          {metric(t("RevPAR"), consents.adr, pulse?.revpar != null ? eur(Math.round(pulse.revpar)) : "—", pulse?.my_revpar != null ? eur(Math.round(pulse.my_revpar)) : "—", pulse?.my_revpar ?? null)}
        </div>
        <p className="mt-3 text-[11px] text-faint">{t("Basato sugli ultimi")} {WINDOW} {t("giorni. I tuoi dati entrano nella media in forma anonima solo per ciò che hai scelto di condividere.")}</p>
      </Card>
    </div>
  );
}
