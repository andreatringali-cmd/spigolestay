"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import type { Competitor, MarketRateRow } from "@/lib/ratecheck/service";

const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const todayISO = () => new Date().toISOString().slice(0, 10);

const DAYS = 14;
const cfgKey = (structureId: string) => `spigolestay:ratecheck:${structureId || "all"}`;

function loadCompetitors(structureId: string): Competitor[] {
  try {
    const raw = localStorage.getItem(cfgKey(structureId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((c) => c && typeof c.name === "string" && c.name.trim()).map((c) => ({ name: String(c.name).trim(), url: c.url ? String(c.url).trim() : undefined, id: c.id ? String(c.id).trim() : undefined }));
  } catch { return []; }
}
function saveCompetitors(structureId: string, list: Competitor[]) {
  try { localStorage.setItem(cfgKey(structureId), JSON.stringify(list)); } catch {}
}

// Confronto tariffa reale vs media di mercato → posizione + colore.
function position(mine: number, avg: number): { key: "sotto" | "linea" | "sopra"; label: string; color: string; bg: string } {
  const pct = avg > 0 ? (mine - avg) / avg : 0;
  if (pct <= -0.03) return { key: "sotto", label: "sotto mercato", color: "var(--ok)", bg: "color-mix(in srgb, var(--ok) 14%, transparent)" };
  if (pct >= 0.03) return { key: "sopra", label: "sopra mercato", color: "var(--err)", bg: "color-mix(in srgb, var(--err) 14%, transparent)" };
  return { key: "linea", label: "in linea", color: "var(--dim)", bg: "var(--wash)" };
}

export default function RateCheckerPage() {
  const { roomTypes, rateOverrides, activeStructureId, structures } = useData();
  const { t } = useLang();

  const rts = roomTypes.filter((rt) => activeStructureId === "all" || rt.structureId === activeStructureId);
  const avgBase = rts.length ? Math.round(rts.reduce((a, rt) => a + rt.basePrice, 0) / rts.length) : 0;

  const activeStructure = activeStructureId !== "all" ? structures.find((s) => s.id === activeStructureId) : undefined;

  // Config competitor (localStorage per struttura) — NON tocca lo store globale.
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [draft, setDraft] = useState<{ name: string; url: string; id: string }>({ name: "", url: "", id: "" });
  const [showConfig, setShowConfig] = useState(false);

  // Stato connettore: null = non ancora verificato, true/false = provider configurato o no.
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [market, setMarket] = useState<MarketRateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setCompetitors(loadCompetitors(activeStructureId)); }, [activeStructureId]);

  const persist = (list: Competitor[]) => { setCompetitors(list); saveCompetitors(activeStructureId, list); };
  const addCompetitor = () => {
    const name = draft.name.trim();
    if (!name) return;
    persist([...competitors, { name: name.slice(0, 120), url: draft.url.trim() || undefined, id: draft.id.trim() || undefined }]);
    setDraft({ name: "", url: "", id: "" });
  };
  const removeCompetitor = (i: number) => persist(competitors.filter((_, idx) => idx !== i));

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      let token: string | undefined;
      try { token = (await supabase?.auth.getSession())?.data.session?.access_token; } catch {}
      const r = await fetch("/api/ratecheck", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          structureId: activeStructureId,
          from: todayISO(),
          days: DAYS,
          competitors,
          lat: activeStructure?.lat,
          lng: activeStructure?.lng,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setConfigured(null); setErr(j?.message || t("Errore nel contattare il servizio.")); setMarket([]); return; }
      if (j?.configured === false) { setConfigured(false); setMarket([]); return; }
      setConfigured(true);
      setMarket(Array.isArray(j?.rows) ? j.rows : []);
      if (j?.error) setErr(String(j.error));
    } catch {
      setConfigured(null); setErr(t("Errore di rete.")); setMarket([]);
    } finally { setLoading(false); }
  }, [activeStructureId, competitors, activeStructure?.lat, activeStructure?.lng, t]);

  // Verifica il connettore al caricamento e quando cambia struttura o lista competitor.
  useEffect(() => { void refresh(); }, [refresh]);

  const marketByDate = useMemo(() => { const m = new Map<string, MarketRateRow>(); for (const r of market) m.set(r.date, r); return m; }, [market]);

  const rows = useMemo(() => {
    const start = todayISO();
    return Array.from({ length: DAYS }, (_, i) => {
      const iso = addDays(start, i);
      const mine = rateOverrides[iso] ?? avgBase;
      return { iso, mine, mkt: marketByDate.get(iso) };
    });
  }, [rateOverrides, avgBase, marketByDate]);

  const isConfigured = configured === true;

  return (
    <div>
      <PageHeader title="Rate checker" subtitle={t("Confronta le tue tariffe con i competitor della zona")} />

      {/* Stato connettore rate shopping */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: isConfigured ? "var(--ok)" : "var(--warn)" }}>{isConfigured ? "✓" : "!"}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-txt">{t("Confronto competitor")}</div>
            <div className="text-xs text-dim">
              {configured === null && loading ? t("Verifica del servizio in corso…")
                : isConfigured ? t("Provider di rate shopping collegato. Il confronto usa dati reali di mercato.")
                : t("Nessun provider collegato. Imposta le variabili d'ambiente per attivare il confronto con dati reali.")}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={() => setShowConfig((v) => !v)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-dim hover:bg-wash">{t("Competitor")}{competitors.length ? ` · ${competitors.length}` : ""}</button>
            <button onClick={() => void refresh()} disabled={loading} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">{loading ? t("Aggiorno…") : t("Aggiorna")}</button>
          </div>
        </div>

        {err && isConfigured && <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 14%, transparent)", color: "var(--warn)" }}>{err}</div>}

        {/* Config competitor */}
        {showConfig && (
          <div className="mt-4 border-t border-line pt-4">
            <SectionTitle>{t("Set competitor")}</SectionTitle>
            <p className="mb-3 text-xs text-dim">{t("Elenca le strutture simili da confrontare (nome + eventuale link o ID). La lista è salvata solo su questo dispositivo.")}</p>
            {competitors.length > 0 && (
              <ul className="mb-3 space-y-1.5">
                {competitors.map((c, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg border border-line bg-wash px-3 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-txt">{c.name}</span>
                      {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-focus hover:underline">{t("link")}</a>}
                      {c.id && <span className="ml-2 text-xs text-faint">#{c.id}</span>}
                    </span>
                    <button onClick={() => removeCompetitor(i)} className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold text-err hover:bg-surface" style={{ color: "var(--err)" }}>{t("Rimuovi")}</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex-1 min-w-[160px] text-xs font-medium text-dim">
                {t("Nome")}
                <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") addCompetitor(); }} placeholder={t("Es. B&B Ortigia Mare")} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt outline-none focus:border-focus" />
              </label>
              <label className="flex-1 min-w-[160px] text-xs font-medium text-dim">
                {t("URL annuncio (opz.)")}
                <input value={draft.url} onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") addCompetitor(); }} placeholder="https://…" className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt outline-none focus:border-focus" />
              </label>
              <label className="w-28 text-xs font-medium text-dim">
                {t("ID (opz.)")}
                <input value={draft.id} onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") addCompetitor(); }} placeholder="prop_123" className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt outline-none focus:border-focus" />
              </label>
              <button onClick={addCompetitor} className="rounded-lg bg-focus px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">{t("Aggiungi")}</button>
            </div>
          </div>
        )}
      </Card>

      {/* Pannello: provider non collegato */}
      {configured === false && (
        <Card className="mb-5">
          <SectionTitle>{t("Collega un provider di rate shopping")}</SectionTitle>
          <p className="text-sm text-dim">{t("Il confronto con i competitor diventa reale appena colleghi un provider di rate shopping (es. servizi che leggono le tariffe di Booking/Google Hotels). Imposta queste variabili d'ambiente sul server (Vercel) e riavvia:")}</p>
          <div className="mt-3 space-y-2">
            <div className="rounded-lg border border-line bg-wash px-3 py-2 font-mono text-xs text-txt">
              <div><span className="text-faint">RATECHECK_API_URL</span> = {t("endpoint del provider (POST JSON)")}</div>
              <div className="mt-1"><span className="text-faint">RATECHECK_API_KEY</span> = {t("chiave API del provider")}</div>
            </div>
            <p className="text-xs text-faint">{t("Il server invia al provider intervallo date, coordinate della struttura e la lista competitor qui sopra; la risposta viene normalizzata in media/min/max di mercato. Senza queste variabili non mostriamo dati finti.")}</p>
          </div>
          <button onClick={() => setShowConfig(true)} className="mt-3 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-dim hover:bg-wash">{t("Configura i competitor")}</button>
        </Card>
      )}

      <Card>
        <SectionTitle>{t("Le tue tariffe")} · {t("prossimi")} {DAYS} {t("giorni")}</SectionTitle>
        {rts.length === 0 ? (
          <div className="py-8 text-center text-sm text-faint">{t("Nessuna tipologia: imposta i prezzi nelle Tariffe.")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-2 py-2 font-semibold">{t("Giorno")}</th>
                  <th className="px-2 py-2 font-semibold">{t("La tua tariffa")}</th>
                  <th className="px-2 py-2 font-semibold">{t("Media mercato")}</th>
                  <th className="px-2 py-2 font-semibold">{t("Posizione")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const mkt = r.mkt;
                  const pos = mkt && mkt.avg > 0 ? position(r.mine, mkt.avg) : null;
                  return (
                    <tr key={r.iso} className="border-b border-line last:border-0">
                      <td className="px-2 py-2 font-medium text-txt">{new Date(r.iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" })}</td>
                      <td className="px-2 py-2 font-mono font-semibold text-txt">{eur(r.mine)}</td>
                      <td className="px-2 py-2 font-mono text-txt">
                        {mkt && mkt.avg > 0 ? (
                          <span title={`min ${eur(mkt.min)} · max ${eur(mkt.max)} · ${mkt.sample} ${t("strutture")}`}>{eur(mkt.avg)}</span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {pos ? (
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: pos.color, backgroundColor: pos.bg }}>{t(pos.label)}</span>
                        ) : (
                          <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-faint">{isConfigured ? t("nessun dato") : t("collega per confrontare")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-faint">{t("La colonna 'La tua tariffa' usa i prezzi reali dal Calendario/Tariffe. 'Media mercato' e 'Posizione' si popolano dal provider di rate shopping collegato.")}</p>
      </Card>
    </div>
  );
}
