"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader } from "@/components/ui";
import { eur } from "@/lib/format";
import { centsEur } from "@/lib/invoicing/client";
import type { Booking, Guest, Structure } from "@/lib/types";

// Data locale (NON UTC): altrimenti vicino a mezzanotte "oggi" sfasa di un giorno.
const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const soft = (tone: string, pct = 14) => `color-mix(in srgb, ${tone} ${pct}%, transparent)`;

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

// Riga arrivo senza check-in: WhatsApp (link), Email diretta (server) e "Compila tu" (apri il form).
function ArrivalRow({ b, g, st, origin }: { b: Booking; g?: Guest; st?: Structure; origin: string }) {
  const [mail, setMail] = useState<"idle" | "sending" | "sent" | "err">("idle");
  const link = `${origin}/checkin?b=${b.id}`;
  const msg = `Ciao ${g?.firstName || ""}, completa il check-in online per il tuo soggiorno${st ? ` a ${st.name}` : ""}: ${link}`;
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
  const compila = () => { const w = window.open(link, "_blank"); if (!w) window.location.href = link; };
  return (
    <div className="rounded-lg border border-line bg-paper px-2.5 py-1.5">
      <div className="truncate text-[13px] font-medium text-txt">{g?.fullName || "Ospite"} <span className="text-faint">· {st?.name ?? ""}</span></div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {wa && <a href={wa} target="_blank" rel="noreferrer" className="rounded-md px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#25D366" }}>💬 Sollecita</a>}
        {g?.email && <button onClick={sendMail} disabled={mail === "sending" || mail === "sent"} className={`rounded-md px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-70 ${mail === "sent" ? "bg-[color:var(--ok)]" : mail === "err" ? "bg-[color:var(--err)]" : "bg-focus"}`}>{mail === "sent" ? "✓ Inviata" : mail === "sending" ? "Invio…" : mail === "err" ? "Riprova" : "✉ Email"}</button>}
        <button onClick={compila} className="rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-txt hover:bg-wash">Compila tu</button>
      </div>
    </div>
  );
}

export default function AdempimentiPage() {
  const router = useRouter();
  const { bookings, getGuest, getStructure } = useData();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [sched, setSched] = useState<{ id: string; arrival: string; stato: string }[]>([]);
  const [istat, setIstat] = useState<{ id: string; arrival: string; stato: string }[]>([]);
  const [docs, setDocs] = useState<{ id: string; number_label: string | null; stato: string; total_cents: number; counterpart: { name?: string } | null }[]>([]);
  const [pays, setPays] = useState<{ document_id: string; amount_cents: number }[]>([]);
  const [passive, setPassive] = useState<{ id: string; supplier_name: string | null; due_date: string | null; total_cents: number }[]>([]);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [a, i, d, p, pv] = await Promise.all([
        supabase.from("alloggiati_schedine").select("id, arrival, stato").neq("stato", "inviata"),
        supabase.from("istat_rows").select("id, arrival, stato").eq("stato", "pending"),
        supabase.from("documents").select("id, number_label, stato, total_cents, counterpart").in("stato", ["scartata", "emessa", "inviata_intermediario", "consegnata"]),
        supabase.from("document_payments").select("document_id, amount_cents"),
        supabase.from("purchase_documents").select("id, supplier_name, due_date, total_cents").eq("paid", false),
      ]);
      setSched((a.data ?? []) as typeof sched); setIstat((i.data ?? []) as typeof istat);
      setDocs((d.data ?? []) as typeof docs); setPays((p.data ?? []) as typeof pays);
      setPassive((pv.data ?? []) as typeof passive);
    })();
  }, []);

  const t = today();
  // Arrivi di oggi senza check-in online.
  const arrivalsNoCheckin = useMemo(() => bookings.filter((b) => b.checkIn === t && b.status !== "cancelled" && b.channel !== "blocked" && !b.webCheckin), [bookings, t]);
  // Check-in di oggi GIÀ completati + ospiti attualmente in casa (per il messaggio positivo).
  const arrivalsCheckedIn = useMemo(() => bookings.filter((b) => b.checkIn === t && b.status !== "cancelled" && b.channel !== "blocked" && b.webCheckin), [bookings, t]);
  const inHouseNow = useMemo(() => bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.checkIn <= t && t < b.checkOut), [bookings, t]);
  // Schedine a rischio (arrivo entro ieri, non inviate → 24h).
  const schedRisk = sched.filter((s) => s.arrival && s.arrival <= t);
  const schedToday = sched.filter((s) => s.arrival === t);
  const istatPending = istat.length;
  const docsRejected = docs.filter((d) => d.stato === "scartata");
  const paidByDoc = useMemo(() => { const m = new Map<string, number>(); for (const p of pays) m.set(p.document_id, (m.get(p.document_id) ?? 0) + p.amount_cents); return m; }, [pays]);
  const docsUnpaid = docs.filter((d) => d.stato !== "scartata" && d.total_cents - (paidByDoc.get(d.id) ?? 0) > 0);
  const passiveOverdue = passive.filter((p) => p.due_date && p.due_date <= t);

  const allClear = arrivalsNoCheckin.length === 0 && schedRisk.length === 0 && istatPending === 0 && docsRejected.length === 0 && docsUnpaid.length === 0 && passiveOverdue.length === 0;
  const totalTasks = arrivalsNoCheckin.length + schedRisk.length + istatPending + docsUnpaid.length + docsRejected.length + passiveOverdue.length;
  const urgent = schedRisk.length + docsRejected.length + passiveOverdue.length; // scadenze/rifiuti = priorità alta
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
        {/* 1 · Sollecita il check-in online dell'ospite (azione diretta in-scheda) */}
        <StepCard n={1} tone="var(--warn)" label="Arrivi senza check-in online" sub="Da sollecitare" count={arrivalsNoCheckin.length} action="Tutte le prenotazioni" onAction={() => router.push("/prenotazioni")}>
          {arrivalsNoCheckin.length > 0
            ? arrivalsNoCheckin.slice(0, 5).map((b) => (
                <ArrivalRow key={b.id} b={b} g={getGuest(b.guestId)} st={getStructure(b.structureId)} origin={origin} />
              ))
            : (arrivalsCheckedIn.length > 0 || inHouseNow.length > 0)
              ? <div className="rounded-lg border border-line bg-paper px-2.5 py-2 text-[12.5px] text-dim">✓ <b className="text-txt">{arrivalsCheckedIn.length}</b> check-in completati oggi{inHouseNow.length ? <> · <b className="text-txt">{inHouseNow.length}</b> in casa ora</> : null}. Le schedine sono pronte da inviare 👇</div>
              : undefined}
        </StepCard>

        {/* 2 · Schedine alla Questura */}
        <StepCard n={2} tone="var(--err)" label="Schedine alla Questura (Alloggiati Web)" sub="Pronte da inviare" count={schedRisk.length} action="Invia schedine" onAction={() => router.push("/alloggiati-web")}>
          {schedRisk.length > 0 ? <div className="text-[12.5px] text-dim">Generate dai check-in · in arrivo oggi: <b className="text-txt">{schedToday.length}</b></div> : undefined}
        </StepCard>

        {/* 3 · ISTAT */}
        <StepCard n={3} tone="var(--warn)" label="Movimenti ISTAT da inviare" sub="Da inviare" count={istatPending} action="Invia a ISTAT" onAction={() => router.push("/istat")} />

        {/* 4 · Incassi */}
        <StepCard n={4} tone="var(--focus)" label="Fatture/ricevute da incassare" sub="Da incassare" count={docsUnpaid.length} action="Registra incassi" onAction={() => router.push("/scadenzario-incassi")}>
          {docsUnpaid.length > 0 ? docsUnpaid.slice(0, 4).map((d) => <MiniRow key={d.id} left={`${d.number_label ?? "—"} · ${d.counterpart?.name ?? ""}`} right={eur(centsEur(d.total_cents - (paidByDoc.get(d.id) ?? 0)))} />) : undefined}
        </StepCard>

        {/* 5 · Fatture scartate SdI */}
        <StepCard n={5} tone="var(--err)" label="Fatture scartate dallo SdI" sub="Da correggere" count={docsRejected.length} action="Correggi e reinvia" onAction={() => router.push("/documenti")}>
          {docsRejected.length > 0 ? docsRejected.slice(0, 4).map((d) => <MiniRow key={d.id} left={`${d.number_label ?? "—"} · ${d.counterpart?.name ?? ""}`} />) : undefined}
        </StepCard>

        {/* 6 · Fatture fornitori */}
        <StepCard n={6} tone="var(--err)" label="Fatture fornitori scadute" sub="Scadute" count={passiveOverdue.length} action="Paga / registra" onAction={() => router.push("/fatture-passive")}>
          {passiveOverdue.length > 0 ? passiveOverdue.slice(0, 4).map((p) => <MiniRow key={p.id} left={p.supplier_name ?? "Fornitore"} right={eur(centsEur(p.total_cents))} />) : undefined}
        </StepCard>
      </div>

      <p className="mt-4 text-center text-[11px] text-faint">In ordine cronologico: check-in ospite → schedine Questura → ISTAT → incassi → fatture SdI → fornitori.</p>
    </div>
  );
}
