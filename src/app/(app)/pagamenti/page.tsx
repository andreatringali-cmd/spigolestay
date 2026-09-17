"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import { parseISO, toISO } from "@/lib/dates";
import { bookingGrandTotal } from "@/lib/booking";
import { amountPaid, paymentStatus } from "@/lib/incassi";
import { eur } from "@/lib/format";
import { exportExcel, exportPdf } from "@/lib/export";
import { PageHeader, Card } from "@/components/ui";
import SearchInput from "@/components/SearchInput";
import EmptyState from "@/components/EmptyState";
import ExportMenu from "@/components/ExportMenu";
import { useLang } from "@/lib/i18n";

const fmt = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });

// Totale a carico dell'ospite: logica unica in @/lib/booking (soggiorno + pulizia + extra + tassa).

const STATUS: Record<string, { label: string; color: string }> = {
  saldato: { label: "Saldato", color: "var(--ok)" },
  acconto: { label: "Acconto", color: "var(--warn)" },
  "da incassare": { label: "Da incassare", color: "var(--err)" },
};

export default function PagamentiPage() {
  const { t } = useLang();
  const { bookings, guests, getStructure, getUnit, updateBooking, openBooking, activeStructureId } = useData();
  const todayISO = toISO(new Date());
  const guestName = (id: string) => guests.find((g) => g.id === id)?.fullName ?? "Ospite";

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"due" | "overdue" | "all">("due");

  const scoped = bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && (activeStructureId === "all" || b.structureId === activeStructureId));
  const enrich = scoped.map((b) => {
    const structure = getStructure(b.structureId);
    const due = bookingGrandTotal(b, structure);
    const paid = Math.min(amountPaid(b), due);
    const balance = Math.max(0, due - paid);
    const overdue = balance > 0 && b.checkOut < todayISO;
    const status = paymentStatus(b, structure);
    return { b, due, paid, balance, overdue, status };
  });

  const term = q.trim().toLowerCase();
  const rows = enrich
    .filter((r) => (filter === "due" ? r.balance > 0 : filter === "overdue" ? r.overdue : true))
    .filter((r) => !term || guestName(r.b.guestId).toLowerCase().includes(term) || r.b.id.toLowerCase().includes(term))
    .sort((a, b) => (a.overdue !== b.overdue ? (a.overdue ? -1 : 1) : a.b.checkIn.localeCompare(b.b.checkIn)));

  const sumDue = enrich.reduce((a, r) => a + r.due, 0);
  const sumPaid = enrich.reduce((a, r) => a + r.paid, 0);
  const sumBalance = Math.max(0, sumDue - sumPaid);
  const sumOverdue = enrich.filter((r) => r.overdue).reduce((a, r) => a + r.balance, 0);
  const pct = sumDue > 0 ? Math.round((sumPaid / sumDue) * 100) : 100;

  const doExcel = () => exportExcel("pagamenti", [t("Ospite"), t("Struttura"), t("Camera"), t("Check-in"), t("Totale"), t("Incassato"), t("Saldo"), t("Stato")], rows.map((r) => [guestName(r.b.guestId), getStructure(r.b.structureId)?.name ?? "", getUnit(r.b.unitId)?.name ?? t("Da assegnare"), r.b.checkIn, r.due, r.paid, r.balance, r.overdue ? t("Scaduto") : t(STATUS[r.status].label)]));

  return (
    <div>
      <PageHeader title={t("Incassi")} subtitle={t("Incassato, acconti e saldi in sospeso · sessione separata dagli statistici")} actions={<ExportMenu onExcel={doExcel} onPdf={exportPdf} />} />

      {/* KPI */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("Totale atteso")} value={eur(sumDue)} color="var(--txt)" />
        <Card className="!p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-dim">{t("Incassato")}</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums" style={{ color: "var(--ok)" }}>{eur(sumPaid)}</div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: "var(--ok)" }} /></div>
          <div className="mt-0.5 text-[11px] text-faint">{pct}% {t("del totale")}</div>
        </Card>
        <Kpi label={t("In sospeso")} value={eur(sumBalance)} color="var(--warn)" />
        <button onClick={() => setFilter("overdue")} className="anim-in rounded-xl border p-4 text-left shadow-sm transition hover:shadow-md" style={{ borderColor: sumOverdue > 0 ? "var(--err)" : "var(--line)" }}>
          <div className="text-xs font-medium uppercase tracking-wide text-dim">{t("Scaduti")}</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums" style={{ color: sumOverdue > 0 ? "var(--err)" : "var(--txt)" }}>{eur(sumOverdue)}</div>
          <div className="mt-0.5 text-[11px] text-faint">{t("saldo non incassato, ospite già partito")}</div>
        </button>
      </div>

      {/* Stessa griglia dei KPI sopra: ricerca larga quanto una card e allineata. */}
      <div className="mb-4 grid grid-cols-2 items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm lg:grid-cols-4">
        <SearchInput value={q} onChange={setQ} placeholder={t("Cerca ospite o codice…")} className="col-span-2 w-full lg:col-span-1" />
        <div className="col-span-2 flex flex-wrap items-center gap-2 lg:col-span-3">
          <div className="flex items-center rounded-lg border border-line p-0.5">
            {([["due", "Con saldo"], ["overdue", "Scaduti"], ["all", "Tutti"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${filter === k ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{t(l)}</button>
            ))}
          </div>
          <span className="ml-auto text-xs text-faint">{rows.length} {t("prenotazioni")}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
              <th className="px-3 py-2 font-semibold">{t("Ospite")}</th>
              <th className="px-3 py-2 font-semibold">{t("Camera")}</th>
              <th className="px-3 py-2 font-semibold">{t("Check-in")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("Totale")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("Incassato")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("Saldo")}</th>
              <th className="px-3 py-2 font-semibold">{t("Stato")}</th>
              <th className="px-3 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ b, due, paid, balance, overdue, status }) => (
              <tr key={b.id} className="border-b border-line last:border-0 hover:bg-wash/50">
                <td className="px-3 py-2 font-medium text-txt"><button onClick={() => openBooking(b.id)} className="hover:text-focus hover:underline">{guestName(b.guestId)}</button></td>
                <td className="px-3 py-2 text-dim">{getStructure(b.structureId)?.name} · {getUnit(b.unitId)?.name ?? t("Da assegnare")}</td>
                <td className={`px-3 py-2 font-mono text-xs ${b.checkIn < todayISO ? "text-faint" : "text-dim"}`}>{fmt(b.checkIn)}</td>
                <td className="px-3 py-2 text-right font-mono text-dim">{eur(due)}</td>
                <td className="px-3 py-2 text-right">
                  <input type="number" min={0} max={due} value={Math.round(paid)} onChange={(e) => updateBooking(b.id, { paid: Math.max(0, Math.min(due, Number(e.target.value))) })} className="w-24 rounded-md border border-line bg-paper px-2 py-1 text-right font-mono text-sm text-txt outline-none focus:border-focus" />
                </td>
                <td className={`px-3 py-2 text-right font-mono font-semibold ${balance > 0 ? "text-[color:var(--err)]" : "text-[color:var(--ok)]"}`}>{eur(balance)}</td>
                <td className="px-3 py-2">
                  {overdue ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--err) 16%, transparent)", color: "var(--err)" }}>{t("Scaduto")}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: STATUS[status].color }}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS[status].color }} />{t(STATUS[status].label)}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {balance > 0 && <button onClick={() => updateBooking(b.id, { paid: due })} className="rounded-md bg-focus px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90">{t("Salda")}</button>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8}><EmptyState title={t("Nessun pagamento con questi filtri.")} /></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-faint">{t("Modifica l'importo incassato direttamente in tabella o usa «Salda» per registrare il pagamento completo. Gli incassi si riflettono nella scheda prenotazione e nella Cassa.")}</p>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="anim-in rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-dim">{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}
