import type { Booking, Structure } from "@/lib/types";
import { bookingPaidTotal, cityTaxOf, cityTaxPayers, commissionOf, commissionPctOf, nettoOf } from "@/lib/booking";
import { nights } from "@/lib/dates";
import { eur } from "@/lib/format";

// Riepilogo importi di una prenotazione: come si arriva al totale (soggiorno, pulizia, extra, parcheggio), cosa è stato incassato e cosa no,
// tassa di soggiorno (riscossa a parte) e commissione dell'OTA. Il totale in grande resta nella riga; qui sotto c'è il "perché".
export default function BookingAmounts({ b, structure }: { b: Booking; structure?: Structure }) {
  const acc = b.total ?? 0;
  if (!acc) return null;
  const n = nights(b.checkIn, b.checkOut);
  const clean = b.cleaningFee ?? 0;
  const extras = (b.extras ?? []).filter((e) => e && (e.price || e.name));
  const hasParkingExtra = extras.some((e) => /parcheggi|parking/i.test(e.name || ""));
  const total = bookingPaidTotal(b);
  const paid = b.paid ?? 0;
  const resid = Math.max(0, total - paid);
  const tax = cityTaxOf(structure, cityTaxPayers(structure, b), n, acc, b.cityTaxExempt);
  const comm = commissionOf(b);
  // Il dettaglio "come arriviamo al totale" serve solo se oltre al soggiorno c'è altro: altrimenti ripeterebbe il totale già in alto.
  const showBreakdown = clean > 0 || extras.length > 0 || (!!b.parking && !hasParkingExtra);
  const Row = ({ k, v, color, strong, title }: { k: string; v: string; color?: string; strong?: boolean; title?: string }) => (
    <div className="flex items-baseline justify-between gap-2" title={title}>
      <span className={`min-w-0 truncate ${strong ? "font-semibold text-txt" : "text-faint"}`}>{k}</span>
      <span className={`shrink-0 font-mono tabular-nums ${strong ? "font-semibold" : ""}`} style={{ color: color ?? (strong ? "var(--txt)" : "var(--dim)") }}>{v}</span>
    </div>
  );
  return (
    <div className="w-full text-[11px] leading-snug">
      {showBreakdown && <div className="flex flex-col gap-0.5 border-t border-line pt-1.5">
        <Row k={`Soggiorno · ${n} ${n === 1 ? "notte" : "notti"}`} v={eur(acc)} />
        {clean > 0 && <Row k="Pulizia finale" v={eur(clean)} />}
        {extras.map((e, i) => <Row key={i} k={`${e.name || "Extra"}${e.qty && e.qty > 1 ? ` ×${e.qty}` : ""}`} v={eur(e.price || 0)} />)}
        {b.parking && !hasParkingExtra && <Row k="Parcheggio" v="incluso" />}
      </div>}
      <div className={`${showBreakdown ? "mt-1.5 " : ""}flex flex-col gap-0.5 border-t border-line pt-1.5`}>
        <Row k="Incassato" v={eur(paid)} color={paid > 0 ? "var(--ok)" : "var(--faint)"} strong={paid > 0} />
        {resid <= 0.005 ? <Row k="Saldo" v="Saldato ✓" color="var(--ok)" strong /> : <Row k="Da incassare" v={eur(resid)} color="var(--err)" strong />}
        {b.depositPaid && <Row k="Caparra" v="ricevuta ✓" color="var(--ok)" />}
      </div>
      {tax > 0 && (
        <div className="mt-1.5 flex flex-col gap-0.5 border-t border-line pt-1.5">
          <Row k="Tassa di soggiorno (a parte)" v={eur(tax)} title="Non rientra nel totale: si riscuote in struttura" />
          <Row k="" v={b.cityTaxPaid ? "incassata ✓" : "da incassare"} color={b.cityTaxPaid ? "var(--ok)" : "var(--warn)"} />
        </div>
      )}
      {comm > 0 && (
        <div className="mt-1.5 flex flex-col gap-0.5 border-t border-line pt-1.5">
          <Row k={`Commissione OTA (${commissionPctOf(b)}%)`} v={`− ${eur(comm)}`} color="var(--warn)" />
          <Row k="Netto per te" v={eur(nettoOf(b))} color="var(--ok)" strong />
        </div>
      )}
    </div>
  );
}
