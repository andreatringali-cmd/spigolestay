"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import { toISO, fmtDate } from "@/lib/dates";
import { amountPaid, paymentStatus, totalDue } from "@/lib/incassi";
import { bookingTotals, TOTAL_WITH_TAX_LABEL } from "@/lib/booking-totals";
import { eur } from "@/lib/format";
import { NUM_TYPING_RE, formatDecimalIT, parseDecimalIT, roundDecimals } from "@/lib/num-it";
import { exportExcel, exportPdf } from "@/lib/export";
import { PageHeader, Card, Button } from "@/components/ui";
import SearchInput from "@/components/SearchInput";
import EmptyState from "@/components/EmptyState";
import ExportMenu from "@/components/ExportMenu";
import { useLang } from "@/lib/i18n";

const fmt = (iso: string) => fmtDate(iso);

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
    const due = totalDue(b, structure);
    const paid = Math.min(amountPaid(b), due);
    const balance = Math.max(0, due - paid);
    const overdue = balance > 0 && b.checkOut < todayISO;
    const status = paymentStatus(b, structure);
    const tot = bookingTotals(b, structure); // soggiorno / tassa / totale con tassa: regola unica (lib/booking-totals.ts)
    return { b, due, paid, balance, overdue, status, tot };
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

  const doExcel = () => exportExcel("pagamenti", [t("Ospite"), t("Struttura"), t("Camera"), t("Check-in"), t(TOTAL_WITH_TAX_LABEL), t("Incassato"), t("Saldo"), t("Stato")], rows.map((r) => [guestName(r.b.guestId), getStructure(r.b.structureId)?.name ?? "", getUnit(r.b.unitId)?.name ?? t("Da assegnare"), r.b.checkIn, r.due, r.paid, r.balance, r.overdue ? t("Scaduto") : t(STATUS[r.status].label)]));

  return (
    <div>
      <PageHeader title={t("Incassi")} subtitle={t("Incassato, acconti e saldi in sospeso · sessione separata dagli statistici")} actions={<span className="max-sm:hidden"><ExportMenu onExcel={doExcel} onPdf={exportPdf} /></span>} />

      {/* KPI */}
      <div className="mb-5 grid grid-cols-2 gap-3 max-sm:mb-3 max-sm:gap-2 lg:grid-cols-4">
        <Kpi label={t("Totale atteso (con tassa)")} value={eur(sumDue)} color="var(--txt)" />
        <Card className="!p-4 max-sm:!p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-dim">{t("Incassato")}</div>
          <div className="mt-1 font-mono text-base min-[400px]:text-xl sm:text-2xl font-bold tabular-nums" style={{ color: "var(--ok)" }}>{eur(sumPaid)}</div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: "var(--ok)" }} /></div>
          <div className="mt-0.5 text-[11px] text-faint">{pct}% {t("del totale")}</div>
        </Card>
        <Kpi label={t("In sospeso")} value={eur(sumBalance)} color="var(--warn)" />
        <button onClick={() => setFilter("overdue")} className="anim-in rounded-xl border p-4 text-left shadow-sm transition hover:shadow-md max-sm:p-3" style={{ borderColor: sumOverdue > 0 ? "var(--err)" : "var(--line)" }}>
          <div className="text-xs font-medium uppercase tracking-wide text-dim">{t("Scaduti")}</div>
          <div className="mt-1 font-mono text-base min-[400px]:text-xl sm:text-2xl font-bold tabular-nums" style={{ color: sumOverdue > 0 ? "var(--err)" : "var(--txt)" }}>{eur(sumOverdue)}</div>
          <div className="mt-0.5 text-[11px] text-faint">{t("saldo non incassato, ospite già partito")}</div>
        </button>
      </div>

      {/* Stessa griglia dei KPI sopra: ricerca larga quanto una card e allineata. */}
      <div className="mb-4 grid grid-cols-2 items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm max-sm:mb-3 max-sm:flex max-sm:flex-wrap max-sm:gap-2 lg:grid-cols-4">
        <SearchInput value={q} onChange={setQ} placeholder={t("Cerca ospite o codice…")} className="col-span-2 w-full max-sm:w-[calc(100%-3.5rem)] lg:col-span-1" />
        <div className="shrink-0 sm:hidden"><ExportMenu onExcel={doExcel} onPdf={exportPdf} /></div>
        <div className="col-span-2 flex flex-wrap items-center gap-2 max-sm:w-full max-sm:flex-nowrap lg:col-span-3">
          <div className="flex shrink-0 items-center rounded-lg border border-line p-0.5">
            {([["due", "Con saldo"], ["overdue", "Scaduti"], ["all", "Tutti"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`rounded-md px-3 py-1.5 max-sm:px-2.5 max-sm:py-2.5 text-xs font-medium ${filter === k ? "bg-focus text-on-focus" : "text-dim hover:text-txt"}`}>{t(l)}</button>
            ))}
          </div>
          <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-faint">{rows.length} {t("prenotazioni")}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm max-md:hidden">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-dim">
              <th className="px-3 py-2 font-semibold">{t("Ospite")}</th>
              <th className="px-3 py-2 font-semibold">{t("Camera")}</th>
              <th className="px-3 py-2 font-semibold">{t("Check-in")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t(TOTAL_WITH_TAX_LABEL)}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("Incassato")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("Saldo")}</th>
              <th className="px-3 py-2 font-semibold">{t("Stato")}</th>
              <th className="px-3 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ b, due, paid, balance, overdue, status, tot }) => (
              <tr key={b.id} className="border-b border-line last:border-0 hover:bg-wash/50">
                <td className="px-3 py-2 font-medium text-txt"><button onClick={() => openBooking(b.id)} className="hover:text-focus hover:underline">{guestName(b.guestId)}</button></td>
                <td className="px-3 py-2 text-dim">{getStructure(b.structureId)?.name} · {getUnit(b.unitId)?.name ?? t("Da assegnare")}</td>
                <td className={`px-3 py-2 font-mono text-xs ${b.checkIn < todayISO ? "text-faint" : "text-dim"}`}>{fmt(b.checkIn)}</td>
                <td className="px-3 py-2 text-right font-mono text-dim">{eur(due)}{tot.tax > 0 && <div className="font-sans text-[10px] text-faint">{Math.abs(tot.withTax - due) < 0.005 ? `${t("soggiorno")} ${eur(tot.stay)} + ${t("tassa")} ${eur(tot.tax)}` : `${t("tassa")} ${eur(tot.tax)} ${t("già incassata a parte")}`}</div>}</td>
                <td className="px-3 py-2 text-right">
                  <PaidCell key={`${b.id}-${paid}`} paid={paid} due={due} onCommit={(v) => updateBooking(b.id, { paid: v })} />
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
                  {balance > 0 && <Button size="xs" onClick={() => updateBooking(b.id, { paid: due })}>{t("Salda")}</Button>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8}><EmptyState title={t("Nessun pagamento con questi filtri.")} /></td></tr>}
          </tbody>
        </table>
      </div>
      {/* Telefono: una scheda per prenotazione (la tabella sopra serve da tablet in su) */}
      <div className="flex flex-col gap-2 md:hidden">
        {rows.map(({ b, due, paid, balance, overdue, status, tot }) => (
          <div key={b.id} className="rounded-xl border border-line bg-surface p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <button onClick={() => openBooking(b.id)} className="block max-w-full truncate py-1 text-left font-semibold text-txt hover:text-focus">{guestName(b.guestId)}</button>
                <div className="truncate text-xs text-dim">{getStructure(b.structureId)?.name} · {getUnit(b.unitId)?.name ?? t("Da assegnare")} · <span className={"font-mono " + (b.checkIn < todayISO ? "text-faint" : "")}>{fmt(b.checkIn)}</span></div>
              </div>
              {overdue ? (
                <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--err) 16%, transparent)", color: "var(--err)" }}>{t("Scaduto")}</span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium" style={{ color: STATUS[status].color }}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS[status].color }} />{t(STATUS[status].label)}</span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div><div className="text-[11px] uppercase tracking-wide text-dim">{t(TOTAL_WITH_TAX_LABEL)}</div><div className="font-mono text-dim">{eur(due)}</div>{tot.tax > 0 && <div className="text-[10px] text-faint">{Math.abs(tot.withTax - due) < 0.005 ? `${t("soggiorno")} ${eur(tot.stay)} + ${t("tassa")} ${eur(tot.tax)}` : `${t("tassa")} ${eur(tot.tax)} ${t("già incassata a parte")}`}</div>}</div>
              <div><div className="text-[11px] uppercase tracking-wide text-dim">{t("Saldo")}</div><div className={`font-mono font-semibold ${balance > 0 ? "text-[color:var(--err)]" : "text-[color:var(--ok)]"}`}>{eur(balance)}</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-dim">{t("Incassato")}</div><PaidCell key={`m-${b.id}-${paid}`} paid={paid} due={due} onCommit={(v) => updateBooking(b.id, { paid: v })} className="mt-0.5 w-full" /></div>
            </div>
            {balance > 0 && <Button size="md" onClick={() => updateBooking(b.id, { paid: due })} className="mt-2 w-full">{t("Salda")}</Button>}
          </div>
        ))}
        {rows.length === 0 && <div className="rounded-xl border border-line bg-surface"><EmptyState title={t("Nessun pagamento con questi filtri.")} /></div>}
      </div>
      <p className="mt-3 text-xs text-faint">{t("Modifica l'importo incassato direttamente in tabella o usa «Salda» per registrare il pagamento completo. Gli incassi si riflettono nella scheda prenotazione e nella Cassa.")}</p>
    </div>
  );
}

// Importo incassato: tiene il testo digitato (virgola, centesimi) e salva UNA volta sola, all'uscita dal campo o con Invio.
// Salvare a ogni tasto scriveva valori parziali (4, 45, 450), rifaceva il sync e mandava email «Pagamento ricevuto» intermedie.
function PaidCell({ paid, due, onCommit, className = "w-24" }: { paid: number; due: number; onCommit: (v: number) => void; className?: string }) {
  const [draft, setDraft] = useState(() => formatDecimalIT(paid, 2));
  const commit = () => {
    const n = parseDecimalIT(draft);
    if (n === null) { setDraft(formatDecimalIT(paid, 2)); return; }
    const v = Math.max(0, Math.min(due, roundDecimals(n, 2)));
    setDraft(formatDecimalIT(v, 2));
    if (v !== roundDecimals(paid, 2)) onCommit(v);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={draft}
      onFocus={(e) => e.target.select()}
      onChange={(e) => { if (NUM_TYPING_RE.test(e.target.value)) setDraft(e.target.value); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className={className + " rounded-md border border-line bg-paper px-2 py-1 max-md:py-2 text-right font-mono text-sm text-txt outline-none focus:border-focus"}
    />
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="anim-in rounded-xl border border-line bg-surface p-4 shadow-sm max-sm:p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-dim">{label}</div>
      <div className="mt-1 font-mono text-base min-[400px]:text-xl sm:text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}
