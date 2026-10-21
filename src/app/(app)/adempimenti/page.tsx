"use client";

import { fmtDM } from "@/lib/dates";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { PageHeader } from "@/components/ui";
import WeatherWidget from "@/components/WeatherWidget";
import EmptyState from "@/components/EmptyState";
import { eur } from "@/lib/format";
import { centsEur, apiPost } from "@/lib/invoicing/client";
import { shortenLink } from "@/lib/guestlink";
import { checkinRequestMsg } from "@/lib/guest-messages";
import { guestLangOf } from "@/lib/guest-lang";
import { cityTaxTotalByStructure } from "@/lib/citytax";
import { useAdempimentiOggi } from "@/lib/use-adempimenti-oggi";
import { expectedPaxOf, declaredPaxOf } from "@/lib/adempimenti-oggi";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { Booking, Guest, Structure } from "@/lib/types";

const soft = (tone: string, pct = 14) => `color-mix(in srgb, ${tone} ${pct}%, transparent)`;
const fmtDay = (iso?: string) => (iso ? fmtDM(iso) : "—");
const omini = (n: number) => (n <= 5 ? "👤".repeat(Math.max(1, n)) : `👤 ${n}`); // ospiti come icone
// Meta grafica per l'esito di ogni passo di "Elabora tutto".
const STEP_META: Record<"fatto" | "prova" | "errore" | "niente", { icon: string; label: string; tone: string }> = {
  fatto: { icon: "✓", label: "Fatto", tone: "var(--ok)" },
  prova: { icon: "🧪", label: "In prova", tone: "var(--warn)" },
  errore: { icon: "⚠", label: "Errore", tone: "var(--err)" },
  niente: { icon: "–", label: "Niente da fare", tone: "var(--faint)" },
};
// Scadenza schedina Questura: entro 24h dall'arrivo (mostrata come giorno successivo all'arrivo).

// Completezza del check-in PER PERSONA: regola in lib/adempimenti-oggi.ts (la stessa di Dashboard e badge laterale).
// Un ospite conta come "dichiarato" solo se ha davvero dei dati (nome/cognome): un ospite
// vuoto aggiunto come segnaposto NON conta (altrimenti risulterebbe "2/2" con 1 solo compilato).
// Nome mostrato: chi ha fatto il check-in di QUESTA prenotazione (nei gruppi ogni camera ha il suo capocamera), poi l'anagrafica — come in Adempimenti 2.
const shownName = (b: Booking, g?: Guest) => [b.primaryGuest?.firstName, b.primaryGuest?.lastName].filter(Boolean).join(" ") || g?.fullName || "Ospite";

// Scheda di uno step in ordine cronologico: badge numerato (la sequenza è informativa),
// numero grande, pill di stato, mini-lista opzionale e azione a piena larghezza in fondo.
function StepCard({ n, tone, label, count, badge, action, onAction, children }: {
  n: number; tone: string; label: string; sub?: string; count: number; badge?: React.ReactNode; action: string; onAction: () => void; children?: React.ReactNode;
}) {
  const active = count > 0;
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="h-1 w-full" style={{ background: active ? tone : "var(--line)" }} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl font-mono font-bold ${badge ? "text-[15px]" : "text-xl"}`} style={{ background: active ? soft(tone) : "var(--wash)", color: active ? tone : "var(--faint)" }}>{badge ?? count}</span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-dim">Passo {n}</div>
            <h3 className="mt-0.5 text-[13.5px] font-semibold leading-snug text-txt">{label}</h3>
          </div>
        </div>
        {children ? <div className="mt-3 flex-1 space-y-1.5">{children}</div> : <div className="flex-1" />}
        <button onClick={onAction} className="mt-3.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-focus px-3 py-2 max-sm:py-3 max-sm:text-sm text-xs font-semibold text-on-focus transition hover:opacity-90">{action}<span aria-hidden>→</span></button>
      </div>
    </article>
  );
}

// Riga compatta per le mini-liste (documenti/fatture) dentro le schede.
function MiniRow({ left, right }: { left: string; right?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[12.5px]">
      <span className="truncate text-dim">{left}</span>
      {right && <span className="shrink-0 font-mono font-semibold text-txt">{right}</span>}
    </div>
  );
}

// Riga "fatto" (spuntata) per la sezione Fatti di ogni card.
function DoneRow({ left, right }: { left: string; right?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[12.5px]">
      <span className="truncate text-dim"><span className="text-[color:var(--ok)]">✓</span> {left}</span>
      {right && <span className="shrink-0 font-mono text-dim">{right}</span>}
    </div>
  );
}

// Etichetta di sezione (Da fare / Fatti) dentro una card.
function SubHead({ children, mt }: { children: React.ReactNode; mt?: boolean }) {
  return <div className={`text-[11px] font-semibold uppercase tracking-wide text-dim ${mt ? "mt-2" : ""}`}>{children}</div>;
}

// Riga arrivo senza check-in: WhatsApp (link), Email diretta (server) e "Compila tu" (apri il form).
function ArrivalRow({ b, g, st, origin, waOn, showStruct, rooms, expected: expectedProp, declared: declaredProp }: { b: Booking; g?: Guest; st?: Structure; origin: string; waOn?: boolean; showStruct?: boolean; rooms?: number; expected?: number; declared?: number }) {
  const [mail, setMail] = useState<"idle" | "sending" | "sent" | "err">("idle");
  const [ws, setWs] = useState<"idle" | "sending" | "sent" | "err">("idle");
  const fullLink = `${origin}/checkin?b=${b.id}`;
  // Link ACCORCIATO (xenora.it/g/xxxxxx): più pulito e senza anteprima marketing.
  const [link, setLink] = useState(fullLink);
  useEffect(() => { let on = true; shortenLink(fullLink).then((s) => { if (on) setLink(s); }).catch(() => {}); return () => { on = false; }; }, [fullLink]);
  // Messaggio breve e chiaramente DA PARTE DELLA STRUTTURA (firma inclusa).
  // Nella lingua dell'ospite: scheda → Paese → prefisso del telefono.
  const msg = checkinRequestMsg(guestLangOf(g), { name: g?.firstName, structure: st?.name, link });
  const wa = g?.phone ? `https://wa.me/${g.phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}` : "";
  const sendMail = async () => {
    if (!g?.email) return;
    setMail("sending");
    try {
      const r = await fetch("/api/email", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "checkin_reminder", checkinUrl: link, booking: { code: b.code, structureName: st?.name, structureEmail: st?.email, guestName: g?.fullName, guestEmail: g?.email, guestPhone: g?.phone, guestCountry: g?.country, guestLanguage: g?.language, checkIn: b.checkIn, checkInFrom: st?.checkInFrom, color: st?.photoColor, address: [st?.address, st?.streetNumber, st?.city].filter(Boolean).join(" "), phone: st?.phone, logo: st?.logo, website: st?.website, cin: st?.cin, vat: st?.vat } }),
      });
      const j = await r.json().catch(() => ({}));
      setMail(r.ok && j?.ok ? "sent" : "err");
    } catch { setMail("err"); }
  };
  const compila = () => { const w = window.open(fullLink, "_blank"); if (!w) window.location.href = fullLink; };
  // WhatsApp: se collegato (Cloud API) invia DIRETTO; altrimenti apre wa.me con il testo pronto.
  const sendWa = async () => {
    const dg = (g?.phone ?? "").replace(/\D/g, "");
    if (!dg) return;
    if (!waOn) { window.open(wa, "_blank", "noopener"); return; }
    setWs("sending");
    try {
      const r = await apiPost<{ ok?: boolean }>("whatsapp/send", { to: dg, text: msg });
      if (r?.ok !== false) setWs("sent"); else { setWs("err"); window.open(wa, "_blank", "noopener"); }
    } catch { setWs("err"); window.open(wa, "_blank", "noopener"); }
  };
  const expected = expectedProp ?? expectedPaxOf(b);
  const declared = declaredProp ?? declaredPaxOf(b);
  const partial = declared > 0 && declared < expected; // qualcuno ha fatto il check-in, ma non tutti
  return (
    <div className="rounded-lg border border-line bg-paper px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[13px] font-medium text-txt"><span className="font-mono text-dim">{b.code || b.id.slice(0, 6).toUpperCase()}</span> · {shownName(b, g)}{rooms && rooms > 1 ? <span className="ml-1 rounded-full bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[color:var(--focus)]" title="Prenotazione di gruppo: un solo link completa il check-in di tutte le camere">Gruppo · {rooms} camere</span> : b.groupId ? <span className="ml-1 rounded-full bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[color:var(--focus)]" title="Prenotazione di gruppo: un solo link completa il check-in di tutte le camere">Gruppo</span> : null}{showStruct && <span className="text-faint"> · {st?.name ?? ""}</span>}</div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={partial ? { background: soft("var(--warn)"), color: "var(--warn)" } : { background: soft("var(--err)"), color: "var(--err)" }}>
          {partial ? `Incompleto ${declared}/${expected}` : declared === 0 ? "Check-in mancante" : "Da fare"}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-faint">
        <span>🗓 {fmtDay(b.checkIn)} → {fmtDay(b.checkOut)}</span>
        <span title={`${expected} ospiti`}>{omini(expected)}</span>
        <span className={partial ? "font-semibold text-[color:var(--warn)]" : ""}>✓ check-in {declared}/{expected}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {wa && <button onClick={sendWa} disabled={ws === "sending" || ws === "sent"} className={`rounded-md px-2 py-1 max-sm:px-3 max-sm:py-2 max-sm:text-xs text-[11px] font-semibold hover:opacity-90 disabled:opacity-70 ${ws === "sent" ? "text-on-ok" : ws === "err" ? "text-on-err" : "text-white"}`} style={{ backgroundColor: ws === "sent" ? "var(--ok)" : ws === "err" ? "var(--err)" : "#25D366" }} title={waOn ? "Invia su WhatsApp" : "Apri WhatsApp col messaggio pronto"}>{ws === "sent" ? "✓ Inviato" : ws === "sending" ? "Invio…" : ws === "err" ? "Riprova" : "💬 WhatsApp"}</button>}
        {g?.email && <button onClick={sendMail} disabled={mail === "sending" || mail === "sent"} className={`rounded-md px-2 py-1 max-sm:px-3 max-sm:py-2 max-sm:text-xs text-[11px] font-semibold hover:opacity-90 disabled:opacity-70 ${mail === "sent" ? "bg-[color:var(--ok)] text-on-ok" : mail === "err" ? "bg-[color:var(--err)] text-on-err" : "bg-focus text-on-focus"}`}>{mail === "sent" ? "✓ Inviata" : mail === "sending" ? "Invio…" : mail === "err" ? "Riprova" : "✉ Email"}</button>}
        <button onClick={compila} className="rounded-md px-2 py-1 max-sm:px-3 max-sm:py-2 max-sm:text-xs text-[11px] font-semibold text-on-warn hover:opacity-90" style={{ backgroundColor: "var(--warn)" }}>Compila tu</button>
      </div>
    </div>
  );
}

export default function AdempimentiPage() {
  const router = useRouter();
  const { structures, getGuest, getStructure, activeStructureId } = useData();
  // Dati del server e regola del conteggio: UNICI per pagina, Dashboard e badge laterale (lib/adempimenti-oggi.ts). Tutto lavora SOLO sulla struttura selezionata in alto a destra.
  const { result: R, reload: loadData, scoped } = useAdempimentiOggi();
  const bookings = scoped.bookings;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const showStruct = activeStructureId === "all"; // se una struttura è già selezionata in alto, non ripeto il nome
  const bkNo = (b: Booking) => b.code || b.id.slice(0, 6).toUpperCase();       // numero prenotazione
  const structPart = (structureId: string) => (showStruct ? ` · ${getStructure(structureId)?.name ?? ""}` : "");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []); // countdown vivo
  // WhatsApp Cloud API collegato? Se sì, il pulsante invia DIRETTO; altrimenti apre wa.me.
  const [waOn, setWaOn] = useState(false);
  useEffect(() => { apiPost<{ connected: boolean }>("whatsapp/settings", { action: "status" }).then((r) => setWaOn(!!r.connected)).catch(() => {}); }, []);

  // "Passaggio di palla" passo 1 → 2: genera/aggiorna le schedine dagli arrivi con check-in fatto.
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const transferToSchedine = async () => {
    setSyncing(true); setSyncMsg("");
    try {
      // Solo la struttura selezionata (con "Tutte" il server sincronizza tutte le strutture).
      await apiPost<{ count?: number }>("alloggiati/sync", activeStructureId !== "all" ? { structureId: activeStructureId } : {});
      await loadData();
      setSyncMsg("✓ Schedine aggiornate. Vedi «Pronte da inviare» qui a fianco.");
    } catch (e) { setSyncMsg(e instanceof Error ? e.message : "Errore nel trasferimento."); }
    finally { setSyncing(false); }
  };
  // "Passaggio di palla" arrivi → ISTAT: genera i movimenti turistici dagli arrivi.
  const [syncingIstat, setSyncingIstat] = useState(false);
  const [istatMsg, setIstatMsg] = useState("");
  const transferToIstat = async () => {
    setSyncingIstat(true); setIstatMsg("");
    try {
      const r = await apiPost<{ count?: number }>("istat/sync", activeStructureId !== "all" ? { structureId: activeStructureId } : {});
      await loadData();
      setIstatMsg(`✓ Movimenti ISTAT generati${typeof r?.count === "number" ? `: ${r.count}` : ""}.`);
    } catch (e) { setIstatMsg(e instanceof Error ? e.message : "Errore nella generazione."); }
    finally { setSyncingIstat(false); }
  };

  // ── "Elabora tutto" (adempimenti in un click) ────────────────────────────
  // Orchestrazione: schedine Alloggiati + movimenti ISTAT via route server (che rispetta i gate
  // ALLOGGIATI_LIVE/ISTAT_LIVE), tassa di soggiorno calcolata qui (dati già nello store).
  type RunStep = { key: string; label: string; status: "fatto" | "prova" | "errore" | "niente"; detail: string; count: number };
  type RunResult = { steps: RunStep[]; live: { alloggiati: boolean; istat: boolean } };
  const [runBusy, setRunBusy] = useState(false);
  const [runConfirm, setRunConfirm] = useState(false);
  const [runSteps, setRunSteps] = useState<RunStep[] | null>(null);
  const [prepared, setPrepared] = useState<RunResult | null>(null);

  const scopeStructureIds = () => (activeStructureId === "all" ? structures.map((s) => s.id) : [activeStructureId]).filter(Boolean);

  // Tassa di soggiorno del trimestre in corso (stima con regole Siracusa), riuso della logica condivisa.
  const buildTaxStep = (): RunStep => {
    const now = new Date();
    const y = now.getFullYear();
    const startM = Math.floor(now.getMonth() / 3) * 3;
    const p2 = (n: number) => String(n).padStart(2, "0");
    const start = `${y}-${p2(startM + 1)}-01`;
    const end = startM + 3 >= 12 ? `${y + 1}-01-01` : `${y}-${p2(startM + 4)}-01`;
    const taxBookings = bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked" && b.checkIn >= start && b.checkIn < end); // bookings è già limitato alla struttura attiva
    // Ogni soggiorno è calcolato con le regole della SUA struttura (Strutture → Tassa di soggiorno).
    const { total, count } = cityTaxTotalByStructure(taxBookings, getStructure);
    return {
      key: "tassa", label: "Tassa di soggiorno", status: count > 0 ? "fatto" : "niente", count,
      detail: count > 0 ? `Imposta stimata ${eur(total)} su ${count} ${count === 1 ? "soggiorno" : "soggiorni"} (trimestre in corso, regole della struttura).` : "Nessun soggiorno da tassare nel periodo.",
    };
  };

  const runAll = async (mode: "prepare" | "confirm"): Promise<RunResult> =>
    apiPost<RunResult>("adempimenti/run", { mode, structureIds: scopeStructureIds() });

  // Avvio: prepara (sincronizza senza inviare); se c'è un invio REALE da fare chiedo conferma,
  // altrimenti (gate OFF / niente da inviare) mostro direttamente l'esito in prova.
  const startElabora = async () => {
    setRunBusy(true); setRunSteps(null);
    try {
      const r = await runAll("prepare");
      const cnt = (k: string) => r.steps.find((s) => s.key === k)?.count ?? 0;
      const willSendReal = (r.live.alloggiati && cnt("schedine") > 0) || (r.live.istat && cnt("istat") > 0);
      if (willSendReal) { setPrepared(r); setRunConfirm(true); }
      else { setRunSteps([...r.steps, buildTaxStep()]); await loadData(); }
    } catch (e) {
      setRunSteps([{ key: "errore", label: "Elaborazione", status: "errore", count: 0, detail: e instanceof Error ? e.message : "Errore durante l'elaborazione." }]);
    } finally { setRunBusy(false); }
  };
  const confirmElabora = async () => {
    setRunBusy(true);
    try { const r = await runAll("confirm"); setRunSteps([...r.steps, buildTaxStep()]); await loadData(); }
    catch (e) { setRunSteps([{ key: "errore", label: "Elaborazione", status: "errore", count: 0, detail: e instanceof Error ? e.message : "Errore durante l'invio." }]); }
    finally { setRunBusy(false); setRunConfirm(false); }
  };

  // Badge "fatti/totali" (X/Y) per le card: undefined se non c'è nulla (così resta "In ordine").
  const frac = (done: number, todo: number) => (done + todo > 0 ? `${done}/${done + todo}` : undefined);
  const { groupsNoCheckin, groupsToFix, groupsCheckedIn, schedToSendG, schedSentG, needsTransfer, toTransfer, schedBookingIds,
    istatPend, istatSent, docsUnpaid, docsPaid, docsRejected, docsSdiOk, passiveUnpaid, passivePaid, passiveOverdue, balanceOf } = R;
  // Etichetta prenotazione: numero · ospite (· struttura solo se non già selezionata in alto).
  const bookingLabel = (bookingId: string | null, structureId: string | null) => {
    const b = bookingId ? bookings.find((x) => x.id === bookingId) : null;
    const nm = b ? shownName(b, getGuest(b.guestId)) : "Prenotazione";
    const code = b ? bkNo(b) : "";
    const stn = showStruct ? (getStructure(structureId || b?.structureId || "")?.name || "") : "";
    return `${code ? code + " · " : ""}${nm}${stn ? " · " + stn : ""}`;
  };
  const schedLabel = (n: number) => (n === 1 ? "1 schedina" : `${n} schedine`);
  // Countdown vivo alla scadenza (≈ arrivo + 24h, assunto arrivo alle 14:00).
  const schedCd = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso + "T14:00:00"); d.setDate(d.getDate() + 1);
    const ms = d.getTime() - now; const over = ms < 0; const a = Math.abs(ms);
    const days = Math.floor(a / 86400000), h = Math.floor((a % 86400000) / 3600000), m = Math.floor((a % 3600000) / 60000);
    const lbl = days >= 1 ? `${days}g ${h}h` : h >= 1 ? `${h}h ${m}m` : `${m}m`;
    return over ? `⚠ scaduta da ~${lbl}` : `⏱ tra ~${lbl}`; // stima: l'orario vero di arrivo non lo conosciamo (si assumono le 14:00)
  };
  // Il totale in alto usa gli STESSI conteggi delle card (schedine raggruppate per prenotazione).
  const { allClear, total: totalTasks, urgent, toDo } = R.counts; // lo STESSO numero di Dashboard e badge della barra laterale
  const headTone = allClear ? "var(--ok)" : urgent > 0 ? "var(--err)" : "var(--focus)";
  const dateStr = `${new Date().toLocaleDateString("it-IT", { weekday: "long" })} ${fmtDM(new Date())}`;

  return (
    <div>
      <PageHeader title="Adempimenti oggi" subtitle="Tutto ciò che va gestito o inviato, in ordine cronologico" actions={<WeatherWidget compact />} />

      {/* Riepilogo d'impatto: quante cose da gestire e con che priorità */}
      <section className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-line bg-surface p-4 shadow-sm max-sm:mb-3 max-sm:gap-x-3 max-sm:gap-y-2 max-sm:p-3 sm:p-5">
        <div className="flex items-center gap-3.5">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl font-bold" style={{ background: soft(headTone), color: headTone }}>{allClear ? "✓" : totalTasks}</div>
          <div>
            <div className="text-[15px] font-bold text-txt">{allClear ? "Tutto in ordine per oggi" : totalTasks === 1 ? "1 adempimento da gestire" : `${totalTasks} adempimenti da gestire`}</div>
            <div className="mt-0.5 text-xs capitalize text-dim">{dateStr}</div>
          </div>
        </div>
        {!allClear && (
          <>
            <div className="hidden h-10 w-px bg-line sm:block" />
            <div className="flex flex-wrap gap-2 max-sm:flex-1 max-sm:gap-1.5">
              {urgent > 0 && <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: soft("var(--err)"), color: "var(--err)" }}><b className="font-mono">{urgent}</b> urgenti</span>}
              {toDo > 0 && <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: soft("var(--focus)"), color: "var(--focus)" }}><b className="font-mono">{toDo}</b> da fare</span>}
            </div>
          </>
        )}
        {/* Azione "in un click": elabora TUTTI gli adempimenti PA dovuti (schedine, ISTAT, tassa) in sequenza. */}
        <button onClick={startElabora} disabled={runBusy} className="ml-auto inline-flex items-center gap-2 max-sm:ml-auto max-sm:shrink-0 max-sm:justify-center max-sm:px-3 max-sm:py-2.5 rounded-xl px-4 py-2.5 text-sm font-bold text-on-focus shadow-sm transition hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, var(--focus), color-mix(in srgb, var(--focus) 70%, #7c3aed))" }} title="Elabora in sequenza schedine Alloggiati, movimenti ISTAT e tassa di soggiorno">
          <span aria-hidden>⚡</span>{runBusy ? "Elaboro…" : "Elabora tutto"}
        </button>
      </section>

      {/* Riepilogo passo-passo dell'ultima elaborazione "in un click". */}
      {runSteps && (
        <section className="mb-5 rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-sm font-bold text-txt">Esito «Elabora tutto»</h2>
            <button onClick={() => setRunSteps(null)} className="grid h-7 w-7 place-items-center rounded-lg border border-line text-dim hover:bg-wash" aria-label="Chiudi riepilogo">✕</button>
          </div>
          <ul className="space-y-1.5">
            {runSteps.map((s) => {
              const m = STEP_META[s.status];
              return (
                <li key={s.key} className="flex items-start gap-2.5 rounded-lg border border-line bg-paper px-3 py-2">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-[13px] font-bold" style={{ background: soft(m.tone), color: m.tone }}>{m.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-txt">{s.label}</span>
                      <span className="rounded-full px-1.5 py-0.5 text-[11px] font-bold uppercase" style={{ background: soft(m.tone), color: m.tone }}>{m.label}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-dim">{s.detail}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {runConfirm && prepared && (() => {
        const cnt = (k: string) => prepared.steps.find((s) => s.key === k)?.count ?? 0;
        const sched = prepared.live.alloggiati ? cnt("schedine") : 0;
        const istatN = prepared.live.istat ? cnt("istat") : 0;
        return (
          <ConfirmDialog
            title="Elabora tutto — invio agli enti"
            message={<>Stai per inviare in un colpo solo: {sched > 0 && <><b className="text-txt">{sched}</b> {sched === 1 ? "schedina" : "schedine"} alla Questura</>}{sched > 0 && istatN > 0 && " e "}{istatN > 0 && <><b className="text-txt">{istatN}</b> {istatN === 1 ? "movimento" : "movimenti"} ISTAT</>}. La tassa di soggiorno verrà solo calcolata.</>}
            warning={<>L&apos;invio agli enti è <b>definitivo</b> e non può essere annullato. Le voci non pronte o con enti non attivi restano in prova.</>}
            confirmLabel="Invia tutto"
            busy={runBusy}
            onConfirm={confirmElabora}
            onClose={() => { setRunConfirm(false); setPrepared(null); }}
          />
        );
      })()}

      {/* Ordine CRONOLOGICO: 1) check-in → 2) schedine Questura → 3) ISTAT → 4) incasso → 5) fattura/SdI → 6) fornitori */}
      {allClear ? (
        <EmptyState title="Tutto in ordine per oggi" sub="Non c'è niente da inviare o gestire adesso." />
      ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* 1 · Check-in online → poi "passaggio di palla" alle schedine */}
        <StepCard n={1} tone="var(--warn)" label="Check-in online da completare" sub="Da completare" count={groupsNoCheckin.length + groupsToFix.length} badge={frac(groupsCheckedIn.length, groupsNoCheckin.length + groupsToFix.length)} action={syncing ? "Trasferisco…" : `↪ Trasferisci alle schedine${needsTransfer.length ? ` (${needsTransfer.length})` : ""}`} onAction={transferToSchedine}>
          {(groupsNoCheckin.length > 0 || groupsToFix.length > 0 || groupsCheckedIn.length > 0 || syncMsg) ? (
            <>
              {groupsNoCheckin.length > 0 && (
                <>
                  <SubHead>Da completare ({groupsNoCheckin.length})</SubHead>
                  {groupsNoCheckin.slice(0, 5).map((gr) => (
                    <ArrivalRow key={gr.key} b={gr.rep} g={getGuest(gr.rep.guestId)} st={getStructure(gr.rep.structureId)} origin={origin} waOn={waOn} showStruct={showStruct} rooms={gr.rooms} expected={gr.expected} declared={gr.declared} />
                  ))}
                </>
              )}
              {groupsToFix.length > 0 && (
                <>
                  <SubHead mt={groupsNoCheckin.length > 0}>Da correggere ({groupsToFix.length}) · dati ospite incompleti</SubHead>
                  {groupsToFix.slice(0, 5).map((gr) => {
                    const b = gr.rep; const g = getGuest(b.guestId); const st = getStructure(b.structureId);
                    const openCheckin = () => { const u = `${origin}/checkin?b=${b.id}`; const w = window.open(u, "_blank"); if (!w) window.location.href = u; };
                    return (
                      <button key={gr.key} onClick={openCheckin} title="Apri il check-in online per completare/correggere i dati" className="flex w-full items-center justify-between gap-2 rounded-lg border bg-paper px-2.5 py-1.5 text-left text-[12.5px] transition hover:bg-wash" style={{ borderColor: "color-mix(in srgb, var(--err) 45%, var(--line))" }}>
                        <span className="truncate text-dim"><span className="font-mono text-dim">{bkNo(b)}</span> · {shownName(b, g)}{gr.rooms > 1 && <span className="ml-1 rounded-full bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[color:var(--focus)]" title="Prenotazione di gruppo: un solo link completa il check-in di tutte le camere">Gruppo · {gr.rooms} camere</span>}{showStruct && <span className="text-faint"> · {st?.name ?? ""}</span>}</span>
                        <span className="shrink-0 font-semibold" style={{ color: "var(--err)" }}>⚠ correggi →</span>
                      </button>
                    );
                  })}
                </>
              )}
              {groupsCheckedIn.length > 0 && (
                <>
                  <SubHead mt={groupsNoCheckin.length > 0 || groupsToFix.length > 0}>Check-in fatti ({groupsCheckedIn.length}) · pronti per le schedine</SubHead>
                  {groupsCheckedIn.slice(0, 6).map((gr) => {
                    const b = gr.rep; const g = getGuest(b.guestId);
                    const allTransferred = gr.members.every((m) => schedBookingIds.has(m.id));
                    const roomsLabel = gr.rooms > 1 ? ` · ${gr.rooms} cam.` : "";
                    return <DoneRow key={gr.key} left={`${bkNo(b)} · ${shownName(b, g)}${roomsLabel}${structPart(b.structureId)}`} right={allTransferred ? `${fmtDay(b.checkIn)}→${fmtDay(b.checkOut)} · ${omini(gr.expected)}` : "↪ da trasferire"} />;
                  })}
                  {toTransfer.length > 0
                    ? <div className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold" style={{ background: soft("var(--warn)"), color: "var(--warn)" }}>↪ {toTransfer.length} da trasferire alle schedine — premi «Trasferisci».</div>
                    : <div className="text-[11px] font-medium" style={{ color: "var(--ok)" }}>✓ Tutte trasferite alle schedine.</div>}
                </>
              )}
              {syncMsg && <div className="text-[11px] font-medium" style={{ color: syncMsg.startsWith("✓") ? "var(--ok)" : "var(--err)" }}>{syncMsg}</div>}
            </>
          ) : undefined}
        </StepCard>

        {/* 2 · Schedine alla Questura */}
        <StepCard n={2} tone="var(--err)" label="Schedine alla Questura (Alloggiati Web)" sub="Pronte da inviare" count={schedToSendG.length} badge={frac(schedSentG.length, schedToSendG.length)} action="Invia alla Questura" onAction={() => router.push("/alloggiati-web")}>
          {(schedToSendG.length > 0 || schedSentG.length > 0) ? (
            <>
              {schedToSendG.length > 0 && (<>
                <SubHead>Pronte da inviare ({schedToSendG.length})</SubHead>
                {schedToSendG.slice(0, 4).map((gr) => (
                  <MiniRow key={gr.key}
                    left={`${bookingLabel(gr.bookingId, gr.structureId)} · arrivo ${fmtDay(gr.arrival)}`}
                    right={`${schedLabel(gr.count)} · ${schedCd(gr.arrival)}`} />
                ))}
              </>)}
              {schedSentG.length > 0 && (<>
                <SubHead mt={schedToSendG.length > 0}>Inviate ({schedSentG.length})</SubHead>
                {schedSentG.slice(0, 3).map((gr) => (
                  <DoneRow key={gr.key} left={`${bookingLabel(gr.bookingId, gr.structureId)} · arrivo ${fmtDay(gr.arrival)}`} right={schedLabel(gr.count)} />
                ))}
              </>)}
            </>
          ) : undefined}
        </StepCard>

        {/* 3 · ISTAT — passaggio di palla: genera dai arrivi, poi invia */}
        <StepCard n={3} tone="var(--warn)" label="Movimenti ISTAT" sub="Da inviare" count={istatPend.length} badge={frac(istatSent.length, istatPend.length)} action={syncingIstat ? "Genero…" : "↪ Genera da arrivi"} onAction={transferToIstat}>
          {(istatPend.length > 0 || istatSent.length > 0 || istatMsg) ? (
            <>
              {istatPend.length > 0 && (<>
                <SubHead>Da inviare ({istatPend.length})</SubHead>
                {istatPend.slice(0, 4).map((r) => <MiniRow key={r.id} left={bookingLabel(r.booking_id, r.structure_id)} right={`arrivo ${fmtDay(r.arrival)}`} />)}
              </>)}
              {istatSent.length > 0 && (<>
                <SubHead mt={istatPend.length > 0}>Inviati ({istatSent.length})</SubHead>
                {istatSent.slice(0, 3).map((r) => <DoneRow key={r.id} left={`${bookingLabel(r.booking_id, r.structure_id)} · arrivo ${fmtDay(r.arrival)}`} />)}
              </>)}
              {istatMsg && <div className="text-[11px] font-medium" style={{ color: istatMsg.startsWith("✓") ? "var(--ok)" : "var(--err)" }}>{istatMsg} <button onClick={() => router.push("/istat")} className="underline">apri ISTAT →</button></div>}
            </>
          ) : undefined}
        </StepCard>

        {/* 4 · Incassi */}
        <StepCard n={4} tone="var(--focus)" label="Fatture/ricevute da incassare" sub="Da incassare" count={docsUnpaid.length} badge={frac(docsPaid.length, docsUnpaid.length)} action="Registra incassi" onAction={() => router.push("/scadenzario-incassi")}>
          {(docsUnpaid.length > 0 || docsPaid.length > 0) ? (
            <>
              {docsUnpaid.length > 0 && (<>
                <SubHead>Da incassare ({docsUnpaid.length})</SubHead>
                {docsUnpaid.slice(0, 4).map((d) => <MiniRow key={d.id} left={`${d.number_label ?? "—"} · ${d.counterpart?.name ?? ""}`} right={eur(centsEur(balanceOf(d)))} />)}
              </>)}
              {docsPaid.length > 0 && (<>
                <SubHead mt={docsUnpaid.length > 0}>Incassati ({docsPaid.length})</SubHead>
                {docsPaid.slice(0, 3).map((d) => <DoneRow key={d.id} left={`${d.number_label ?? "—"} · ${d.counterpart?.name ?? ""}`} right={eur(centsEur(d.total_cents))} />)}
              </>)}
            </>
          ) : undefined}
        </StepCard>

        {/* 5 · Fatture scartate SdI */}
        <StepCard n={5} tone="var(--err)" label="Fatture elettroniche (SdI)" sub="Da correggere" count={docsRejected.length} badge={frac(docsSdiOk.length, docsRejected.length)} action="Correggi e reinvia" onAction={() => router.push("/documenti")}>
          {(docsRejected.length > 0 || docsSdiOk.length > 0) ? (
            <>
              {docsRejected.length > 0 && (<>
                <SubHead>Scartate ({docsRejected.length})</SubHead>
                {docsRejected.slice(0, 4).map((d) => <MiniRow key={d.id} left={`${d.number_label ?? "—"} · ${d.counterpart?.name ?? ""}`} />)}
              </>)}
              {docsSdiOk.length > 0 && (<>
                <SubHead mt={docsRejected.length > 0}>Trasmesse ({docsSdiOk.length})</SubHead>
                {docsSdiOk.slice(0, 3).map((d) => <DoneRow key={d.id} left={`${d.number_label ?? "—"} · ${d.counterpart?.name ?? ""}`} />)}
              </>)}
            </>
          ) : undefined}
        </StepCard>

        {/* 6 · Fatture fornitori */}
        <StepCard n={6} tone="var(--err)" label="Fatture fornitori scadute" sub="Scadute" count={passiveOverdue.length} badge={frac(passivePaid.length, passiveUnpaid.length)} action="Paga / registra" onAction={() => router.push("/fatture-passive")}>
          {(passiveOverdue.length > 0 || passivePaid.length > 0) ? (
            <>
              {passiveOverdue.length > 0 && (<>
                <SubHead>Scadute ({passiveOverdue.length})</SubHead>
                {passiveOverdue.slice(0, 4).map((p) => <MiniRow key={p.id} left={p.supplier_name ?? "Fornitore"} right={eur(centsEur(p.total_cents))} />)}
              </>)}
              {passivePaid.length > 0 && (<>
                <SubHead mt={passiveOverdue.length > 0}>Pagate ({passivePaid.length})</SubHead>
                {passivePaid.slice(0, 3).map((p) => <DoneRow key={p.id} left={p.supplier_name ?? "Fornitore"} right={eur(centsEur(p.total_cents))} />)}
              </>)}
            </>
          ) : undefined}
        </StepCard>
      </div>
      )}

    </div>
  );
}
