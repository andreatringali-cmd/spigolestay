"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader } from "@/components/ui";
import { eur } from "@/lib/format";
import { centsEur, apiPost } from "@/lib/invoicing/client";
import { shortenLink } from "@/lib/guestlink";
import type { Booking, Guest, Structure } from "@/lib/types";

// Data locale (NON UTC): altrimenti vicino a mezzanotte "oggi" sfasa di un giorno.
const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const soft = (tone: string, pct = 14) => `color-mix(in srgb, ${tone} ${pct}%, transparent)`;
const fmtDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }) : "—");
// Scadenza schedina Questura: entro 24h dall'arrivo (mostrata come giorno successivo all'arrivo).

// Completezza del check-in PER PERSONA (usata da card e righe).
const expectedPaxOf = (b: Booking) => Math.max(1, (b.adults ?? 1) + (b.children ?? 0));
const primaryDoneOf = (b: Booking) => b.webCheckin === true || !!(b.primaryGuest?.lastName && b.primaryGuest?.docNumber);
const declaredPaxOf = (b: Booking) => (primaryDoneOf(b) ? 1 : 0) + (b.extraGuests?.length ?? 0);

// Scheda di uno step in ordine cronologico: badge numerato (la sequenza è informativa),
// numero grande, pill di stato, mini-lista opzionale e azione a piena larghezza in fondo.
function StepCard({ n, tone, label, sub, count, action, onAction, children }: {
  n: number; tone: string; label: string; sub: string; count: number; action: string; onAction: () => void; children?: React.ReactNode;
}) {
  const active = count > 0;
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="h-1 w-full" style={{ background: active ? tone : "var(--line)" }} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl font-mono text-xl font-bold" style={{ background: active ? soft(tone) : "var(--wash)", color: active ? tone : "var(--faint)" }}>{count}</span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Passo {n}</div>
            <h3 className="mt-0.5 text-[13.5px] font-semibold leading-snug text-txt">{label}</h3>
          </div>
        </div>
        <div className="mt-2.5">
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={active ? { background: soft(tone), color: tone } : { background: soft("var(--ok)"), color: "var(--ok)" }}>{active ? sub : "✓ In ordine"}</span>
        </div>
        {children ? <div className="mt-3 flex-1 space-y-1.5">{children}</div> : <div className="flex-1" />}
        <button onClick={onAction} className="mt-3.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2 text-xs font-semibold text-txt transition hover:border-[color:var(--focus)] hover:bg-wash">{action}<span aria-hidden>→</span></button>
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
function ArrivalRow({ b, g, st, origin, waOn }: { b: Booking; g?: Guest; st?: Structure; origin: string; waOn?: boolean }) {
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
        body: JSON.stringify({ kind: "checkin_reminder", checkinUrl: link, booking: { code: b.code, structureName: st?.name, structureEmail: st?.email, guestName: g?.fullName, guestEmail: g?.email, checkIn: b.checkIn, checkInFrom: st?.checkInFrom, color: st?.photoColor, address: st?.address, phone: st?.phone } }),
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
  const expected = expectedPaxOf(b);
  const declared = declaredPaxOf(b);
  const partial = declared > 0 && declared < expected; // qualcuno ha fatto il check-in, ma non tutti
  return (
    <div className="rounded-lg border border-line bg-paper px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[13px] font-medium text-txt">{g?.fullName || "Ospite"} <span className="text-faint">· {st?.name ?? ""}</span></div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={partial ? { background: soft("var(--warn)"), color: "var(--warn)" } : { background: soft("var(--err)"), color: "var(--err)" }}>
          {partial ? `Incompleto ${declared}/${expected}` : "Da fare"}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-faint">
        <span>🗓 {fmtDay(b.checkIn)} → {fmtDay(b.checkOut)}</span>
        <span>👤 {expected} {expected === 1 ? "persona" : "persone"}</span>
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
  const { bookings, getGuest, getStructure } = useData();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
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

  // "Passaggio di palla" passo 1 → 2: genera/aggiorna le schedine dagli arrivi con check-in fatto.
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const transferToSchedine = async () => {
    setSyncing(true); setSyncMsg("");
    try {
      const r = await apiPost<{ count?: number }>("alloggiati/sync", {});
      await loadData();
      setSyncMsg(`✓ Trasferite alle schedine${typeof r?.count === "number" ? `: ${r.count}` : ""}.`);
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

  const t = today();
  // Completezza del check-in PER PERSONA: quanti ospiti dichiarati vs attesi (helper a livello modulo).
  const isComplete = (b: Booking) => declaredPaxOf(b) > 0 && declaredPaxOf(b) >= expectedPaxOf(b);
  const isActiveArrival = (b: Booking) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked";
  // Arrivi di oggi con check-in mancante o INCOMPLETO (non tutte le persone dichiarate).
  const arrivalsNoCheckin = useMemo(() => bookings.filter((b) => b.checkIn === t && isActiveArrival(b) && !isComplete(b)), [bookings, t]);
  // Arrivi di oggi con check-in COMPLETO per tutte le persone.
  const arrivalsCheckedIn = useMemo(() => bookings.filter((b) => b.checkIn === t && isActiveArrival(b) && isComplete(b)), [bookings, t]);
  const paidByDoc = useMemo(() => { const m = new Map<string, number>(); for (const p of pays) m.set(p.document_id, (m.get(p.document_id) ?? 0) + p.amount_cents); return m; }, [pays]);
  const balanceOf = (d: { id: string; total_cents: number }) => d.total_cents - (paidByDoc.get(d.id) ?? 0);
  // Solo prenotazioni ancora attive: schedine/ISTAT di annullate o no-show spariscono subito,
  // anche prima della prossima sincronizzazione che ripulisce gli orfani lato server.
  const activeBookingIds = useMemo(() => new Set(bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked").map((b) => b.id)), [bookings]);
  const isActive = (bookingId: string | null) => !bookingId || activeBookingIds.has(bookingId);
  // Prenotazioni col check-in COMPLETO per tutte le persone: solo queste possono avere schedine
  // "da inviare". Se una prenotazione è "da completare" (es. 0/2), NON deve comparire nel PASSO 2.
  const completeBookingIds = useMemo(() => new Set(bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked" && declaredPaxOf(b) > 0 && declaredPaxOf(b) >= expectedPaxOf(b)).map((b) => b.id)), [bookings]);
  // 2 · Schedine Questura — "da inviare" SOLO se: schedina PRONTA + prenotazione col check-in COMPLETO.
  // La schedina si invia DOPO l'arrivo: gli arrivi futuri sono esclusi.
  const schedPending = sched.filter((s) => s.stato === "pronta" && isActive(s.booking_id) && !!s.booking_id && completeBookingIds.has(s.booking_id));
  const schedToSend = schedPending.filter((s) => (s.arrival || "") <= t);   // arrivate/in arrivo oggi → inviabili
  const schedSent = sched.filter((s) => s.stato === "inviata");
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
  const bookingName = (bookingId: string | null) => { const b = bookingId ? bookings.find((x) => x.id === bookingId) : null; return b ? (getGuest(b.guestId)?.fullName || "Ospite") : "Prenotazione"; };
  const structName = (structureId: string | null, bookingId: string | null) => { const b = bookingId ? bookings.find((x) => x.id === bookingId) : null; return getStructure(structureId || b?.structureId || "")?.name || ""; };
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

  const allClear = arrivalsNoCheckin.length === 0 && schedToSend.length === 0 && istatPend.length === 0 && docsRejected.length === 0 && docsUnpaid.length === 0 && passiveOverdue.length === 0;
  const totalTasks = arrivalsNoCheckin.length + schedToSend.length + istatPend.length + docsUnpaid.length + docsRejected.length + passiveOverdue.length;
  const urgent = schedToSend.length + docsRejected.length + passiveOverdue.length; // scadenze/rifiuti = priorità alta
  const toDo = totalTasks - urgent;
  const headTone = allClear ? "var(--ok)" : urgent > 0 ? "var(--err)" : "var(--focus)";
  const dateStr = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      <PageHeader title="Adempimenti oggi" subtitle="Tutto ciò che va gestito o inviato, in ordine cronologico" />

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
      </section>

      {/* Ordine CRONOLOGICO: 1) check-in → 2) schedine Questura → 3) ISTAT → 4) incasso → 5) fattura/SdI → 6) fornitori */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* 1 · Check-in online → poi "passaggio di palla" alle schedine */}
        <StepCard n={1} tone="var(--warn)" label="Check-in online da completare" sub="Da completare" count={arrivalsNoCheckin.length} action={syncing ? "Trasferisco…" : "↪ Trasferisci alle schedine"} onAction={transferToSchedine}>
          {(arrivalsNoCheckin.length > 0 || arrivalsCheckedIn.length > 0 || syncMsg) ? (
            <>
              {arrivalsNoCheckin.length > 0 && (
                <>
                  <SubHead>Da completare ({arrivalsNoCheckin.length})</SubHead>
                  {arrivalsNoCheckin.slice(0, 5).map((b) => (
                    <ArrivalRow key={b.id} b={b} g={getGuest(b.guestId)} st={getStructure(b.structureId)} origin={origin} waOn={waOn} />
                  ))}
                </>
              )}
              {arrivalsCheckedIn.length > 0 && (
                <>
                  <SubHead mt={arrivalsNoCheckin.length > 0}>Check-in fatti ({arrivalsCheckedIn.length}) · pronti per le schedine</SubHead>
                  {arrivalsCheckedIn.slice(0, 6).map((b) => {
                    const g = getGuest(b.guestId); const st = getStructure(b.structureId);
                    return <DoneRow key={b.id} left={`${g?.fullName || "Ospite"} · ${st?.name ?? ""}`} right={`${fmtDay(b.checkIn)}→${fmtDay(b.checkOut)} · ${expectedPaxOf(b)}p`} />;
                  })}
                </>
              )}
              {syncMsg && <div className="text-[11px] font-medium" style={{ color: syncMsg.startsWith("✓") ? "var(--ok)" : "var(--err)" }}>{syncMsg}</div>}
            </>
          ) : undefined}
        </StepCard>

        {/* 2 · Schedine alla Questura */}
        <StepCard n={2} tone="var(--err)" label="Schedine alla Questura (Alloggiati Web)" sub="Pronte da inviare" count={schedToSendG.length} action="Invia alla Questura" onAction={() => router.push("/alloggiati-web")}>
          {(schedToSendG.length > 0 || schedSentG.length > 0) ? (
            <>
              {schedToSendG.length > 0 && (<>
                <SubHead>Pronte da inviare ({schedToSendG.length})</SubHead>
                {schedToSendG.slice(0, 4).map((gr) => (
                  <MiniRow key={gr.key}
                    left={`${bookingName(gr.bookingId)} · ${structName(gr.structureId, gr.bookingId)} · arrivo ${fmtDay(gr.arrival)}`}
                    right={`${schedLabel(gr.count)} · ${schedCd(gr.arrival)}`} />
                ))}
              </>)}
              {schedSentG.length > 0 && (<>
                <SubHead mt={schedToSendG.length > 0}>Inviate ({schedSentG.length})</SubHead>
                {schedSentG.slice(0, 3).map((gr) => (
                  <DoneRow key={gr.key} left={`${bookingName(gr.bookingId)} · arrivo ${fmtDay(gr.arrival)}`} right={schedLabel(gr.count)} />
                ))}
              </>)}
            </>
          ) : undefined}
        </StepCard>

        {/* 3 · ISTAT — passaggio di palla: genera dai arrivi, poi invia */}
        <StepCard n={3} tone="var(--warn)" label="Movimenti ISTAT" sub="Da inviare" count={istatPend.length} action={syncingIstat ? "Genero…" : "↪ Genera da arrivi"} onAction={transferToIstat}>
          {(istatPend.length > 0 || istatSent.length > 0 || istatMsg) ? (
            <>
              {istatPend.length > 0 && (<>
                <SubHead>Da inviare ({istatPend.length})</SubHead>
                {istatPend.slice(0, 4).map((r) => <MiniRow key={r.id} left={`${bookingName(r.booking_id)} · ${structName(r.structure_id, r.booking_id)}`} right={`arrivo ${fmtDay(r.arrival)}`} />)}
              </>)}
              {istatSent.length > 0 && (<>
                <SubHead mt={istatPend.length > 0}>Inviati ({istatSent.length})</SubHead>
                {istatSent.slice(0, 3).map((r) => <DoneRow key={r.id} left={`${bookingName(r.booking_id)} · arrivo ${fmtDay(r.arrival)}`} />)}
              </>)}
              {istatMsg && <div className="text-[11px] font-medium" style={{ color: istatMsg.startsWith("✓") ? "var(--ok)" : "var(--err)" }}>{istatMsg} <button onClick={() => router.push("/istat")} className="underline">apri ISTAT →</button></div>}
            </>
          ) : undefined}
        </StepCard>

        {/* 4 · Incassi */}
        <StepCard n={4} tone="var(--focus)" label="Fatture/ricevute da incassare" sub="Da incassare" count={docsUnpaid.length} action="Registra incassi" onAction={() => router.push("/scadenzario-incassi")}>
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
        <StepCard n={5} tone="var(--err)" label="Fatture elettroniche (SdI)" sub="Da correggere" count={docsRejected.length} action="Correggi e reinvia" onAction={() => router.push("/documenti")}>
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
        <StepCard n={6} tone="var(--err)" label="Fatture fornitori scadute" sub="Scadute" count={passiveOverdue.length} action="Paga / registra" onAction={() => router.push("/fatture-passive")}>
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

      <p className="mt-4 text-center text-[11px] text-faint">In ordine cronologico: check-in ospite → schedine Questura → ISTAT → incassi → fatture SdI → fornitori.</p>
    </div>
  );
}
