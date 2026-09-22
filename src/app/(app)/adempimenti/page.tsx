"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, Card } from "@/components/ui";
import { eur } from "@/lib/format";
import { centsEur } from "@/lib/invoicing/client";
import type { Booking, Guest, Structure } from "@/lib/types";

// Data locale (NON UTC): altrimenti vicino a mezzanotte "oggi" sfasa di un giorno.
const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };

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
  // Schedine a rischio (arrivo entro ieri, non inviate → 24h).
  const schedRisk = sched.filter((s) => s.arrival && s.arrival <= t);
  const schedToday = sched.filter((s) => s.arrival === t);
  const istatPending = istat.length;
  const docsRejected = docs.filter((d) => d.stato === "scartata");
  const paidByDoc = useMemo(() => { const m = new Map<string, number>(); for (const p of pays) m.set(p.document_id, (m.get(p.document_id) ?? 0) + p.amount_cents); return m; }, [pays]);
  const docsUnpaid = docs.filter((d) => d.stato !== "scartata" && d.total_cents - (paidByDoc.get(d.id) ?? 0) > 0);
  const passiveOverdue = passive.filter((p) => p.due_date && p.due_date <= t);

  const Tile = ({ n, label, tone, action, onClick, children }: { n: number; label: string; tone: string; action: string; onClick: () => void; children?: React.ReactNode }) => (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-3xl font-bold" style={{ color: n > 0 ? tone : "var(--faint)" }}>{n}</div>
          <div className="mt-0.5 text-sm font-semibold text-txt">{label}</div>
        </div>
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: n > 0 ? tone : "var(--line)" }} />
      </div>
      {children && <div className="mt-2 flex-1 space-y-1 text-[13px] text-dim">{children}</div>}
      <button onClick={onClick} className="mt-3 self-start rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">{action} →</button>
    </Card>
  );

  const allClear = arrivalsNoCheckin.length === 0 && schedRisk.length === 0 && istatPending === 0 && docsRejected.length === 0 && docsUnpaid.length === 0 && passiveOverdue.length === 0;

  return (
    <div>
      <PageHeader title="Adempimenti oggi" subtitle={new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })} />

      {allClear && <Card className="mb-4"><p className="text-sm font-medium text-[color:var(--ok)]">✓ Tutto in ordine per oggi.</p></Card>}

      {/* Ordine CRONOLOGICO del lavoro: dalla prenotazione all'invio di tutto.
          1) check-in ospite → 2) schedine Questura → 3) ISTAT → 4) incasso → 5) fattura/SdI → 6) fornitori */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* 1 · Sollecita il check-in online dell'ospite (azione diretta) */}
        <Card className="flex flex-col">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-3xl font-bold" style={{ color: arrivalsNoCheckin.length > 0 ? "var(--warn)" : "var(--faint)" }}>{arrivalsNoCheckin.length}</div>
              <div className="mt-0.5 text-sm font-semibold text-txt">1 · Arrivi senza check-in online</div>
            </div>
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: arrivalsNoCheckin.length > 0 ? "var(--warn)" : "var(--line)" }}>1</span>
          </div>
          <div className="mt-2 flex-1 space-y-1.5">
            {arrivalsNoCheckin.length === 0 && <div className="text-[13px] text-faint">Tutti gli arrivi di oggi hanno fatto il check-in.</div>}
            {arrivalsNoCheckin.slice(0, 5).map((b) => (
              <ArrivalRow key={b.id} b={b} g={getGuest(b.guestId)} st={getStructure(b.structureId)} origin={origin} />
            ))}
          </div>
          <button onClick={() => router.push("/prenotazioni")} className="mt-3 self-start rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Tutte le prenotazioni →</button>
        </Card>

        {/* 2 · Schedine alla Questura (dopo i check-in) */}
        <Tile n={schedRisk.length} label="2 · Schedine da inviare (Alloggiati Web)" tone="var(--err)" action="Invia schedine" onClick={() => router.push("/alloggiati-web")}>
          {schedRisk.length > 0 ? <div>a rischio 24h · in arrivo oggi: {schedToday.length}</div> : <div className="text-faint">nessuna in ritardo</div>}
        </Tile>

        {/* 3 · ISTAT */}
        <Tile n={istatPending} label="3 · Movimenti ISTAT da inviare" tone="var(--warn)" action="Invia a ISTAT" onClick={() => router.push("/istat")} />

        {/* 4 · Incassi */}
        <Tile n={docsUnpaid.length} label="4 · Fatture/ricevute da incassare" tone="var(--focus)" action="Registra incassi" onClick={() => router.push("/scadenzario-incassi")}>
          {docsUnpaid.slice(0, 4).map((d) => <div key={d.id} className="flex justify-between gap-2"><span className="truncate">{d.number_label} · {d.counterpart?.name ?? ""}</span><span className="shrink-0 font-mono">{eur(centsEur(d.total_cents - (paidByDoc.get(d.id) ?? 0)))}</span></div>)}
        </Tile>

        {/* 5 · Fatture scartate SdI */}
        <Tile n={docsRejected.length} label="5 · Documenti scartati dallo SdI" tone="var(--err)" action="Correggi e reinvia" onClick={() => router.push("/documenti")}>
          {docsRejected.slice(0, 4).map((d) => <div key={d.id} className="truncate">{d.number_label} · {d.counterpart?.name ?? ""}</div>)}
        </Tile>

        {/* 6 · Fatture fornitori */}
        <Tile n={passiveOverdue.length} label="6 · Fatture fornitori scadute" tone="var(--err)" action="Paga / registra" onClick={() => router.push("/fatture-passive")}>
          {passiveOverdue.slice(0, 4).map((p) => <div key={p.id} className="flex justify-between gap-2"><span className="truncate">{p.supplier_name ?? "Fornitore"}</span><span className="shrink-0 font-mono">{eur(centsEur(p.total_cents))}</span></div>)}
        </Tile>
      </div>
    </div>
  );
}
