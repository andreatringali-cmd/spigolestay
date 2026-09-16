"use client";

// Assistente Xenora: risposte immediate calcolate sui dati reali (prenotazioni, incassi,
// arrivi, fatture). Versione senza LLM: capisce le domande via parole chiave e risponde con i numeri.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, Card } from "@/components/ui";
import { eur } from "@/lib/format";
import { bookingGrandTotal } from "@/lib/booking";

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthOf = (iso: string) => (iso || "").slice(0, 7);

type Ans = { title: string; value: string; detail?: string; go?: { label: string; href: string } };

export default function AssistentePage() {
  const router = useRouter();
  const { bookings, getGuest, getStructure } = useData();
  const [q, setQ] = useState("");
  const [ans, setAns] = useState<Ans | null>(null);

  const t = todayISO();
  const ym = monthOf(t);
  const active = useMemo(() => bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked"), [bookings]);

  const answers = useMemo(() => {
    const arrivalsToday = active.filter((b) => b.checkIn === t);
    const departuresToday = active.filter((b) => b.checkOut === t);
    const noCheckin = arrivalsToday.filter((b) => !b.webCheckin);
    const monthArr = active.filter((b) => monthOf(b.checkIn) === ym);
    const ricavoMese = monthArr.reduce((a, b) => a + bookingGrandTotal(b, getStructure(b.structureId)), 0);
    const incassatoMese = monthArr.reduce((a, b) => a + (b.paid ?? 0), 0);
    const nextArrival = active.filter((b) => b.checkIn > t).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
    const list = (bs: typeof bookings) => bs.slice(0, 6).map((b) => `${getGuest(b.guestId)?.fullName || "Ospite"} (${getStructure(b.structureId)?.name ?? ""})`).join(", ");
    return {
      arrivi: { title: "Arrivi di oggi", value: `${arrivalsToday.length}`, detail: list(arrivalsToday) || "Nessun arrivo oggi.", go: { label: "Prenotazioni", href: "/prenotazioni" } } as Ans,
      checkin: { title: "Arrivi senza check-in online", value: `${noCheckin.length}`, detail: list(noCheckin) || "Tutti hanno fatto il check-in.", go: { label: "Prenotazioni", href: "/prenotazioni" } } as Ans,
      partenze: { title: "Partenze di oggi", value: `${departuresToday.length}`, detail: list(departuresToday) || "Nessuna partenza oggi.", go: { label: "Pulizie", href: "/pulizie" } } as Ans,
      ricavo: { title: "Ricavo del mese", value: eur(ricavoMese), detail: `${monthArr.length} prenotazioni con arrivo questo mese.`, go: { label: "Statistiche", href: "/statistiche" } } as Ans,
      incassato: { title: "Incassato del mese", value: eur(incassatoMese), detail: `Su ${eur(ricavoMese)} di ricavo previsto.`, go: { label: "Incassi", href: "/pagamenti" } } as Ans,
      prossimo: { title: "Prossimo arrivo", value: nextArrival ? new Date(nextArrival.checkIn).toLocaleDateString("it-IT") : "—", detail: nextArrival ? `${getGuest(nextArrival.guestId)?.fullName || "Ospite"} · ${getStructure(nextArrival.structureId)?.name ?? ""}` : "Nessun arrivo futuro.", go: { label: "Calendario", href: "/calendario" } } as Ans,
    };
  }, [active, t, ym, getGuest, getStructure, bookings]);

  const ask = async (text: string) => {
    const s = text.toLowerCase();
    if (/check[\s-]?in|schedin/.test(s)) return setAns(answers.checkin);
    if (/partenz|check[\s-]?out|pulizi/.test(s)) return setAns(answers.partenze);
    if (/arriv|oggi|chi viene/.test(s)) return setAns(answers.arrivi);
    if (/incass|pagat/.test(s)) return setAns(answers.incassato);
    if (/ricav|fatturat|guadagn|incasso previst/.test(s)) return setAns(answers.ricavo);
    if (/prossim|futur/.test(s)) return setAns(answers.prossimo);
    // Da incassare (documenti) — via Supabase.
    if (/da incassare|residuo|scaden/.test(s) && supabase) {
      const [d, p] = await Promise.all([
        supabase.from("documents").select("id, total_cents").in("stato", ["emessa", "inviata_intermediario", "consegnata"]),
        supabase.from("document_payments").select("document_id, amount_cents"),
      ]);
      const paid = new Map<string, number>(); for (const x of (p.data ?? []) as { document_id: string; amount_cents: number }[]) paid.set(x.document_id, (paid.get(x.document_id) ?? 0) + x.amount_cents);
      const residuo = ((d.data ?? []) as { id: string; total_cents: number }[]).reduce((a, r) => a + Math.max(0, r.total_cents - (paid.get(r.id) ?? 0)), 0);
      return setAns({ title: "Da incassare", value: eur(residuo / 100), detail: "Documenti emessi non ancora saldati.", go: { label: "Scadenzario", href: "/scadenzario-incassi" } });
    }
    if (/fornitor|passiv|da pagare/.test(s) && supabase) {
      const { data } = await supabase.from("purchase_documents").select("total_cents, paid").eq("paid", false);
      const tot = ((data ?? []) as { total_cents: number }[]).reduce((a, r) => a + r.total_cents, 0);
      return setAns({ title: "Fatture fornitori da pagare", value: eur(tot / 100), detail: `${(data ?? []).length} fatture non pagate.`, go: { label: "Fatture passive", href: "/fatture-passive" } });
    }
    setAns({ title: "Non ho capito", value: "🤔", detail: "Prova con una delle domande rapide qui sotto." });
  };

  const CHIPS: { label: string; q: string }[] = [
    { label: "Chi arriva oggi?", q: "arrivi oggi" },
    { label: "Arrivi senza check-in", q: "check-in mancanti" },
    { label: "Partenze di oggi", q: "partenze" },
    { label: "Ricavo del mese", q: "ricavo del mese" },
    { label: "Incassato del mese", q: "incassato" },
    { label: "Da incassare", q: "da incassare" },
    { label: "Fornitori da pagare", q: "fornitori da pagare" },
    { label: "Prossimo arrivo", q: "prossimo arrivo" },
  ];

  return (
    <div>
      <PageHeader title="Assistente Xenora" subtitle="Chiedi e ti rispondo con i tuoi numeri" />
      <Card className="mb-4">
        <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Es. quanto ho incassato questo mese?" className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
          <button type="submit" className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Chiedi</button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CHIPS.map((c) => <button key={c.q} onClick={() => { setQ(c.label); ask(c.q); }} className="rounded-full border border-line px-3 py-1 text-xs font-medium text-dim hover:bg-wash">{c.label}</button>)}
        </div>
      </Card>

      {ans && (
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-faint">{ans.title}</div>
          <div className="mt-1 font-mono text-3xl font-bold text-txt">{ans.value}</div>
          {ans.detail && <p className="mt-1 text-sm text-dim">{ans.detail}</p>}
          {ans.go && <button onClick={() => router.push(ans.go!.href)} className="mt-3 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">{ans.go.label} →</button>}
        </Card>
      )}
      <p className="mt-3 text-xs text-faint">Assistente a risposte calcolate sui tuoi dati. L'assistente conversazionale (AI) si attiverà collegando una API.</p>
    </div>
  );
}
