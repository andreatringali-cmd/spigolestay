"use client";

// Pannello "Adempimenti" nella scheda prenotazione: stato di Check-in, Schedine
// Alloggiati, ISTAT, Documenti, Pagamenti per QUESTA prenotazione, con azione rapida.
// Legge da Supabase (RLS) le righe collegate a booking_id.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { bookingGrandTotal } from "@/lib/booking";
import { eur } from "@/lib/format";
import type { Booking } from "@/lib/types";

type Chip = { label: string; tone: string };
const chip = (label: string, tone: string): Chip => ({ label, tone });

export default function AdempimentiPanel({ booking }: { booking: Booking }) {
  const router = useRouter();
  const { getStructure } = useData();
  const [sched, setSched] = useState<{ stato: string }[]>([]);
  const [istat, setIstat] = useState<{ stato: string }[]>([]);
  const [docs, setDocs] = useState<{ stato: string; number_label: string | null }[]>([]);
  const [timeline, setTimeline] = useState<{ id: string; ts: string; message: string }[]>([]);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [a, i, d, ev] = await Promise.all([
        supabase.from("alloggiati_schedine").select("stato").eq("booking_id", booking.id),
        supabase.from("istat_rows").select("stato").eq("booking_id", booking.id),
        supabase.from("documents").select("stato, number_label").eq("booking_id", booking.id).order("created_at", { ascending: false }),
        supabase.from("booking_events").select("id, ts, message").eq("booking_id", booking.id).order("ts", { ascending: false }).limit(8),
      ]);
      setSched((a.data ?? []) as { stato: string }[]);
      setIstat((i.data ?? []) as { stato: string }[]);
      setDocs((d.data ?? []) as { stato: string; number_label: string | null }[]);
      setTimeline((ev.data ?? []) as { id: string; ts: string; message: string }[]);
    })();
  }, [booking.id]);

  const structure = getStructure(booking.structureId);
  const grand = bookingGrandTotal(booking, structure);
  const paid = booking.paid ?? 0;

  // Stato Check-in
  const checkin: Chip = booking.webCheckin ? chip("Completato", "var(--ok)") : chip("Mancante", "var(--warn)");
  // Schedine
  const schedChip: Chip = sched.length === 0 ? chip("Nessuna", "var(--faint)")
    : sched.every((s) => s.stato === "inviata") ? chip("Inviate", "var(--ok)")
    : sched.some((s) => s.stato === "errore") ? chip("Errore", "var(--err)")
    : chip(`Da inviare (${sched.filter((s) => s.stato !== "inviata").length})`, "var(--warn)");
  // ISTAT
  const istatChip: Chip = istat.length === 0 ? chip("Nessuno", "var(--faint)")
    : istat.every((r) => r.stato === "sent") ? chip("Inviato", "var(--ok)")
    : chip("Da inviare", "var(--warn)");
  // Documenti
  const docChip: Chip = docs.length === 0 ? chip("Nessuno", "var(--faint)")
    : docs.some((d) => d.stato === "scartata") ? chip("Scartato", "var(--err)")
    : docs.some((d) => d.stato === "bozza") ? chip("Bozza", "var(--focus)")
    : chip(docs[0].number_label ?? "Emesso", "var(--ok)");
  // Pagamenti
  const payChip: Chip = grand <= 0 ? chip("—", "var(--faint)")
    : paid >= grand ? chip("Saldato", "var(--ok)")
    : paid > 0 ? chip(`Residuo ${eur(grand - paid)}`, "var(--warn)")
    : chip(`Da incassare ${eur(grand)}`, "var(--warn)");

  const Row = ({ label, c, onClick }: { label: string; c: Chip; onClick?: () => void }) => (
    <button onClick={onClick} disabled={!onClick} className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-left enabled:hover:border-focus enabled:hover:bg-wash disabled:cursor-default">
      <span className="text-sm text-txt">{label}</span>
      <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${c.tone} 16%, transparent)`, color: c.tone }}>{c.label}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <Row label="Check-in online" c={checkin} />
      <Row label="Schedine Alloggiati" c={schedChip} onClick={() => router.push("/alloggiati-web")} />
      <Row label="ISTAT · Turist@t" c={istatChip} onClick={() => router.push("/istat")} />
      <Row label="Documenti fiscali" c={docChip} onClick={() => router.push("/documenti")} />
      <Row label="Pagamenti" c={payChip} />
      {timeline.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Attività</div>
          <div className="flex flex-col gap-1">
            {timeline.map((e) => (
              <div key={e.id} className="flex gap-2 text-[12px]"><span className="w-16 shrink-0 text-faint">{new Date(e.ts).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}</span><span className="text-dim">{e.message}</span></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
