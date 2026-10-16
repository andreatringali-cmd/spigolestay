import type { Booking, Structure } from "@/lib/types";
import { commissionIsEstimate, COMMISSION_ESTIMATE_HINT, bookingPaidTotal, cityTaxOfBooking, commissionBaseOf, commissionOf, commissionShareOf, nettoOf, paymentFeeOf } from "@/lib/booking";
import { eur } from "@/lib/format";
import { effectivePayMethod, PAY_METHOD_LABEL } from "@/lib/pay-method";

// Riepilogo importi compatto di una prenotazione (poche righe, una riga per concetto): come si arriva al totale (solo se oltre al soggiorno
// c'è altro), incassato / da incassare, tassa di soggiorno (riscossa a parte) e commissione OTA con il netto. Il totale in grande sta nella riga.
export default function BookingAmounts({ b, structure }: { b: Booking; structure?: Structure }) {
  const acc = b.total ?? 0;
  if (!acc) return null;
  const clean = b.cleaningFee ?? 0;
  const extras = (b.extras ?? []).filter((e) => e && (e.price || e.name));
  const hasParkingExtra = extras.some((e) => /parcheggi|parking/i.test(e.name || ""));
  const total = bookingPaidTotal(b);
  const paid = b.paid ?? 0;
  const resid = Math.max(0, total - paid);
  const tax = cityTaxOfBooking(structure, b); // camera di un gruppo: quota della tassa del gruppo; altrimenti paganti = adulti + minori sopra soglia, divisore = tutti gli ospiti
  const comm = commissionOf(b);
  const payFee = paymentFeeOf(b);
  const pm = effectivePayMethod(b).method;
  const pmTxt = pm ? ` · ${PAY_METHOD_LABEL[pm].toLowerCase()}` : "";
  const parts: string[] = [];
  if (clean > 0 || extras.length > 0 || (b.parking && !hasParkingExtra)) {
    parts.push(`Soggiorno ${eur(acc)}`);
    if (clean > 0) parts.push(`Pulizia ${eur(clean)}`);
    for (const e of extras) parts.push(`${e.name || "Extra"}${e.qty && e.qty > 1 && !/×\s?\d+$/u.test(e.name || "") ? ` ×${e.qty}` : ""} ${eur(e.price || 0)}`);
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
        ? <Row k={`Incassato${pmTxt}`} v={`${eur(paid)} · saldato ✓`} color="var(--ok)" strong />
        : paid > 0
          ? <Row k={`Incassato${pmTxt}`} v={`${eur(paid)} · mancano ${eur(resid)}`} color="var(--err)" strong />
          : <Row k={`Da incassare${pmTxt}`} v={eur(resid)} color="var(--err)" strong />}
      {b.depositPaid && resid > 0.005 && <Row k="Caparra" v="ricevuta ✓" color="var(--ok)" />}
      {tax > 0 && <Row k="Tassa (a parte)" v={`${eur(tax)} · ${b.cityTaxPaid ? "incassata ✓" : "da incassare"}`} color={b.cityTaxPaid ? "var(--ok)" : "var(--warn)"} title="Non rientra nel totale: si riscuote in struttura" />}
      {comm > 0 && <Row k={`Comm. ${commissionShareOf(b)}%${commissionIsEstimate(b) ? " · stima" : ""}`} v={`− ${eur(comm)}${commissionIsEstimate(b) ? " (stima)" : ""} · netto ${eur(nettoOf(b))}`} color="var(--dim)" title={commissionIsEstimate(b) ? COMMISSION_ESTIMATE_HINT : payFee > 0 ? `Commissione ${eur(commissionBaseOf(b))} + costo d'incasso ${eur(payFee)} (Payment charge), e quanto resta a te` : "Commissione dell'OTA e quanto resta a te"} />}
    </div>
  );
}
