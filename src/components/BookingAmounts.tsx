import type { Booking, Structure } from "@/lib/types";
import { bookingPaidTotal, cityTaxOf, cityTaxPayers, commissionOf, commissionPctOf, nettoOf } from "@/lib/booking";
import { nights } from "@/lib/dates";
import { eur } from "@/lib/format";

// Riepilogo importi compatto di una prenotazione (poche righe, una riga per concetto): come si arriva al totale (solo se oltre al soggiorno
// c'è altro), incassato / da incassare, tassa di soggiorno (riscossa a parte) e commissione OTA con il netto. Il totale in grande sta nella riga.
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
  const parts: string[] = [];
  if (clean > 0 || extras.length > 0 || (b.parking && !hasParkingExtra)) {
    parts.push(`Soggiorno ${eur(acc)}`);
    if (clean > 0) parts.push(`Pulizia ${eur(clean)}`);
    for (const e of extras) parts.push(`${e.name || "Extra"}${e.qty && e.qty > 1 ? ` ×${e.qty}` : ""} ${eur(e.price || 0)}`);
    if (b.parking && !hasParkingExtra) parts.push("Parcheggio incluso");
  }
  const Row = ({ k, v, color, strong, title }: { k: string; v: string; color?: string; strong?: boolean; title?: string }) => (
    <div className="flex items-baseline justify-between gap-2 whitespace-nowrap" title={title}>
      <span className={`min-w-0 truncate ${strong ? "font-semibold text-txt" : "text-faint"}`}>{k}</span>
      <span className={`shrink-0 font-mono tabular-nums ${strong ? "font-semibold" : ""}`} style={{ color: color ?? "var(--dim)" }}>{v}</span>
    </div>
  );
  return (
    <div className="flex w-full flex-col gap-0.5 text-[11px] leading-tight">
      {parts.length > 0 && <div className="text-faint" title="Come si arriva al totale">{parts.join(" + ")}</div>}
      {resid <= 0.005
        ? <Row k="Incassato" v={`${eur(paid)} · saldato ✓`} color="var(--ok)" strong />
        : paid > 0
          ? <Row k="Incassato" v={`${eur(paid)} · mancano ${eur(resid)}`} color="var(--err)" strong />
          : <Row k="Da incassare" v={eur(resid)} color="var(--err)" strong />}
      {b.depositPaid && resid > 0.005 && <Row k="Caparra" v="ricevuta ✓" color="var(--ok)" />}
      {tax > 0 && <Row k="Tassa (a parte)" v={`${eur(tax)} · ${b.cityTaxPaid ? "incassata ✓" : "da incassare"}`} color={b.cityTaxPaid ? "var(--ok)" : "var(--warn)"} title="Non rientra nel totale: si riscuote in struttura" />}
      {comm > 0 && <Row k={`Comm. ${commissionPctOf(b)}%`} v={`− ${eur(comm)} · netto ${eur(nettoOf(b))}`} color="var(--dim)" title="Commissione dell'OTA e quanto resta a te" />}
    </div>
  );
}
