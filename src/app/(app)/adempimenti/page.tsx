"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, Card } from "@/components/ui";
import { eur } from "@/lib/format";
import { centsEur } from "@/lib/invoicing/client";

// Data locale (NON UTC): altrimenti vicino a mezzanotte "oggi" sfasa di un giorno.
const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };

export default function AdempimentiPage() {
  const router = useRouter();
  const { bookings, getGuest, getStructure } = useData();
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tile n={arrivalsNoCheckin.length} label="Arrivi senza check-in online" tone="var(--warn)" action="Prenotazioni" onClick={() => router.push("/prenotazioni")}>
          {arrivalsNoCheckin.slice(0, 4).map((b) => <div key={b.id} className="truncate">{getGuest(b.guestId)?.fullName || "Ospite"} · {getStructure(b.structureId)?.name ?? ""}</div>)}
        </Tile>

        <Tile n={schedRisk.length} label="Schedine da inviare (rischio 24h)" tone="var(--err)" action="Alloggiati Web" onClick={() => router.push("/alloggiati-web")}>
          {schedRisk.length > 0 ? <div>di cui in arrivo oggi: {schedToday.length}</div> : <div className="text-faint">nessuna in ritardo</div>}
        </Tile>

        <Tile n={istatPending} label="Movimenti ISTAT da inviare" tone="var(--warn)" action="ISTAT · Turist@t" onClick={() => router.push("/istat")} />

        <Tile n={docsRejected.length} label="Documenti scartati dallo SdI" tone="var(--err)" action="Documenti" onClick={() => router.push("/documenti")}>
          {docsRejected.slice(0, 4).map((d) => <div key={d.id} className="truncate">{d.number_label} · {d.counterpart?.name ?? ""}</div>)}
        </Tile>

        <Tile n={docsUnpaid.length} label="Documenti da incassare" tone="var(--focus)" action="Scadenzario" onClick={() => router.push("/scadenzario-incassi")}>
          {docsUnpaid.slice(0, 4).map((d) => <div key={d.id} className="flex justify-between gap-2"><span className="truncate">{d.number_label} · {d.counterpart?.name ?? ""}</span><span className="shrink-0 font-mono">{eur(centsEur(d.total_cents - (paidByDoc.get(d.id) ?? 0)))}</span></div>)}
        </Tile>

        <Tile n={passiveOverdue.length} label="Fatture fornitori scadute" tone="var(--err)" action="Fatture passive" onClick={() => router.push("/fatture-passive")}>
          {passiveOverdue.slice(0, 4).map((p) => <div key={p.id} className="flex justify-between gap-2"><span className="truncate">{p.supplier_name ?? "Fornitore"}</span><span className="shrink-0 font-mono">{eur(centsEur(p.total_cents))}</span></div>)}
        </Tile>
      </div>
    </div>
  );
}
