"use client";

// Riconciliazione a fine importazione: confronta il FILE con quello che c'è davvero in Xenora (righe e importi) e mostra
// cosa è arrivato, cosa c'era già, cosa è stato scartato e perché. Si può scaricare l'elenco riga per riga.
import { useEffect, useMemo, useState } from "react";
import type { Booking, Guest } from "@/lib/types";
import { verifyOutcomes, skipReasons, outcomesToCsv, type ImportReport } from "@/lib/import/reconcile";
import { eur } from "@/lib/format";

const fmtD = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "—");

export default function RiepilogoImport({ report, bookings, guests }: { report: ImportReport; bookings: Booking[]; guests: Guest[] }) {
  // Si attende un attimo che l'archivio abbia assorbito le nuove prenotazioni, poi si confronta.
  const [ready, setReady] = useState(false);
  useEffect(() => { const id = setTimeout(() => setReady(true), 350); return () => clearTimeout(id); }, []);

  const v = useMemo(() => {
    if (!ready) return null;
    const gname = new Map(guests.map((g) => [g.id, g.fullName]));
    const mine = bookings
      .filter((b) => b.structureId === report.structureId)
      .map((b) => ({ extId: b.extId, guestName: gname.get(b.guestId) ?? "", checkIn: b.checkIn, checkOut: b.checkOut, total: b.total }));
    return verifyOutcomes(report.outcomes, mine);
  }, [ready, bookings, guests, report]);

  const reasons = useMemo(() => skipReasons(report.outcomes), [report]);
  const s = report.stats;
  const ok = !!v && v.missing.length === 0 && v.amountDiffs.length === 0;

  const download = () => {
    const miss = new Set(v?.missing ?? []);
    const blob = new Blob([outcomesToCsv(report.outcomes, miss)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `riepilogo-importazione-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const cell = (label: string, value: string | number, tone?: string, hint?: string) => (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5" title={hint}>
      <div className="font-mono text-lg font-bold tabular-nums" style={{ color: tone ?? "var(--txt)" }}>{value}</div>
      <div className="text-[11px] leading-tight text-faint">{label}</div>
    </div>
  );

  return (
    <div className="mx-auto mt-6 max-w-3xl text-left">
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-faint">Riconciliazione con il file{report.fileName ? ` · ${report.fileName}` : ""}</div>

      {!v ? (
        <div className="rounded-xl border border-line bg-wash px-4 py-3 text-sm text-dim">Controllo in corso…</div>
      ) : ok ? (
        <div className="rounded-xl px-4 py-3 text-sm font-semibold" style={{ color: "var(--ok)", background: "color-mix(in srgb, var(--ok) 12%, transparent)" }}>
          ✓ Tutte le {v.expected} righe valide del file sono in Xenora{v.fileTotal > 0 ? ` e gli importi tornano (${eur(v.systemTotal)})` : ""}.
        </div>
      ) : (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 12%, transparent)" }}>
          <div className="font-semibold">⚠ Trovate {v.found} righe su {v.expected} del file.</div>
          {v.missing.length > 0 && <div className="mt-0.5">Mancano {v.missing.length} righe: sotto trovi quali. Puoi rilanciare l&apos;importazione dello stesso file, aggiunge solo quelle che mancano.</div>}
          {v.amountDiffs.length > 0 && <div className="mt-0.5">{v.amountDiffs.length} prenotazioni hanno un importo diverso dal file (file {eur(v.fileTotal)} · Xenora {eur(v.systemTotal)}).</div>}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cell("righe nel file", s.fileRows)}
        {cell("importate ora", s.created, s.created > 0 ? "var(--ok)" : undefined)}
        {cell("già presenti", s.already, undefined, "Righe del file che c'erano già in Xenora: non vengono duplicate")}
        {cell("scartate", s.skipped, s.skipped > 0 ? "var(--err)" : undefined, "Righe senza nome o con date non riconosciute")}
        {cell(`prenotazioni di più camere (${s.multiRooms} camere)`, s.multiGroups)}
        {cell("ospiti nuovi", s.guestsNew)}
        {cell("ospiti già in archivio", s.guestsReused, undefined, "La stessa persona non viene duplicata: si riusa la sua scheda")}
        {cell("senza camera assegnata", s.noRoom, s.noRoom > 0 ? "var(--warn)" : undefined, "Tutte le camere di quella tipologia erano occupate: vanno assegnate a mano dal calendario")}
      </div>

      {reasons.length > 0 && (
        <div className="mt-3 rounded-xl border border-line bg-surface px-4 py-3 text-xs text-dim">
          <div className="mb-1 font-semibold text-txt">Righe scartate, per motivo</div>
          {reasons.map((r) => <div key={r.reason}>{r.count} · {r.reason}</div>)}
        </div>
      )}

      {v && v.missing.length > 0 && (
        <div className="mt-3 rounded-xl border border-line bg-surface px-4 py-3 text-xs text-dim">
          <div className="mb-1 font-semibold text-txt">Righe del file che non si trovano in Xenora</div>
          {v.missing.slice(0, 8).map((m) => <div key={m.row}>Riga {m.row} · {m.guest || "—"} · {fmtD(m.checkIn)} → {fmtD(m.checkOut)}</div>)}
          {v.missing.length > 8 && <div className="text-faint">…e altre {v.missing.length - 8} nel file scaricabile</div>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={download} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-txt hover:bg-wash">Scarica il riepilogo riga per riga (CSV)</button>
        {s.noRoom > 0 && <span className="text-xs text-faint">Le prenotazioni senza camera compaiono in &quot;Da assegnare&quot; nel calendario.</span>}
      </div>
    </div>
  );
}
