"use client";

// Strumento SOLO-ADMIN "Certificazione Channex".
// Esegue con un click ciascuno dei 13 scenari di test della certificazione Channex e
// mostra i task_id restituiti (servono per compilare il form di certificazione) + l'esito.
// Gli scenari 1..10 hanno un bottone "Esegui" (chiamano /api/channex/cert/run).
// Gli scenari 11/12/13 sono già coperti dall'infrastruttura esistente → solo nota di stato.
// Accesso riservato al titolare: la route enforce ADMIN_EMAILS lato server; qui, se la
// risposta è 403, mostriamo l'area riservata.

import { useMemo, useState } from "react";
import { PageHeader, Card } from "@/components/ui";
import { supabase } from "@/lib/supabase";

type ScenarioId = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10";

interface CertCall { endpoint: string; ok: boolean; status: number; taskId: string | null; sent: number; error?: string; raw?: unknown }
interface CertResult { ok: boolean; scenario: string; label: string; calls: CertCall[]; error?: string }

// Setup della property di test dedicata alla certificazione (creata/riusata via API).
interface TestPropertySetup {
  ok: boolean;
  reused: boolean;
  propertyId: string | null;
  propertyTitle: string;
  twinRoomId: string | null;
  twinRoomTitle: string;
  twinBarId: string | null;
  twinBbId: string | null;
  doubleRoomId: string | null;
  doubleRoomTitle: string;
  doubleBarId: string | null;
  doubleBbId: string | null;
  webhookActive: boolean;
  errors: string[];
}

// Contesto REALE su cui girano gli scenari (property + tipologie + piani con i loro ID Channex).
// È ciò che va incollato nel form di certificazione (pagina "Setup Property").
interface CertRoomType { roomTypeId: string; roomTitle: string }
interface CertCombo { roomTypeId: string; roomTitle: string; ratePlanId: string; ratePlanTitle: string }
interface CertContext { propertyId: string; propertyTitle: string; roomTypes: CertRoomType[]; combos: CertCombo[] }

// Revision prenotazioni per il Test #11 (booking receiving).
interface RevRow { id: string; booking_id: string; status?: string; revision?: number; is_cancellation?: boolean; ota_name?: string; arrival_date?: string; departure_date?: string }
interface RevGroup { bookingId: string; revisions: RevRow[] }

interface ScenarioMeta { id: ScenarioId; name: string; desc: string }
const SCENARIOS: ScenarioMeta[] = [
  { id: "1", name: "Full Data Sync", desc: "500 giorni di disponibilità + tariffe + restrizioni per tutte le camere e piani, in 2 chiamate (1 availability, 1 restrictions). Valori realistici variabili per data." },
  { id: "2", name: "Single date, single rate", desc: "Cambia il prezzo di 1 combinazione camera+piano su 1 data (+30gg) a 333. 1 chiamata." },
  { id: "3", name: "Single date, multiple rates", desc: "Aggiorna i prezzi su 3 combinazioni camera/piano su date diverse in 1 chiamata." },
  { id: "4", name: "Multiple dates, multiple rates", desc: "Aggiorna tariffe su intervalli di date (gg 1-10, 10-16, 1-20) per più combinazioni in 1 chiamata." },
  { id: "5", name: "Min stay update", desc: "Imposta min_stay (3, 2, 5 notti) per tre combinazioni su date indicate in 1 chiamata." },
  { id: "6", name: "Stop sell update", desc: "Attiva stop_sell per tre combinazioni in 1 chiamata." },
  { id: "7", name: "Multiple restrictions", desc: "Applica closed_to_arrival, closed_to_departure, min_stay e max_stay su 4 combinazioni in 1 chiamata." },
  { id: "8", name: "Half-year update", desc: "Aggiorna tariffe + restrizioni su un semestre (+30 → +210 gg) per più camere in 1 chiamata." },
  { id: "9", name: "Single date availability", desc: "Riduce l'inventario simulando una prenotazione (camera1: N→N-1, camera2: 1→0) su 2 date. 1 chiamata." },
  { id: "10", name: "Multiple date availability", desc: "Aggiorna l'inventario su intervalli di date per due camere in 1 chiamata." },
];

interface InfoScenario { n: number; name: string; note: string }
const INFO_SCENARIOS: InfoScenario[] = [
  { n: 12, name: "Rate limit handling", note: "Già coperto dall'infrastruttura: coda con throttling + retry/backoff in channex.ts." },
  { n: 13, name: "Delta update", note: "Già coperto dall'infrastruttura: invio delta (solo righe cambiate) in ChannexAutoSync." },
];

const authToken = async () => (await (supabase?.auth.getSession() ?? Promise.resolve({ data: { session: null } }))).data.session?.access_token || "";
const taskIdsOf = (r: CertResult) => r.calls.map((c) => c.taskId).filter((t): t is string => !!t);

export default function ChannexCertPage() {
  const [results, setResults] = useState<Record<string, CertResult | undefined>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [forbidden, setForbidden] = useState(false);
  const [copied, setCopied] = useState<string>("");
  const [setup, setSetup] = useState<TestPropertySetup | undefined>();
  const [setupErr, setSetupErr] = useState<string>("");
  const [settingUp, setSettingUp] = useState(false);
  const [ctx, setCtx] = useState<CertContext | undefined>();
  const [ctxErr, setCtxErr] = useState<string>("");
  const [loadingCtx, setLoadingCtx] = useState(false);
  const [revs, setRevs] = useState<RevGroup[] | undefined>();
  const [revErr, setRevErr] = useState<string>("");
  const [loadingRevs, setLoadingRevs] = useState(false);
  const [acking, setAcking] = useState(false);
  const [ackMsg, setAckMsg] = useState<string>("");

  const ackBookings = async () => {
    setAcking(true); setAckMsg("");
    try {
      const token = await authToken();
      if (!token) { setAckMsg("Sessione scaduta: rientra."); return; }
      const res = await fetch("/api/channex/cert/run", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "ack-bookings" }) });
      if (res.status === 403) { setForbidden(true); return; }
      const d = await res.json().catch(() => null) as { ok?: boolean; acked?: number; ids?: string[]; error?: string } | null;
      if (d?.ok) setAckMsg(`ACK inviati: ${d.acked ?? 0} revision${d.error ? " · " + d.error : ""}`);
      else setAckMsg(d?.error || `Errore ${res.status}`);
    } catch { setAckMsg("Errore di rete."); }
    finally { setAcking(false); }
  };

  const loadRevisions = async () => {
    setLoadingRevs(true);
    setRevErr("");
    try {
      const token = await authToken();
      if (!token) { setRevErr("Sessione scaduta: rientra."); return; }
      const res = await fetch("/api/channex/cert/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "booking-revisions" }),
      });
      if (res.status === 403) { setForbidden(true); return; }
      const d = await res.json().catch(() => null) as { ok?: boolean; bookings?: RevGroup[]; error?: string } | null;
      if (d?.ok && d.bookings) setRevs(d.bookings);
      else setRevErr(d?.error || `Errore ${res.status}`);
    } catch {
      setRevErr("Errore di rete.");
    } finally {
      setLoadingRevs(false);
    }
  };

  // Etichetta il tipo di revision. Lo `status` di Channex è la verità (new/modified/cancelled);
  // solo se manca si ripiega su cancellazione / numero revision / posizione.
  const revLabel = (r: RevRow, idx: number) => {
    const s = (r.status || "").toLowerCase();
    if (r.is_cancellation || s === "cancelled" || s === "cancellation") return "Cancellata";
    if (s === "new" || r.revision === 1) return "Nuova";
    if (s === "modified" || s === "modification") return "Modificata";
    return idx === 0 ? "Nuova" : "Modificata";
  };

  const loadContext = async () => {
    setLoadingCtx(true);
    setCtxErr("");
    try {
      const token = await authToken();
      if (!token) { setCtxErr("Sessione scaduta: rientra."); return; }
      const res = await fetch("/api/channex/cert/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "context" }),
      });
      if (res.status === 403) { setForbidden(true); return; }
      const d = await res.json().catch(() => null) as { ok?: boolean; context?: CertContext; error?: string } | null;
      if (d?.ok && d.context) setCtx(d.context);
      else setCtxErr(d?.error || `Errore ${res.status}`);
    } catch {
      setCtxErr("Errore di rete.");
    } finally {
      setLoadingCtx(false);
    }
  };

  const setupTestProperty = async () => {
    setSettingUp(true);
    setSetupErr("");
    try {
      const token = await authToken();
      if (!token) { setSetupErr("Sessione scaduta: rientra."); return; }
      const res = await fetch("/api/channex/cert/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "setup-test-property" }),
      });
      if (res.status === 403) { setForbidden(true); return; }
      const d = await res.json().catch(() => null) as { setup?: TestPropertySetup } | null;
      if (d?.setup) setSetup(d.setup);
      else setSetupErr(`Errore ${res.status}`);
    } catch {
      setSetupErr("Errore di rete.");
    } finally {
      setSettingUp(false);
    }
  };

  const run = async (id: ScenarioId) => {
    setRunning((s) => ({ ...s, [id]: true }));
    try {
      const token = await authToken();
      if (!token) { setResults((r) => ({ ...r, [id]: { ok: false, scenario: id, label: "", calls: [], error: "Sessione scaduta: rientra." } })); return; }
      const res = await fetch("/api/channex/cert/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scenario: id }),
      });
      if (res.status === 403) { setForbidden(true); return; }
      const d = await res.json().catch(() => null);
      setResults((r) => ({ ...r, [id]: (d && typeof d === "object") ? d as CertResult : { ok: false, scenario: id, label: "", calls: [], error: `Errore ${res.status}` } }));
    } catch {
      setResults((r) => ({ ...r, [id]: { ok: false, scenario: id, label: "", calls: [], error: "Errore di rete." } }));
    } finally {
      setRunning((s) => ({ ...s, [id]: false }));
    }
  };

  const copy = async (text: string, tag: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(""), 1500); } catch { /* clipboard negata */ }
  };

  const allTaskIds = useMemo(() => {
    const out: string[] = [];
    for (const s of SCENARIOS) { const r = results[s.id]; if (r) out.push(...taskIdsOf(r)); }
    return out;
  }, [results]);

  if (forbidden) return (
    <div><PageHeader title="Certificazione Channex" hideHelp />
      <Card><div className="py-6 text-center text-sm text-dim">🔒 Area riservata. Il tuo account non ha accesso a questo strumento.</div></Card>
    </div>
  );

  return (
    <div>
      <PageHeader title="Certificazione Channex" subtitle="Esegui i 13 scenari di test della certificazione e raccogli i task ID da inserire nel form Channex" hideHelp />

      <Card className="mb-4">
        <div className="space-y-2 text-sm text-dim">
          <p>Ogni scenario esegue chiamate <strong>reali</strong> a Channex (staging) usando la struttura collegata in Channel Manager, con date sempre future. Dopo l&apos;esecuzione compaiono i <strong>task ID</strong> restituiti: copiali nel form di certificazione. Utile anche per la verifica live (screenshare) con Channex.</p>
          {allTaskIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-faint">{allTaskIds.length} task ID raccolti finora</span>
              <button onClick={() => copy(allTaskIds.join(", "), "all")} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">
                {copied === "all" ? "Copiati ✓" : "Copia tutti i task ID"}
              </button>
            </div>
          )}
        </div>
      </Card>

      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-txt">① ID per il form (property reale su Channex)</div>
            <p className="mt-1 text-[13px] text-dim">
              Via <strong>consigliata</strong> per un B&amp;B (confermata da Channex): si certifica sulla
              struttura <strong>reale</strong> già collegata, senza creare una property Twin/Double di test.
              Questo pulsante legge (in sola lettura) property, tipologie e piani tariffari presenti su Channex
              e mostra gli <strong>ID esatti</strong> da incollare nel form. È anche la diagnostica: ti dice
              cosa vede davvero Xenora su Channex.
            </p>
          </div>
          <button
            onClick={loadContext}
            disabled={loadingCtx}
            className="shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: "var(--focus)" }}
          >
            {loadingCtx ? "Leggo…" : "Mostra ID Channex"}
          </button>
        </div>

        {ctxErr && <div className="mt-3 text-[13px]" style={{ color: "var(--err)" }}>⚠ {ctxErr}</div>}

        {ctx && (
          <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-[13px]">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }}>
                {ctx.propertyTitle}
              </span>
              <span className="text-[11px] text-faint">{ctx.roomTypes.length} tipologie · {ctx.combos.length} piani tariffari</span>
            </div>

            <div className="space-y-2">
              <div className="rounded-md border border-line/60 bg-paper p-2">
                <div className="text-[11px] font-semibold text-dim">Property ID at Channex</div>
                <div className="mt-1 flex items-center gap-2">
                  <code className="select-all break-all rounded bg-wash px-1.5 py-0.5 text-[12px] text-txt">{ctx.propertyId}</code>
                  <button onClick={() => copy(ctx.propertyId, "ctx-prop")} className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-dim hover:bg-wash">
                    {copied === "ctx-prop" ? "Copiato ✓" : "Copia"}
                  </button>
                </div>
              </div>

              {ctx.roomTypes.map((rt) => (
                <div key={rt.roomTypeId} className="rounded-md border border-line/60 bg-paper p-2">
                  <div className="text-[11px] font-semibold text-dim">Room type · {rt.roomTitle}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="select-all break-all rounded bg-wash px-1.5 py-0.5 text-[12px] text-txt">{rt.roomTypeId}</code>
                    <button onClick={() => copy(rt.roomTypeId, `ctx-rt-${rt.roomTypeId}`)} className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-dim hover:bg-wash">
                      {copied === `ctx-rt-${rt.roomTypeId}` ? "Copiato ✓" : "Copia"}
                    </button>
                  </div>
                  {ctx.combos.filter((c) => c.roomTypeId === rt.roomTypeId).map((c) => (
                    <div key={c.ratePlanId} className="mt-1 flex items-center gap-2 pl-3">
                      <span className="text-[11px] text-faint">Rate plan · {c.ratePlanTitle}</span>
                      <code className="select-all break-all rounded bg-wash px-1.5 py-0.5 text-[12px] text-txt">{c.ratePlanId}</code>
                      <button onClick={() => copy(c.ratePlanId, `ctx-rp-${c.ratePlanId}`)} className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-dim hover:bg-wash">
                        {copied === `ctx-rp-${c.ratePlanId}` ? "Copiato ✓" : "Copia"}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <p className="mt-3 text-[11px] text-faint">
              Incolla questi ID nella pagina &quot;Setup Property&quot; del form. Gli scenari qui sotto girano
              automaticamente su <strong>questa</strong> property. Nota EN da mettere nel form: &quot;Xenora is a PMS
              for small B&amp;Bs; staging mirrors our real model. Tests assuming multi room/rate were run against our
              real (smaller) room/rate set, reusing available combinations.&quot;
            </p>
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-txt">② Property di test dedicata (opzionale)</div>
            <p className="mt-1 text-[13px] text-dim">
              La certificazione richiede una property <strong>dedicata e separata</strong> dalla struttura reale.
              Questo pulsante la crea su Channex (staging) con la spec richiesta e mostra gli ID da incollare nel form.
              È <strong>idempotente</strong>: cliccare più volte riusa la property esistente, non crea doppioni.
              Una volta creata, <strong>tutti gli scenari qui sotto girano automaticamente su questa property di test</strong>.
            </p>
          </div>
          <button
            onClick={setupTestProperty}
            disabled={settingUp}
            className="shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: "var(--focus)" }}
          >
            {settingUp ? "Creo…" : "Crea property di test certificazione"}
          </button>
        </div>

        {setupErr && <div className="mt-3 text-[13px]" style={{ color: "var(--err)" }}>⚠ {setupErr}</div>}

        {setup && (
          <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-[13px]">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={setup.ok
                ? { backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }
                : { backgroundColor: "color-mix(in srgb, var(--err) 16%, transparent)", color: "var(--err)" }}>
                {setup.ok ? "Pronta" : "Incompleta"}
              </span>
              {setup.reused && <span className="text-[11px] text-faint">property esistente riusata</span>}
              <span className="text-[11px] text-faint">{setup.propertyTitle} · currency USD</span>
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={setup.webhookActive
                ? { backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }
                : { backgroundColor: "color-mix(in srgb, var(--err) 16%, transparent)", color: "var(--err)" }}>
                {setup.webhookActive ? "Webhook attivo" : "Webhook NON registrato"}
              </span>
            </div>

            <div className="space-y-2">
              {([
                { label: "Property ID at Channex", value: setup.propertyId, tag: "sp-prop" },
                { label: "Twin Room ID", value: setup.twinRoomId, tag: "sp-twin" },
                { label: "Twin Room Best Available Rate ID", value: setup.twinBarId, tag: "sp-twinbar" },
                { label: "Twin Room Bed & Breakfast Rate ID", value: setup.twinBbId, tag: "sp-twinbb" },
                { label: "Double Room ID", value: setup.doubleRoomId, tag: "sp-double" },
                { label: "Double Room Best Available Rate ID", value: setup.doubleBarId, tag: "sp-doublebar" },
                { label: "Double Room Bed & Breakfast Rate ID", value: setup.doubleBbId, tag: "sp-doublebb" },
              ] as { label: string; value: string | null; tag: string }[]).map((f) => (
                <div key={f.tag} className="rounded-md border border-line/60 bg-paper p-2">
                  <div className="text-[11px] font-semibold text-dim">{f.label}</div>
                  <div className="mt-1 flex items-center gap-2">
                    {f.value ? (
                      <>
                        <code className="select-all break-all rounded bg-wash px-1.5 py-0.5 text-[12px] text-txt">{f.value}</code>
                        <button onClick={() => copy(f.value!, f.tag)} className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-dim hover:bg-wash">
                          {copied === f.tag ? "Copiato ✓" : "Copia"}
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px]" style={{ color: "var(--err)" }}>non creato</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-3 text-[11px] text-faint">
              Due rate plan per tipologia (&quot;Best Available Rate&quot; + &quot;Bed &amp; Breakfast Rate&quot;): Xenora
              dichiara &quot;Yes&quot; a multiple rate plans per room type. Compila tutti e 7 i campi del form.
            </p>

            {setup.errors.length > 0 && (
              <div className="mt-2 space-y-1">
                {setup.errors.map((e, i) => (
                  <div key={i} className="text-[11px]" style={{ color: "var(--err)" }}>⚠ {e}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="space-y-3">
        {SCENARIOS.map((s) => {
          const r = results[s.id];
          const busy = !!running[s.id];
          const ids = r ? taskIdsOf(r) : [];
          return (
            <Card key={s.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wash text-xs font-bold text-dim">{s.id}</span>
                    <span className="font-semibold text-txt">{s.name}</span>
                  </div>
                  <p className="mt-1 text-[13px] text-dim">{s.desc}</p>
                </div>
                <button
                  onClick={() => run(s.id)}
                  disabled={busy}
                  className="shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ backgroundColor: "var(--focus)" }}
                >
                  {busy ? "Eseguo…" : "Esegui"}
                </button>
              </div>

              {r && (
                <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-[13px]">
                  {r.error ? (
                    <div style={{ color: "var(--err)" }}>⚠ {r.error}</div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={r.ok
                          ? { backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }
                          : { backgroundColor: "color-mix(in srgb, var(--err) 16%, transparent)", color: "var(--err)" }}>
                          {r.ok ? "OK" : "Errore"}
                        </span>
                        {ids.length > 0 && (
                          <button onClick={() => copy(ids.join(", "), s.id)} className="rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-dim hover:bg-wash">
                            {copied === s.id ? "Copiato ✓" : `Copia task ID (${ids.length})`}
                          </button>
                        )}
                      </div>
                      {r.calls.map((c, i) => (
                        <div key={i} className="rounded-md border border-line/60 bg-paper p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <code className="rounded bg-wash px-1.5 py-0.5 text-[12px] font-semibold text-txt">{c.endpoint}</code>
                            <span className="text-[11px] text-faint">{c.sent} righe · HTTP {c.status}</span>
                            <span className="text-[11px] font-semibold" style={{ color: c.ok ? "var(--ok)" : "var(--err)" }}>{c.ok ? "ok" : "ko"}</span>
                          </div>
                          {c.taskId ? (
                            <div className="mt-1 flex items-center gap-2">
                              <span className="text-[11px] text-faint">task_id</span>
                              <code className="select-all break-all rounded bg-wash px-1.5 py-0.5 text-[12px] text-txt">{c.taskId}</code>
                            </div>
                          ) : c.ok ? (
                            <div className="mt-1 text-[11px] text-faint">task_id non individuato — risposta grezza: <code className="break-all">{JSON.stringify(c.raw)?.slice(0, 400)}</code></div>
                          ) : (
                            <div className="mt-1 text-[11px]" style={{ color: "var(--err)" }}>{c.error}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}

        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wash text-xs font-bold text-dim">11</span>
                <span className="font-semibold text-txt">Booking Receiving</span>
              </div>
              <p className="mt-1 text-[13px] text-dim">
                Crea una prenotazione di prova su Channex (Applications → app <strong>&quot;Booking CRS&quot;</strong> →
                pagina Bookings → <strong>Create</strong>), poi <strong>modificala</strong> e infine
                <strong> cancellala</strong>: ogni azione genera una revision. Xenora le riceve e fa l&apos;ack in
                automatico (le vedi in Prenotazioni). Questo pulsante legge da Channex (sola lettura) e ti mostra
                il <strong>Booking ID</strong> e l&apos;ID di ogni revision <strong>Nuova / Modificata / Cancellata</strong>.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                onClick={loadRevisions}
                disabled={loadingRevs}
                className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-60"
              >
                {loadingRevs ? "Leggo…" : "Leggi revisioni"}
              </button>
              <button
                onClick={ackBookings}
                disabled={acking}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: "var(--focus)" }}
                title="Fa l'ACK di tutte le revision della property di test (necessario per superare il Test 11)"
              >
                {acking ? "ACK…" : "ACK prenotazioni"}
              </button>
            </div>
          </div>

          {ackMsg && <div className="mt-3 text-[13px]" style={{ color: "var(--ok)" }}>✓ {ackMsg}</div>}
          {revErr && <div className="mt-3 text-[13px]" style={{ color: "var(--err)" }}>⚠ {revErr}</div>}

          {revs && (
            revs.length === 0 ? (
              <div className="mt-3 text-[13px] text-dim">Nessuna prenotazione trovata su Channex per questa property. Crea prima la prenotazione di prova (Booking CRS → Create).</div>
            ) : (
              <div className="mt-3 space-y-3">
                {revs.map((g) => (
                  <div key={g.bookingId} className="rounded-lg border border-line bg-surface p-3 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold text-dim">Booking ID</span>
                      <code className="select-all break-all rounded bg-wash px-1.5 py-0.5 text-[12px] text-txt">{g.bookingId}</code>
                      <button onClick={() => copy(g.bookingId, `bk-${g.bookingId}`)} className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-dim hover:bg-wash">
                        {copied === `bk-${g.bookingId}` ? "Copiato ✓" : "Copia"}
                      </button>
                    </div>
                    <div className="mt-2 space-y-1">
                      {g.revisions.map((r, i) => (
                        <div key={r.id} className="flex flex-wrap items-center gap-2 pl-2">
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{
                            backgroundColor: r.is_cancellation ? "color-mix(in srgb, var(--err) 14%, transparent)" : "color-mix(in srgb, var(--ok) 14%, transparent)",
                            color: r.is_cancellation ? "var(--err)" : "var(--ok)",
                          }}>{revLabel(r, i)}</span>
                          <code className="select-all break-all rounded bg-wash px-1.5 py-0.5 text-[12px] text-txt">{r.id}</code>
                          <button onClick={() => copy(r.id, `rev-${r.id}`)} className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-dim hover:bg-wash">
                            {copied === `rev-${r.id}` ? "Copiato ✓" : "Copia"}
                          </button>
                          {r.status && <span className="text-[11px] text-faint">{r.status}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </Card>

        {INFO_SCENARIOS.map((s) => (
          <Card key={s.n} className="opacity-90">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wash text-xs font-bold text-dim">{s.n}</span>
                  <span className="font-semibold text-txt">{s.name}</span>
                </div>
                <p className="mt-1 text-[13px] text-dim">{s.note}</p>
              </div>
              <span className="shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" }}>
                Già coperto dall&apos;infrastruttura
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
