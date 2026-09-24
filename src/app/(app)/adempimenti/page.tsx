"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader } from "@/components/ui";
import WeatherWidget from "@/components/WeatherWidget";
import EmptyState from "@/components/EmptyState";
import { eur } from "@/lib/format";
import { centsEur, apiPost } from "@/lib/invoicing/client";
import { shortenLink } from "@/lib/guestlink";
import { cityTaxTotal, DEFAULT_CITY_TAX_RULES } from "@/lib/citytax";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { Booking, Guest, Structure } from "@/lib/types";

// Data locale (NON UTC): altrimenti vicino a mezzanotte "oggi" sfasa di un giorno.
const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const soft = (tone: string, pct = 14) => `color-mix(in srgb, ${tone} ${pct}%, transparent)`;
const fmtDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }) : "—");
const omini = (n: number) => (n <= 5 ? "👤".repeat(Math.max(1, n)) : `👤 ${n}`); // ospiti come icone
// Meta grafica per l'esito di ogni passo di "Elabora tutto".
const STEP_META: Record<"fatto" | "prova" | "errore" | "niente", { icon: string; label: string; tone: string }> = {
  fatto: { icon: "✓", label: "Fatto", tone: "var(--ok)" },
  prova: { icon: "🧪", label: "In prova", tone: "var(--warn)" },
  errore: { icon: "⚠", label: "Errore", tone: "var(--err)" },
  niente: { icon: "–", label: "Niente da fare", tone: "var(--faint)" },
};
// Scadenza schedina Questura: entro 24h dall'arrivo (mostrata come giorno successivo all'arrivo).

// Completezza del check-in PER PERSONA (usata da card e righe).
const expectedPaxOf = (b: Booking) => Math.max(1, (b.adults ?? 1) + (b.children ?? 0));
const primaryDoneOf = (b: Booking) => b.webCheckin === true || !!(b.primaryGuest?.lastName && b.primaryGuest?.docNumber);
// Un ospite conta come "dichiarato" solo se ha davvero dei dati (nome/cognome): un ospite
// vuoto aggiunto come segnaposto NON conta (altrimenti risulterebbe "2/2" con 1 solo compilato).
const declaredPaxOf = (b: Booking) => (primaryDoneOf(b) ? 1 : 0) + (b.extraGuests?.filter((e) => !!(e.lastName || e.firstName)).length ?? 0);

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
            <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Passo {n}</div>
            <h3 className="mt-0.5 text-[13.5px] font-semibold leading-snug text-txt">{label}</h3>
          </div>
        </div>
        {children ? <div className="mt-3 flex-1 space-y-1.5">{children}</div> : <div className="flex-1" />}
        <button onClick={onAction} className="mt-3.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-focus px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90">{action}<span aria-hidden>→</span></button>
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
      {right && <span className="shrink-0 font-mono text-faint">{right}</span>}
    </div>
  );
}

// Etichetta di sezione (Da fare / Fatti) dentro una card.
function SubHead({ children, mt }: { children: React.ReactNode; mt?: boolean }) {
  return <div className={`text-[10px] font-semibold uppercase tracking-wide text-faint ${mt ? "mt-2" : ""}`}>{children}</div>;
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
  const msg = `Gentile ${g?.firstName || "ospite"}, le scriviamo da ${st?.name || "la struttura"}. Per velocizzare il suo arrivo la invitiamo a completare il check-in online (dati e documento, bastano 2 minuti): ${link} . Grazie e a presto!${st?.name ? `\n— ${st.name}` : ""}`;
  const wa = g?.phone ? `https://wa.me/${g.phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}` : "";
  const sendMail = async () => {
    if (!g?.email) return;
    setMail("sending");
    try {
      const r = await fetch("/api/email", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "checkin_reminder", checkinUrl: link, booking: { code: b.code, structureName: st?.name, structureEmail: st?.email, guestName: g?.fullName, guestEmail: g?.email, checkIn: b.checkIn, checkInFrom: st?.checkInFrom, color: st?.photoColor, address: [st?.address, st?.streetNumber, st?.city].filter(Boolean).join(" "), phone: st?.phone, logo: st?.logo, website: st?.website, cin: st?.cin, vat: st?.vat } }),
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
        <div className="truncate text-[13px] font-medium text-txt"><span className="font-mono text-faint">{b.code || b.id.slice(0, 6).toUpperCase()}</span> · {g?.fullName || "Ospite"}{rooms && rooms > 1 ? <span className="ml-1 rounded-full bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[color:var(--focus)]" title="Prenotazione di gruppo: un solo link completa il check-in di tutte le camere">Gruppo · {rooms} camere</span> : b.groupId ? <span className="ml-1 rounded-full bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[color:var(--focus)]" title="Prenotazione di gruppo: un solo link completa il check-in di tutte le camere">Gruppo</span> : null}{showStruct && <span className="text-faint"> · {st?.name ?? ""}</span>}</div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={partial ? { background: soft("var(--warn)"), color: "var(--warn)" } : { background: soft("var(--err)"), color: "var(--err)" }}>
          {partial ? `Incompleto ${declared}/${expected}` : "Da fare"}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-faint">
        <span>🗓 {fmtDay(b.checkIn)} → {fmtDay(b.checkOut)}</span>
        <span title={`${expected} ospiti`}>{omini(expected)}</span>
        <span className={partial ? "font-semibold text-[color:var(--warn)]" : ""}>✓ check-in {declared}/{expected}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {wa && <button onClick={sendWa} disabled={ws === "sending" || ws === "sent"} className="rounded-md px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-70" style={{ backgroundColor: ws === "sent" ? "var(--ok)" : ws === "err" ? "var(--err)" : "#25D366" }} title={waOn ? "Invia su WhatsApp" : "Apri WhatsApp col messaggio pronto"}>{ws === "sent" ? "✓ Inviato" : ws === "sending" ? "Invio…" : ws === "err" ? "Riprova" : "💬 WhatsApp"}</button>}
        {g?.email && <button onClick={sendMail} disabled={mail === "sending" || mail === "sent"} className={`rounded-md px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-70 ${mail === "sent" ? "bg-[color:var(--ok)]" : mail === "err" ? "bg-[color:var(--err)]" : "bg-focus"}`}>{mail === "sent" ? "✓ Inviata" : mail === "sending" ? "Invio…" : mail === "err" ? "Riprova" : "✉ Email"}</button>}
        <button onClick={compila} className="rounded-md px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90" style={{ backgroundColor: "var(--warn)" }}>Compila tu</button>
      </div>
    </div>
  );
}

export default function AdempimentiPage() {
  const router = useRouter();
  const { bookings, structures, getGuest, getStructure, activeStructureId } = useData();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const showStruct = activeStructureId === "all"; // se una struttura è già selezionata in alto, non ripeto il nome
  const bkNo = (b: Booking) => b.code || b.id.slice(0, 6).toUpperCase();       // numero prenotazione
  const structPart = (structureId: string) => (showStruct ? ` · ${getStructure(structureId)?.name ?? ""}` : "");
  const [sched, setSched] = useState<{ id: string; arrival: string; stato: string; booking_id: string | null; guest: { cognome?: string; nome?: string } | null; structure_id: string | null }[]>([]);
  const [istat, setIstat] = useState<{ id: string; arrival: string; stato: string; booking_id: string | null; structure_id: string | null }[]>([]);
  const [docs, setDocs] = useState<{ id: string; number_label: string | null; stato: string; total_cents: number; counterpart: { name?: string } | null }[]>([]);
  const [pays, setPays] = useState<{ document_id: string; amount_cents: number }[]>([]);
  const [passive, setPassive] = useState<{ id: string; supplier_name: string | null; due_date: string | null; total_cents: number; paid: boolean }[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []); // countdown vivo
  // WhatsApp Cloud API collegato? Se sì, il pulsante invia DIRETTO; altrimenti apre wa.me.
  const [waOn, setWaOn] = useState(false);
  useEffect(() => { apiPost<{ connected: boolean }>("whatsapp/settings", { action: "status" }).then((r) => setWaOn(!!r.connected)).catch(() => {}); }, []);

  // Carica tutti i dati (anche il lato "fatti") in modo da poter aggiornare le schede dopo un'azione.
  const loadData = useCallback(async () => {
    if (!supabase) return;
    const [a, i, d, p, pv] = await Promise.all([
      supabase.from("alloggiati_schedine").select("id, arrival, stato, booking_id, guest, structure_id"),
      supabase.from("istat_rows").select("id, arrival, stato, booking_id, structure_id").in("stato", ["pending", "sent"]),
      supabase.from("documents").select("id, number_label, stato, total_cents, counterpart").in("stato", ["scartata", "emessa", "inviata_intermediario", "consegnata"]),
      supabase.from("document_payments").select("document_id, amount_cents"),
      supabase.from("purchase_documents").select("id, supplier_name, due_date, total_cents, paid"),
    ]);
    setSched((a.data ?? []) as typeof sched); setIstat((i.data ?? []) as typeof istat);
    setDocs((d.data ?? []) as typeof docs); setPays((p.data ?? []) as typeof pays);
    setPassive((pv.data ?? []) as typeof passive);
  }, []);
  useEffect(() => { loadData(); }, [loadData]);
  // Ricarica schedine/documenti al rientro sulla pagina o dopo una sincronizzazione dati,
  // così lo stato non resta indietro rispetto alle modifiche fatte altrove.
  useEffect(() => {
    const h = () => loadData();
    window.addEventListener("focus", h);
    window.addEventListener("spigolestay:datasync", h);
    return () => { window.removeEventListener("focus", h); window.removeEventListener("spigolestay:datasync", h); };
  }, [loadData]);

  // "Passaggio di palla" passo 1 → 2: genera/aggiorna le schedine dagli arrivi con check-in fatto.
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const transferToSchedine = async () => {
    setSyncing(true); setSyncMsg("");
    try {
      await apiPost<{ count?: number }>("alloggiati/sync", {});
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
      const r = await apiPost<{ count?: number }>("istat/sync", {});
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
    const inScope = bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && (activeStructureId === "all" || b.structureId === activeStructureId) && b.checkIn >= start && b.checkIn < end);
    const { total, count } = cityTaxTotal(inScope, DEFAULT_CITY_TAX_RULES);
    return {
      key: "tassa", label: "Tassa di soggiorno", status: count > 0 ? "fatto" : "niente", count,
      detail: count > 0 ? `Imposta stimata ${eur(total)} su ${count} ${count === 1 ? "soggiorno" : "soggiorni"} (trimestre in corso, regole Siracusa).` : "Nessun soggiorno da tassare nel periodo.",
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

  const t = today();
  // Badge "fatti/totali" (X/Y) per le card: undefined se non c'è nulla (così resta "In ordine").
  const frac = (done: number, todo: number) => (done + todo > 0 ? `${done}/${done + todo}` : undefined);
  // Completezza del check-in PER PERSONA: quanti ospiti dichiarati vs attesi (helper a livello modulo).
  const isComplete = (b: Booking) => declaredPaxOf(b) > 0 && declaredPaxOf(b) >= expectedPaxOf(b);
  const isActiveArrival = (b: Booking) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked";
  // Prenotazioni con almeno una schedina "da validare" (usata per il PASSO 2, a livello schedina).
  const bookingsWithInvalid = useMemo(() => new Set(sched.filter((s) => s.stato === "da_validare" && s.booking_id).map((s) => s.booking_id as string)), [sched]);
  // Validità calcolata sui DATI VERI della prenotazione (non sulla schedina, che è una copia).
  const guestFieldsOk = (g?: { lastName?: string; firstName?: string; sex?: string; birthDate?: string; birthPlace?: string; citizenship?: string; country?: string }) =>
    !!(g?.lastName && g?.firstName && g?.sex && g?.birthDate && g?.birthPlace && (g?.citizenship || g?.country));
  const bookingDataValid = (b: Booking) => {
    const p = getGuest(b.guestId) ?? b.primaryGuest;
    if (!guestFieldsOk(p) || !(p?.docType && p?.docNumber)) return false;
    for (const e of (b.extraGuests ?? [])) if (!guestFieldsOk(e)) return false;
    return true;
  };
  // Arrivi di oggi divisi in 3: DA COMPLETARE (dati mancanti), DA CORREGGERE (dati ospite non validi),
  // CHECK-IN FATTI (completi e validi). Lo stato dipende dai DATI della prenotazione, non dalla schedina.
  const arrivalsToday = useMemo(() => bookings.filter((b) => b.checkIn === t && isActiveArrival(b)), [bookings, t]);
  const arrivalsCheckedIn = arrivalsToday.filter((b) => isComplete(b) && bookingDataValid(b));
  // COLLASSO PER GRUPPO (solo visualizzazione PASSO 1): le prenotazioni con lo stesso groupId
  // diventano UNA voce (rappresentante = codice più basso, poi arrivo). Quelle senza groupId
  // restano individuali. Lo stato del gruppo è aggregato su TUTTE le sue prenotazioni.
  type ArrivalGroup = { key: string; rep: Booking; members: Booking[]; rooms: number; expected: number; declared: number; cat: "todo" | "fix" | "done" };
  const buildArrivalGroups = (list: Booking[]): ArrivalGroup[] => {
    const solo: Booking[] = [];
    const byGroup = new Map<string, Booking[]>();
    for (const b of list) {
      if (b.groupId) { const arr = byGroup.get(b.groupId) ?? []; arr.push(b); byGroup.set(b.groupId, arr); }
      else solo.push(b);
    }
    const mk = (members: Booking[], key: string): ArrivalGroup => {
      const rep = [...members].sort((a, c) => { const ka = bkNo(a), kc = bkNo(c); if (ka !== kc) return ka < kc ? -1 : 1; return (a.checkIn || "") < (c.checkIn || "") ? -1 : 1; })[0];
      const expected = members.reduce((s, m) => s + expectedPaxOf(m), 0);
      const declared = members.reduce((s, m) => s + declaredPaxOf(m), 0);
      const allDone = members.every((m) => isComplete(m) && bookingDataValid(m));
      const someFix = members.some((m) => isComplete(m) && !bookingDataValid(m));
      const cat: ArrivalGroup["cat"] = allDone ? "done" : someFix ? "fix" : "todo";
      return { key, rep, members, rooms: members.length, expected, declared, cat };
    };
    const groups: ArrivalGroup[] = [];
    for (const b of solo) groups.push(mk([b], b.id));
    for (const [gid, members] of byGroup) groups.push(mk(members, gid));
    return groups.sort((a, b) => ((a.rep.checkIn || "") < (b.rep.checkIn || "") ? -1 : 1));
  };
  const arrivalGroups = buildArrivalGroups(arrivalsToday);
  const groupsNoCheckin = arrivalGroups.filter((gr) => gr.cat === "todo");
  const groupsToFix = arrivalGroups.filter((gr) => gr.cat === "fix");
  const groupsCheckedIn = arrivalGroups.filter((gr) => gr.cat === "done");
  const paidByDoc = useMemo(() => { const m = new Map<string, number>(); for (const p of pays) m.set(p.document_id, (m.get(p.document_id) ?? 0) + p.amount_cents); return m; }, [pays]);
  const balanceOf = (d: { id: string; total_cents: number }) => d.total_cents - (paidByDoc.get(d.id) ?? 0);
  // Solo prenotazioni ancora attive: schedine/ISTAT di annullate o no-show spariscono subito,
  // anche prima della prossima sincronizzazione che ripulisce gli orfani lato server.
  const activeBookingIds = useMemo(() => new Set(bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked").map((b) => b.id)), [bookings]);
  const isActive = (bookingId: string | null) => !bookingId || activeBookingIds.has(bookingId);
  // Prenotazioni col check-in COMPLETO per tutte le persone: solo queste possono avere schedine
  // "da inviare". Se una prenotazione è "da completare" (es. 0/2), NON deve comparire nel PASSO 2.
  const completeBookingIds = useMemo(() => new Set(bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked" && declaredPaxOf(b) > 0 && declaredPaxOf(b) >= expectedPaxOf(b)).map((b) => b.id)), [bookings]);
  // 2 · Schedine Questura — "da inviare" SOLO se: schedina PRONTA + prenotazione COMPLETA + nessuna
  // schedina della stessa prenotazione ancora da validare. Gli arrivi futuri sono esclusi (sotto).
  const schedPending = sched.filter((s) => s.stato === "pronta" && isActive(s.booking_id) && !!s.booking_id && completeBookingIds.has(s.booking_id) && !bookingsWithInvalid.has(s.booking_id));
  const schedToSend = schedPending.filter((s) => (s.arrival || "") <= t);   // arrivate/in arrivo oggi → inviabili
  const schedSent = sched.filter((s) => s.stato === "inviata");
  // Prenotazioni con check-in COMPLETO ma SENZA schedine ancora generate → "da trasferire alle schedine".
  const schedBookingIds = new Set(sched.map((s) => s.booking_id).filter(Boolean) as string[]);
  const weekAgo = (() => { const d = new Date(t + "T00:00:00"); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();
  const needsTransfer = bookings.filter((b) => isActiveArrival(b) && isComplete(b) && (b.checkIn || "") >= weekAgo && !schedBookingIds.has(b.id));
  // Tra i "check-in fatti" (completi e validi), quali non hanno ancora la schedina generata → da trasferire.
  const toTransfer = arrivalsCheckedIn.filter((b) => !schedBookingIds.has(b.id));
  // Raggruppa le schedine per PRENOTAZIONE: una riga per prenotazione, con quante schedine ha
  // (una a persona). Così con più prenotazioni si capisce a colpo d'occhio a chi si riferiscono.
  type SchedRow = typeof sched[number];
  const groupSched = (list: SchedRow[]) => {
    const m = new Map<string, { key: string; bookingId: string | null; arrival: string; structureId: string | null; count: number }>();
    for (const s of list) {
      const key = s.booking_id || s.id;
      const cur = m.get(key) ?? { key, bookingId: s.booking_id, arrival: s.arrival, structureId: s.structure_id, count: 0 };
      cur.count += 1;
      if (s.arrival && (!cur.arrival || s.arrival < cur.arrival)) cur.arrival = s.arrival;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => (a.arrival < b.arrival ? -1 : 1));
  };
  const schedToSendG = groupSched(schedToSend);
  const schedSentG = groupSched(schedSent);
  // Etichetta prenotazione: numero · ospite (· struttura solo se non già selezionata in alto).
  const bookingLabel = (bookingId: string | null, structureId: string | null) => {
    const b = bookingId ? bookings.find((x) => x.id === bookingId) : null;
    const nm = b ? (getGuest(b.guestId)?.fullName || "Ospite") : "Prenotazione";
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
    return over ? `⚠ scaduta da ${lbl}` : `⏱ tra ${lbl}`;
  };
  // 3 · ISTAT — pending (solo prenotazioni vive) vs inviati.
  const istatPend = istat.filter((s) => s.stato === "pending" && isActive(s.booking_id) && (s.arrival || "") <= t);
  const istatSent = istat.filter((s) => s.stato === "sent");
  // 4 · Incassi — documenti non saldati vs saldati.
  const docsUnpaid = docs.filter((d) => d.stato !== "scartata" && balanceOf(d) > 0);
  const docsPaid = docs.filter((d) => d.stato !== "scartata" && balanceOf(d) <= 0);
  // 5 · SdI — scartati vs consegnati/emessi.
  const docsRejected = docs.filter((d) => d.stato === "scartata");
  const docsSdiOk = docs.filter((d) => d.stato !== "scartata");
  // 6 · Fornitori — scadute da pagare vs pagate.
  const passiveUnpaid = passive.filter((p) => !p.paid);
  const passivePaid = passive.filter((p) => p.paid);
  const passiveOverdue = passiveUnpaid.filter((p) => p.due_date && p.due_date <= t);

  // Il totale in alto usa gli STESSI conteggi delle card (schedine raggruppate per prenotazione).
  const checkinTodo = groupsNoCheckin.length + groupsToFix.length; // da completare + da correggere (per GRUPPO)
  const allClear = checkinTodo === 0 && schedToSendG.length === 0 && istatPend.length === 0 && docsRejected.length === 0 && docsUnpaid.length === 0 && passiveOverdue.length === 0;
  const totalTasks = checkinTodo + schedToSendG.length + istatPend.length + docsUnpaid.length + docsRejected.length + passiveOverdue.length;
  const urgent = schedToSendG.length + docsRejected.length + passiveOverdue.length; // scadenze/rifiuti = priorità alta
  const toDo = totalTasks - urgent;
  const headTone = allClear ? "var(--ok)" : urgent > 0 ? "var(--err)" : "var(--focus)";
  const dateStr = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      <PageHeader title="Adempimenti oggi" subtitle="Tutto ciò che va gestito o inviato, in ordine cronologico" actions={<WeatherWidget compact />} />

      {/* Riepilogo d'impatto: quante cose da gestire e con che priorità */}
      <section className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
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
            <div className="flex flex-wrap gap-2">
              {urgent > 0 && <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: soft("var(--err)"), color: "var(--err)" }}><b className="font-mono">{urgent}</b> urgenti</span>}
              {toDo > 0 && <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: soft("var(--focus)"), color: "var(--focus)" }}><b className="font-mono">{toDo}</b> da fare</span>}
            </div>
          </>
        )}
        {/* Azione "in un click": elabora TUTTI gli adempimenti PA dovuti (schedine, ISTAT, tassa) in sequenza. */}
        <button onClick={startElabora} disabled={runBusy} className="ml-auto inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, var(--focus), color-mix(in srgb, var(--focus) 70%, #7c3aed))" }} title="Elabora in sequenza schedine Alloggiati, movimenti ISTAT e tassa di soggiorno">
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
                      <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: soft(m.tone), color: m.tone }}>{m.label}</span>
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
        <EmptyState title="Tutto in ordine per oggi" sub="Non c'è niente da inviare o gestire adesso. Comparirà qui appena serve." />
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
                        <span className="truncate text-dim"><span className="font-mono text-faint">{bkNo(b)}</span> · {g?.fullName || "Ospite"}{gr.rooms > 1 && <span className="ml-1 rounded-full bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[color:var(--focus)]" title="Prenotazione di gruppo: un solo link completa il check-in di tutte le camere">Gruppo · {gr.rooms} camere</span>}{showStruct && <span className="text-faint"> · {st?.name ?? ""}</span>}</span>
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
                    return <DoneRow key={gr.key} left={`${bkNo(b)} · ${g?.fullName || "Ospite"}${roomsLabel}${structPart(b.structureId)}`} right={allTransferred ? `${fmtDay(b.checkIn)}→${fmtDay(b.checkOut)} · ${omini(gr.expected)}` : "↪ da trasferire"} />;
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
