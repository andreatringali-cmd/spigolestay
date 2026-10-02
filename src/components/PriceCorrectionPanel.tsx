"use client";

// Correzione prezzo OTA — componenti della pagina Canali:
//  - CorrectionEditor : modifica della correzione di UN canale con ANTEPRIMA obbligatoria prima dell'invio,
//                       verifica per rilettura, errori comprensibili, "riprova", pareggio netto/commissione.
//  - BulkCorrection   : stessa correzione su più canali della struttura, con anteprima e esito per canale.
//  - ParityPanel      : confronto Xenora ↔ OTA per canale e segnalazione delle discrepanze oltre soglia.
//  - CorrectionHistory: storico delle modifiche inviate (ok/errore) con "Riprova" e "Ripristina precedente".
//
// REALE vs STIMA: la correzione è letta/scritta davvero su Channex; il prezzo "OTA" mostrato è una STIMA
// (prezzo Xenora × correzione), perché Channex non permette di leggere il prezzo effettivo pubblicato
// sull'OTA. Il netto usa la commissione impostata per canale/struttura. Le etichette lo dicono sempre.

import { useEffect, useMemo, useRef, useState } from "react";
import { CHANNELS, type Channel, type RoomType } from "@/lib/types";
import { addDays, toISO } from "@/lib/dates";
import { rateForDay } from "@/lib/pricing";
import { loadWeekendPct } from "@/lib/pricing";
import { loadChannelCommissionPct } from "@/lib/channelOverrides";
import { useConfirm } from "@/components/ConfirmProvider";
import { forceFullSync } from "@/components/ChannexAutoSync";
import type { PriceCorrectionsApi } from "@/lib/usePriceCorrections";
import {
  breakevenCorrection, canRetry, canRollback, compareRows, correctionLabel, diffCorrections, parityAlerts,
  sameCorrection, signedPct, summarizeComparison, validateCorrectionInput,
  type Correction, type CorrLogEntry, type PriceRowIn,
} from "@/lib/priceCorrection";

export interface ChannelRef { id: string; channel: string; title: string; active: boolean }

export const channelLabelOf = (c: ChannelRef) => CHANNELS[c.channel as Channel]?.label ?? c.title;
// Commissione usata per il netto: quella impostata per canale/struttura, altrimenti il default del canale.
export const commissionPctFor = (channel: string, sid: string) => {
  const ch = channel as Channel;
  return loadChannelCommissionPct(ch, sid) ?? Math.round((CHANNELS[ch]?.commission ?? 0) * 1000) / 10;
};

const eur = (n: number) => n.toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const eurSigned = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 })}`;
const pctSigned = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`;
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `b-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
const dayLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" });
const relTime = (ts: number) => {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return "adesso";
  if (d < 3600) return `${Math.floor(d / 60)} min fa`;
  if (d < 86400) return `${Math.floor(d / 3600)} h fa`;
  return `${Math.floor(d / 86400)} g fa`;
};

// Prezzi Xenora (quelli che vengono INVIATI ai canali) per i prossimi `days` giorni, per le tipologie
// fisiche della struttura (le derivate non sono pubblicate come camere proprie). Solo la struttura indicata.
export function buildPriceRows(sid: string, roomTypes: RoomType[], rateOverrides: Record<string, number>, days = 14): PriceRowIn[] {
  if (!sid || sid === "all") return [];
  const rts = roomTypes.filter((rt) => rt.structureId === sid && !rt.deriveFrom);
  const wk = loadWeekendPct(sid);
  const start = new Date();
  const out: PriceRowIn[] = [];
  for (const rt of rts) {
    for (let d = 0; d < days; d++) {
      const iso = toISO(addDays(start, d));
      const xenora = rateForDay(rt.id, iso, roomTypes, rateOverrides, wk);
      if (xenora > 0) out.push({ date: iso, roomTypeId: rt.id, roomTypeName: rt.name, xenora });
    }
  }
  return out;
}

function lastFullSyncTs(sid: string): number | null {
  try { const v = JSON.parse(localStorage.getItem("spigolestay:channex-lastfullsync") || "{}")[sid]; return typeof v === "number" ? v : null; } catch { return null; }
}

const Badge = ({ children, tone }: { children: React.ReactNode; tone: "real" | "est" | "ok" | "err" | "warn" }) => {
  const color = tone === "real" || tone === "ok" ? "var(--ok)" : tone === "err" ? "var(--err)" : tone === "warn" ? "var(--warn)" : "var(--dim)";
  return <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ color, backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }}>{children}</span>;
};

// ─────────────────────────────────────────────────────────────
//  Editor di un canale
// ─────────────────────────────────────────────────────────────
export function CorrectionEditor({ sid, c, api, rows, initialDraft, onLogged }: {
  sid: string; c: ChannelRef; api: PriceCorrectionsApi; rows: PriceRowIn[];
  initialDraft?: Correction | null; onLogged?: (text: string, ok: boolean) => void;
}) {
  const cur = api.current[c.id];
  const label = channelLabelOf(c);
  const commissionPct = commissionPctFor(c.channel, sid);
  const [rule, setRule] = useState<string>("increase_by_percent");
  const [val, setVal] = useState("");
  const dirty = useRef(false);
  const [step, setStep] = useState<"edit" | "preview" | "saving">("edit");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" | "warn" } | null>(null);
  const [failedTarget, setFailedTarget] = useState<{ target: Correction | null } | null>(null);
  const [resend, setResend] = useState(true);
  const [rtSel, setRtSel] = useState("");

  // Precompila col valore REALE letto da Channex (finché l'utente non tocca il modulo).
  useEffect(() => {
    if (dirty.current || !cur?.loaded) return;
    setRule(cur.correction?.rule ?? "increase_by_percent");
    setVal(cur.correction ? String(cur.correction.value) : "");
  }, [cur?.loaded, cur?.correction]);
  useEffect(() => {
    if (initialDraft) { dirty.current = true; setRule(initialDraft.rule); setVal(String(initialDraft.value)); setStep("edit"); setMsg(null); }
  }, [initialDraft]);
  useEffect(() => { if (!cur) api.load(c.id, sid); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [c.id, sid]);

  const check = validateCorrectionInput(rule, val);
  const before: Correction | null = cur?.correction ?? null;
  const target: Correction | null = check.ok ? check.correction : null;
  const diff = diffCorrections(before, target);
  const readFailed = !!cur && !cur.loaded && !!cur.error;
  const reading = !cur || !!cur.loading;
  const breakeven = breakevenCorrection(commissionPct);
  const lastSync = lastFullSyncTs(sid);

  const roomTypes = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => m.set(r.roomTypeId, r.roomTypeName));
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [rows]);
  const rtId = rtSel && roomTypes.some((r) => r.id === rtSel) ? rtSel : roomTypes[0]?.id ?? "";
  const beforeRows = compareRows(rows, before, commissionPct);
  const afterRows = compareRows(rows, target, commissionPct);
  const sBefore = summarizeComparison(beforeRows), sAfter = summarizeComparison(afterRows);
  const sample = afterRows.filter((r) => r.roomTypeId === rtId).slice(0, 7);

  const toPreview = (forceTarget?: "reset") => {
    setMsg(null); setFailedTarget(null);
    if (forceTarget === "reset") { dirty.current = true; setVal(""); }
    const chk = forceTarget === "reset" ? ({ ok: true, correction: null } as const) : check;
    if (!chk.ok) { setMsg({ text: chk.error, tone: "err" }); return; }
    if (sameCorrection(before, chk.correction)) { setMsg({ text: "Nessuna modifica: il valore è già quello attuale su Channex.", tone: "warn" }); return; }
    setStep("preview");
  };

  const confirmSend = async (tgt: Correction | null) => {
    setStep("saving"); setMsg(null); setFailedTarget(null);
    const { entry, res } = await api.apply({ channelId: c.id, channelLabel: label, structureId: sid, target: tgt, kind: tgt ? "set" : "reset" });
    setStep("edit");
    if (res.ok) {
      dirty.current = false;
      const what = tgt ? `Correzione ${correctionLabel(tgt)}` : "Correzione rimossa";
      if (res.unchanged) setMsg({ text: "Già impostata su Channex: nulla da inviare.", tone: "warn" });
      else if (res.verified) setMsg({ text: `${what} salvata e VERIFICATA su Channex ✓`, tone: "ok" });
      else setMsg({ text: `${what} inviata, ma la verifica non è conclusiva: ${res.warning || "ricontrolla il canale."}`, tone: "warn" });
      if (entry) onLogged?.(`${label}: ${what.toLowerCase()}`, true);
      if (resend && !res.unchanged && sid !== "all") { try { forceFullSync(sid); } catch { /* non blocca */ } }
    } else {
      setMsg({ text: res.error || "Salvataggio non riuscito.", tone: "err" });
      setFailedTarget({ target: tgt });
      if (entry) onLogged?.(`${label}: correzione NON salvata — ${res.error || "errore"}`, false);
    }
  };

  const inpCls = "rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt outline-none focus:border-focus";

  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-txt">
          Correzione prezzo
          <span title="Rispetto al prezzo Xenora: si somma sopra eventuali promozioni attive sul canale stesso (Genius, offerte a tempo, ecc.) — non le sostituisce." className="grid h-3.5 w-3.5 cursor-help place-items-center rounded-full bg-wash text-[9px] font-bold text-faint">?</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-dim">
          Attuale su Channex <b className="text-txt">{reading ? "…" : readFailed ? "?" : correctionLabel(before)}</b>
          {!reading && !readFailed && <Badge tone="real">letto da Channex</Badge>}
        </span>
      </div>

      {readFailed && (
        <div className="mb-2 rounded-lg border border-line bg-surface p-2 text-xs" style={{ color: "var(--err)" }}>
          Non riesco a leggere la correzione attuale: {cur?.error}
          <div className="mt-1 text-dim">Per sicurezza il salvataggio è disattivato finché non la leggo (altrimenti rischierei di sovrascrivere un valore esistente).</div>
          <button onClick={() => api.load(c.id, sid)} className="mt-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-txt hover:bg-wash">Riprova lettura</button>
        </div>
      )}

      {step !== "preview" && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <select value={rule} onChange={(e) => { dirty.current = true; setRule(e.target.value); setMsg(null); }} className={inpCls} aria-label="Aumenta o riduci">
              <option value="increase_by_percent">+ aumenta</option>
              <option value="decrease_by_percent">− riduci</option>
            </select>
            <input type="number" min={0} step="0.01" value={val} onChange={(e) => { dirty.current = true; setVal(e.target.value); setMsg(null); }} placeholder="0" className={`w-20 ${inpCls}`} aria-label="Percentuale" />
            <span className="text-sm text-dim">%</span>
            <button onClick={() => toPreview()} disabled={step === "saving" || reading || readFailed || !check.ok} className="ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "var(--focus)" }}>Anteprima →</button>
          </div>
          {!check.ok && val !== "" && <div className="mt-1.5 text-xs font-semibold" style={{ color: "var(--err)" }}>{check.error}</div>}
          {check.ok && check.warning && <div className="mt-1.5 text-xs font-semibold" style={{ color: "var(--warn)" }}>⚠ {check.warning}</div>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-dim">
            {breakeven && (
              <button onClick={() => { dirty.current = true; setRule(breakeven.rule); setVal(String(breakeven.value)); setMsg(null); }} className="text-left hover:text-focus" title="Aumento che ti fa incassare, al netto della commissione, quanto vendendo direttamente al prezzo Xenora">
                Pareggio netto con commissione {commissionPct}%: <b className="text-txt">{correctionLabel(breakeven)}</b> — usa
              </button>
            )}
            {before && <button onClick={() => toPreview("reset")} disabled={reading || readFailed} className="hover:text-[color:var(--err)] disabled:opacity-40">Rimuovi correzione</button>}
          </div>
        </>
      )}

      {step === "preview" && (
        <div>
          <div className="rounded-lg border border-line bg-surface p-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-txt">
              <b>{label}</b>: {correctionLabel(before)} → <b>{correctionLabel(target)}</b>
              <span className="text-dim">({diff.deltaPoints > 0 ? "+" : diff.deltaPoints < 0 ? "−" : ""}{Math.abs(diff.deltaPoints)} punti %)</span>
            </div>
            <div className="mt-1 flex flex-col gap-0.5">
              {diff.signFlip && <span style={{ color: "var(--warn)" }}>⚠ Il segno si inverte: i prezzi passano da {signedPct(before) > 0 ? "sopra" : "sotto"} a {signedPct(target) > 0 ? "sopra" : "sotto"} il prezzo Xenora.</span>}
              {diff.big && <span style={{ color: "var(--warn)" }}>⚠ Variazione di {Math.abs(diff.deltaPoints)} punti %: cambio marcato sui prezzi del canale.</span>}
              {signedPct(target) < 0 && <span style={{ color: "var(--warn)" }}>⚠ Il prezzo sul canale sarà più basso del tuo sito diretto: l&apos;ospite troverà l&apos;OTA più conveniente.</span>}
              {target && target.value > 30 && <span style={{ color: "var(--warn)" }}>⚠ Correzione molto alta ({correctionLabel(target)}).</span>}
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="mt-2 text-xs text-dim">Nessun prezzo Xenora da confrontare per questa struttura (imposta le tariffe delle tipologie): puoi comunque inviare la correzione, ma non posso mostrarti l&apos;effetto in euro.</p>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-dim">
                <Badge tone="est">stima</Badge>
                <span>Effetto sui prossimi {sAfter.n ? 14 : 0} giorni (tutte le tipologie) · commissione {commissionPct}%</span>
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="rounded-lg border border-line bg-surface p-1.5"><div className="text-faint">Prezzo medio Xenora</div><div className="font-mono font-bold text-txt">{eur(sAfter.avgXenora)}</div></div>
                <div className="rounded-lg border border-line bg-surface p-1.5"><div className="text-faint">OTA stimato ora → dopo</div><div className="font-mono font-bold text-txt">{eur(sBefore.avgOta)} → {eur(sAfter.avgOta)}</div></div>
                <div className="rounded-lg border border-line bg-surface p-1.5"><div className="text-faint">Netto medio dopo</div><div className="font-mono font-bold text-txt">{eur(sAfter.avgNetOta)}</div><div className="text-faint">vs diretto {eurSigned(sAfter.avgNetVsXenora)}</div></div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-dim">
                Dettaglio per
                <select value={rtId} onChange={(e) => setRtSel(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-txt outline-none focus:border-focus">
                  {roomTypes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="mt-1 overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[420px] text-[11px]">
                  <thead><tr className="border-b border-line bg-wash text-left text-[9px] font-bold uppercase tracking-wide text-faint">
                    <th className="px-2 py-1.5">Data</th><th className="px-2 py-1.5 text-right">Xenora</th><th className="px-2 py-1.5 text-right">OTA dopo (stima)</th><th className="px-2 py-1.5 text-right">Δ €</th><th className="px-2 py-1.5 text-right">Δ %</th><th className="px-2 py-1.5 text-right">Netto</th>
                  </tr></thead>
                  <tbody>
                    {sample.map((r) => (
                      <tr key={r.date} className="border-b border-line last:border-0">
                        <td className="px-2 py-1 text-txt">{dayLabel(r.date)}</td>
                        <td className="px-2 py-1 text-right font-mono text-dim">{eur(r.xenora)}</td>
                        <td className="px-2 py-1 text-right font-mono font-semibold text-txt">{eur(r.ota)}</td>
                        <td className="px-2 py-1 text-right font-mono text-dim">{eurSigned(r.deltaEur)}</td>
                        <td className="px-2 py-1 text-right font-mono text-dim">{pctSigned(r.deltaPct)}</td>
                        <td className="px-2 py-1 text-right font-mono text-dim">{eur(r.netOta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-[10px] leading-snug text-faint">Stima calcolata da Xenora: Channex non permette di leggere il prezzo realmente pubblicato sull&apos;OTA, e le promozioni del canale (Genius, offerte a tempo…) si sommano sopra. Il netto usa la commissione impostata per questo canale.</p>
            </>
          )}

          <label className="mt-2 flex items-start gap-2 text-xs text-dim">
            <input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} className="mt-0.5" />
            <span>Dopo l&apos;invio, reinvia a Channex tutti i prezzi (consigliato: così la nuova correzione arriva sull&apos;OTA).{lastSync ? ` Ultimo invio completo: ${relTime(lastSync)}.` : " Nessun invio completo registrato su questo dispositivo."}</span>
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setStep("edit")} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-dim hover:bg-wash">← Modifica</button>
            <button onClick={() => confirmSend(target)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90" style={{ backgroundColor: "var(--focus)" }}>Conferma e invia a Channex</button>
          </div>
        </div>
      )}

      {step === "saving" && <div className="mt-2 text-xs font-semibold text-dim">Invio a Channex e verifica in corso…</div>}
      {msg && step !== "preview" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold" style={{ color: msg.tone === "ok" ? "var(--ok)" : msg.tone === "err" ? "var(--err)" : "var(--warn)" }}>
          <span>{msg.text}</span>
          {failedTarget && <button onClick={() => confirmSend(failedTarget.target)} disabled={step === "saving"} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-40">Riprova</button>}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Storico
// ─────────────────────────────────────────────────────────────
export function CorrectionHistory({ entries, allEntries, api, onLogged }: {
  entries: CorrLogEntry[]; allEntries: CorrLogEntry[]; api: PriceCorrectionsApi; onLogged?: (text: string, ok: boolean) => void;
}) {
  const ask = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const retryable = entries.filter((e) => canRetry(e, allEntries));

  const run = async (e: CorrLogEntry, kind: "retry" | "rollback") => {
    const target = kind === "retry" ? e.to : e.from;
    if (kind === "rollback") {
      const okc = await ask({ message: `Ripristinare la correzione di ${e.channelLabel} a ${correctionLabel(target)}? Verrà inviata a Channex.`, confirmLabel: "Ripristina" });
      if (!okc) return;
    }
    setBusy(e.id); setNote(null);
    const { res } = await api.apply({ channelId: e.channelId, channelLabel: e.channelLabel, structureId: e.structureId, target, kind });
    setBusy(null);
    const text = res.ok ? (res.unchanged ? "Già impostata: nulla da fare." : res.verified ? "Fatto e verificato su Channex ✓" : `Inviata (verifica non conclusiva). ${res.warning ?? ""}`) : (res.error || "Non riuscito.");
    setNote({ id: e.id, text, ok: res.ok });
    onLogged?.(`${e.channelLabel}: ${kind === "retry" ? "nuovo tentativo" : "ripristino"} correzione ${correctionLabel(target)} — ${res.ok ? "ok" : "errore"}`, res.ok);
  };
  const retryAll = async () => { for (const e of retryable) await run(e, "retry"); };

  if (entries.length === 0) return <p className="text-sm text-faint">Nessuna correzione inviata ancora. Ogni modifica inviata a Channex comparirà qui con il suo esito.</p>;
  return (
    <div>
      {retryable.length > 1 && <div className="mb-2 flex justify-end"><button onClick={retryAll} disabled={!!busy} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-40">Riprova tutte le fallite ({retryable.length})</button></div>}
      <div className="flex flex-col divide-y divide-[color:var(--line)]">
        {entries.slice(0, 25).map((e) => {
          const kindTxt = e.kind === "reset" ? "Rimossa" : e.kind === "rollback" ? "Ripristinata" : e.kind === "bulk" ? "In blocco" : e.kind === "retry" ? "Nuovo tentativo" : "Impostata";
          return (
            <div key={e.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-txt">{e.channelLabel}</span>
                <span className="text-dim">{kindTxt}: {e.fromKnown ? correctionLabel(e.from) : "?"} → <b className="text-txt">{correctionLabel(e.to)}</b></span>
                {e.status === "ok" ? <Badge tone={e.verified ? "ok" : "warn"}>{e.verified ? "ok · verificata" : "ok · non verificata"}</Badge> : <Badge tone="err">errore</Badge>}
                <span className="ml-auto text-[11px] text-faint">{relTime(e.ts)}</span>
              </div>
              {e.status === "error" && e.error && <div className="mt-0.5 text-xs" style={{ color: "var(--err)" }}>{e.error}</div>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {canRetry(e, allEntries) && <button onClick={() => run(e, "retry")} disabled={!!busy} className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-40">{busy === e.id ? "…" : "Riprova"}</button>}
                {canRollback(e, allEntries) && <button onClick={() => run(e, "rollback")} disabled={!!busy} className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-40">{busy === e.id ? "…" : `Ripristina ${correctionLabel(e.from)}`}</button>}
                {note?.id === e.id && <span className="text-xs font-semibold" style={{ color: note.ok ? "var(--ok)" : "var(--err)" }}>{note.text}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Correzione in blocco (più canali della struttura)
// ─────────────────────────────────────────────────────────────
type BulkRes = { status: "running" | "ok" | "error" | "unchanged" | "skipped"; text?: string };

export function BulkCorrection({ sid, channels, api, rows, onLogged }: {
  sid: string; channels: ChannelRef[]; api: PriceCorrectionsApi; rows: PriceRowIn[]; onLogged?: (text: string, ok: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [rule, setRule] = useState("increase_by_percent");
  const [val, setVal] = useState("");
  const [step, setStep] = useState<"edit" | "preview" | "running" | "done">("edit");
  const [results, setResults] = useState<Record<string, BulkRes>>({});
  const [resend, setResend] = useState(true);
  const bulkId = useRef("");

  const check = validateCorrectionInput(rule, val);
  const target = check.ok ? check.correction : null;
  const picked = channels.filter((c) => sel[c.id]);

  const goPreview = () => {
    if (!check.ok || picked.length === 0) return;
    for (const c of picked) if (!api.current[c.id]?.loaded) api.load(c.id, sid);
    setStep("preview");
  };

  const runFor = async (list: ChannelRef[], kind: "bulk" | "retry") => {
    setStep("running");
    let anyOk = false;
    for (const c of list) {
      const cs = api.current[c.id];
      if (!cs?.loaded) { setResults((r) => ({ ...r, [c.id]: { status: "skipped", text: "Valore attuale non leggibile: saltato per sicurezza." } })); continue; }
      if (sameCorrection(cs.correction, target)) { setResults((r) => ({ ...r, [c.id]: { status: "unchanged", text: "Già impostata." } })); continue; }
      setResults((r) => ({ ...r, [c.id]: { status: "running" } }));
      const { res } = await api.apply({ channelId: c.id, channelLabel: channelLabelOf(c), structureId: sid, target, kind, bulkId: bulkId.current });
      if (res.ok) { anyOk = true; setResults((r) => ({ ...r, [c.id]: { status: "ok", text: res.verified ? "Salvata e verificata ✓" : `Inviata, verifica non conclusiva. ${res.warning ?? ""}` } })); }
      else setResults((r) => ({ ...r, [c.id]: { status: "error", text: res.error || "Errore" } }));
    }
    setStep("done");
    onLogged?.(`Correzione in blocco ${correctionLabel(target)} su ${list.length} canali`, anyOk);
    if (anyOk && resend) { try { forceFullSync(sid); } catch { /* non blocca */ } }
  };
  const start = () => { bulkId.current = uid(); setResults({}); runFor(picked, "bulk"); };
  const failed = picked.filter((c) => results[c.id]?.status === "error");

  if (channels.length < 2 && !open) return null;
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-txt">Correzione in blocco</div>
          <div className="text-xs text-dim">Applica la stessa correzione a più canali di questa struttura, con anteprima e esito per ciascuno.</div>
        </div>
        <button onClick={() => { setOpen((o) => !o); setStep("edit"); setResults({}); }} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-txt hover:bg-wash">{open ? "Chiudi" : "Apri"}</button>
      </div>
      {open && (
        <div className="mt-3">
          {step === "edit" && (
            <>
              <div className="flex flex-wrap gap-2">
                {channels.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm text-txt hover:bg-wash">
                    <input type="checkbox" checked={!!sel[c.id]} onChange={(e) => setSel((s) => ({ ...s, [c.id]: e.target.checked }))} />
                    {channelLabelOf(c)}{!c.active && <span className="text-[10px] text-faint">(non attivo)</span>}
                  </label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <select value={rule} onChange={(e) => setRule(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt outline-none focus:border-focus">
                  <option value="increase_by_percent">+ aumenta</option><option value="decrease_by_percent">− riduci</option>
                </select>
                <input type="number" min={0} step="0.01" value={val} onChange={(e) => setVal(e.target.value)} placeholder="0" className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt outline-none focus:border-focus" />
                <span className="text-sm text-dim">%</span>
                <button onClick={goPreview} disabled={!check.ok || picked.length === 0} className="ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "var(--focus)" }}>Anteprima →</button>
              </div>
              {!check.ok && val !== "" && <div className="mt-1.5 text-xs font-semibold" style={{ color: "var(--err)" }}>{check.error}</div>}
              {check.ok && check.warning && <div className="mt-1.5 text-xs font-semibold" style={{ color: "var(--warn)" }}>⚠ {check.warning}</div>}
              {picked.length === 0 && <div className="mt-1.5 text-xs text-faint">Seleziona almeno un canale.</div>}
            </>
          )}
          {(step === "preview" || step === "running" || step === "done") && (
            <>
              <div className="text-sm text-txt">Nuova correzione: <b>{correctionLabel(target)}</b> su {picked.length} canali <Badge tone="est">stima</Badge></div>
              <div className="mt-2 overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[520px] text-xs">
                  <thead><tr className="border-b border-line bg-wash text-left text-[9px] font-bold uppercase tracking-wide text-faint">
                    <th className="px-2 py-1.5">Canale</th><th className="px-2 py-1.5">Attuale</th><th className="px-2 py-1.5">Nuova</th><th className="px-2 py-1.5 text-right">OTA medio (14 gg)</th><th className="px-2 py-1.5 text-right">Netto medio</th><th className="px-2 py-1.5">Esito</th>
                  </tr></thead>
                  <tbody>
                    {picked.map((c) => {
                      const cs = api.current[c.id];
                      const comm = commissionPctFor(c.channel, sid);
                      const sb = summarizeComparison(compareRows(rows, cs?.correction ?? null, comm));
                      const sa = summarizeComparison(compareRows(rows, target, comm));
                      const r = results[c.id];
                      const d = diffCorrections(cs?.correction ?? null, target);
                      return (
                        <tr key={c.id} className="border-b border-line last:border-0">
                          <td className="px-2 py-1.5 font-semibold text-txt">{channelLabelOf(c)}</td>
                          <td className="px-2 py-1.5 text-dim">{!cs || cs.loading ? "…" : cs.loaded ? correctionLabel(cs.correction) : <span style={{ color: "var(--err)" }}>non leggibile</span>}</td>
                          <td className="px-2 py-1.5 text-txt">{correctionLabel(target)}{d.big && <span title="Variazione ≥ 10 punti %" style={{ color: "var(--warn)" }}> ⚠</span>}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-dim">{rows.length ? `${eur(sb.avgOta)} → ${eur(sa.avgOta)}` : "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-dim">{rows.length ? eur(sa.avgNetOta) : "—"}</td>
                          <td className="px-2 py-1.5">
                            {!r ? <span className="text-faint">in attesa</span>
                              : r.status === "running" ? <span className="text-dim">invio…</span>
                              : <span style={{ color: r.status === "ok" ? "var(--ok)" : r.status === "error" ? "var(--err)" : "var(--warn)" }}>{r.text}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {step === "preview" && (
                <>
                  <label className="mt-2 flex items-start gap-2 text-xs text-dim"><input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} className="mt-0.5" /><span>Al termine reinvia a Channex tutti i prezzi di questa struttura (consigliato).</span></label>
                  <div className="mt-3 flex justify-end gap-2">
                    <button onClick={() => setStep("edit")} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-dim hover:bg-wash">← Modifica</button>
                    <button onClick={start} disabled={picked.some((c) => api.current[c.id]?.loading)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "var(--focus)" }}>Conferma e invia a {picked.length} canali</button>
                  </div>
                </>
              )}
              {step === "running" && <div className="mt-2 text-xs font-semibold text-dim">Invio in corso, un canale alla volta…</div>}
              {step === "done" && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold">
                  <span style={{ color: failed.length ? "var(--err)" : "var(--ok)" }}>
                    {picked.filter((c) => results[c.id]?.status === "ok").length} ok · {failed.length} con errore · {picked.filter((c) => ["unchanged", "skipped"].includes(results[c.id]?.status ?? "")).length} non modificati
                  </span>
                  {failed.length > 0 && <button onClick={() => runFor(failed, "retry")} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-txt hover:bg-wash">Riprova i {failed.length} falliti</button>}
                  <button onClick={() => { setStep("edit"); setResults({}); }} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-txt hover:bg-wash">Nuova correzione</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Confronto Xenora ↔ OTA e discrepanze
// ─────────────────────────────────────────────────────────────
const THRESH_KEY = "spigolestay:canali:corrthreshold";

export function ParityPanel({ sid, channels, api, rows, onSuggest }: {
  sid: string; channels: ChannelRef[]; api: PriceCorrectionsApi; rows: PriceRowIn[]; onSuggest: (c: ChannelRef, corr: Correction) => void;
}) {
  const [threshold, setThreshold] = useState(5);
  useEffect(() => { try { const v = Number(localStorage.getItem(THRESH_KEY)); if (Number.isFinite(v) && v > 0) setThreshold(v); } catch { /* ignora */ } }, []);
  const saveTh = (v: number) => { setThreshold(v); try { localStorage.setItem(THRESH_KEY, String(v)); } catch { /* ignora */ } };
  const channelKey = channels.map((c) => c.id).join("|");
  useEffect(() => { for (const c of channels) if (!api.current[c.id]) api.load(c.id, sid); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [channelKey, sid]);

  const states = channels.map((c) => ({ id: c.id, label: channelLabelOf(c), correction: api.current[c.id]?.correction ?? null, commissionPct: commissionPctFor(c.channel, sid), active: c.active && !!api.current[c.id]?.loaded }));
  const alerts = parityAlerts(states, threshold);
  const unreadable = channels.filter((c) => api.current[c.id] && !api.current[c.id].loaded && api.current[c.id].error);
  const alertIds = new Set(alerts.flatMap((a) => a.channelIds));

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-txt">Confronto prezzi Xenora ↔ canali</div>
          <div className="text-xs text-dim">Prezzo medio dei prossimi 14 giorni e netto dopo commissione, per canale <Badge tone="est">stima</Badge></div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-dim" title="Differenza oltre la quale un canale viene segnalato">Soglia discrepanza
          <input type="number" min={0.5} step={0.5} value={threshold} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) saveTh(v); }} className="w-16 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus" />%
        </label>
      </div>

      {alerts.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1">{alerts.map((a, i) => <div key={i} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold" style={{ color: "var(--warn)", backgroundColor: "color-mix(in srgb, var(--warn) 12%, transparent)" }}>⚠ {a.message}</div>)}</div>
      ) : (
        <div className="mt-2 text-xs font-semibold" style={{ color: "var(--ok)" }}>Nessuna discrepanza oltre {threshold}% tra i canali letti.</div>
      )}
      {unreadable.length > 0 && <div className="mt-1.5 text-xs" style={{ color: "var(--err)" }}>Non riesco a leggere la correzione di: {unreadable.map(channelLabelOf).join(", ")} — non inclusi nei controlli.</div>}

      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[620px] text-xs">
          <thead><tr className="border-b border-line bg-wash text-left text-[9px] font-bold uppercase tracking-wide text-faint">
            <th className="px-2 py-1.5">Canale</th><th className="px-2 py-1.5">Correzione</th><th className="px-2 py-1.5 text-right">Xenora medio</th><th className="px-2 py-1.5 text-right">OTA medio</th><th className="px-2 py-1.5 text-right">Comm.</th><th className="px-2 py-1.5 text-right">Netto medio</th><th className="px-2 py-1.5 text-right">Netto vs diretto</th><th className="px-2 py-1.5"></th>
          </tr></thead>
          <tbody>
            {channels.map((c) => {
              const cs = api.current[c.id];
              const comm = commissionPctFor(c.channel, sid);
              const corr = cs?.correction ?? null;
              const s = summarizeComparison(compareRows(rows, corr, comm));
              const be = breakevenCorrection(comm);
              const readable = !!cs?.loaded;
              return (
                <tr key={c.id} className="border-b border-line last:border-0" style={alertIds.has(c.id) ? { backgroundColor: "color-mix(in srgb, var(--warn) 8%, transparent)" } : undefined}>
                  <td className="px-2 py-1.5 font-semibold text-txt">{channelLabelOf(c)}{!c.active && <span className="ml-1 text-[10px] font-normal text-faint">(non attivo)</span>}</td>
                  <td className="px-2 py-1.5 text-dim">{readable ? correctionLabel(corr) : "?"}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-dim">{rows.length ? eur(s.avgXenora) : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-txt">{rows.length && readable ? eur(s.avgOta) : "—"}</td>
                  <td className="px-2 py-1.5 text-right text-dim">{comm}%</td>
                  <td className="px-2 py-1.5 text-right font-mono text-dim">{rows.length && readable ? eur(s.avgNetOta) : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: s.avgNetVsXenora < 0 ? "var(--err)" : "var(--ok)" }}>{rows.length && readable ? eurSigned(s.avgNetVsXenora) : "—"}</td>
                  <td className="px-2 py-1.5 text-right">{be && readable && comm > 0 && !sameCorrection(corr, be) && <button onClick={() => onSuggest(c, be)} className="text-[11px] text-dim hover:text-focus" title="Imposta la correzione che pareggia il netto della vendita diretta">pareggio {correctionLabel(be)}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="mt-2 text-xs text-faint">Nessun prezzo Xenora per questa struttura: imposta le tariffe delle tipologie per vedere il confronto in euro.</p>}
      <p className="mt-2 text-[10px] leading-snug text-faint">«Netto vs diretto» = quanto incassi in più/meno per notte vendendo dal canale rispetto a venderla direttamente al prezzo Xenora. Il prezzo OTA è una stima (prezzo Xenora × correzione), non il prezzo letto dall&apos;OTA.</p>
    </div>
  );
}
