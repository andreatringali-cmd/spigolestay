"use client";

// Tab "Registro": storico delle offerte (in attesa / accettata / rifiutata / scaduta), tasso di
// conversione, ricavo e rendimento per singolo extra. Tutto calcolato dai dati reali delle prenotazioni.

import { useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import type { Booking, Structure, UpsellOffer } from "@/lib/types";
import {
  offerAcceptedViaLink, offerOutcome, offerRevenue, patchAccept, patchDeleteOffer, patchSetStatus, type OfferOutcome, type UpsellStats,
} from "@/lib/upselling";
import EmptyState from "@/components/EmptyState";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";

const VIA: Record<UpsellOffer["via"], string> = { whatsapp: "WhatsApp", email: "Email", copy: "Testo copiato", diretto: "Vendita diretta" };
const OUT: Record<OfferOutcome, { label: string; color: string }> = {
  pending: { label: "In attesa", color: "var(--focus)" },
  accepted: { label: "Accettata", color: "var(--ok)" },
  declined: { label: "Rifiutata", color: "var(--err)" },
  expired: { label: "Scaduta", color: "var(--faint, #8a8f98)" },
  removed: { label: "Extra rimossi", color: "var(--faint, #8a8f98)" },
};
type Filter = "all" | OfferOutcome;
const fdt = (ms: number) => new Date(ms).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" });

interface Row { offer: UpsellOffer; booking: Booking; outcome: OfferOutcome; structure?: Structure }

export default function RegistryTab({ bookings, stats, today, structures, multiStructure }: { bookings: Booking[]; stats: UpsellStats; today: string; structures: Structure[]; multiStructure: boolean }) {
  const { guests, updateBooking, openBooking, addActivity } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<Filter>("all");

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const b of bookings) {
      if (b.channel === "blocked") continue;
      for (const o of b.upsellOffers ?? []) out.push({ offer: o, booking: b, outcome: offerOutcome(o, b, today), structure: structures.find((s) => s.id === b.structureId) });
    }
    return out.sort((a, c) => c.offer.at - a.offer.at);
  }, [bookings, today, structures]);
  const counts = useMemo(() => { const c: Record<string, number> = { all: rows.length }; for (const r of rows) c[r.outcome] = (c[r.outcome] ?? 0) + 1; return c; }, [rows]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.outcome === filter);
  const guestName = (b: Booking) => guests.find((g) => g.id === b.guestId)?.fullName || "Ospite";

  const accept = (r: Row) => {
    updateBooking(r.booking.id, patchAccept(r.booking, r.offer, r.structure?.extras ?? []));
    addActivity("message", `Offerta extra accettata — ${guestName(r.booking)}: ${r.offer.items.map((i) => i.name).join(", ")} (${eur(r.offer.total)})`, r.booking.structureId);
    toast(`Extra aggiunti alla prenotazione: +${eur(r.offer.total)} sul totale ospite.`, "success");
  };
  const decline = (r: Row) => updateBooking(r.booking.id, patchSetStatus(r.booking, r.offer.id, "declined"));
  const reopen = (r: Row) => updateBooking(r.booking.id, patchSetStatus(r.booking, r.offer.id, "sent"));
  const del = async (r: Row) => { if (await confirm({ title: "Eliminare l'offerta?", message: "Viene tolta dal registro (gli extra già aggiunti alla prenotazione restano).", confirmLabel: "Elimina", danger: true })) updateBooking(r.booking.id, patchDeleteOffer(r.booking, r.offer.id)); };

  const nameWithStruct = (s: { name: string; structureId: string }) => multiStructure ? `${s.name} · ${structures.find((x) => x.id === s.structureId)?.name ?? ""}` : s.name;
  const attach = stats.bookings ? Math.round((stats.withExtra / stats.bookings) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ["Offerte inviate", String(stats.offers), `${stats.pending} in attesa · ${stats.direct} vendite dirette`],
          ["Accettate / rifiutate", `${stats.accepted} / ${stats.declined + stats.expired}`, stats.expired ? `di cui ${stats.expired} scadute senza risposta` : "scadute incluse tra le rifiutate"],
          ["Tasso di conversione", stats.conversion === null ? "—" : `${Math.round(stats.conversion * 100)}%`, stats.conversion === null ? "serve almeno un'offerta decisa" : `su ${stats.accepted + stats.declined + stats.expired} decise`],
          ["Ricavo da offerte", eur(stats.acceptedRevenue), stats.pendingValue ? `+${eur(stats.pendingValue)} ancora in attesa` : "extra accettati ancora in prenotazione"],
        ] as [string, string, string][]).map(([l, v, h]) => (
          <div key={l} className="flex min-h-[92px] flex-col justify-center rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{l}</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-txt">{v}</div>
            <div className="mt-0.5 text-[11px] text-faint">{h}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 text-sm text-dim shadow-sm">
        <span className="font-semibold text-txt">Extra di catalogo venduti: {eur(stats.soldRevenue)}</span> in {stats.withExtra} prenotazioni su {stats.bookings} ({attach}% con almeno un extra)
        {stats.paidShare > 0 && <> · <b className="font-mono text-txt">{eur(stats.paidShare)}</b> su prenotazioni già saldate</>}
        {stats.otherRevenue > 0 && <> · altri extra/consumi liberi: <b className="font-mono text-txt">{eur(stats.otherRevenue)}</b></>}.
        <div className="mt-0.5 text-[11px] text-faint">Comprende gli extra scelti dall&apos;ospite nel check-in online e quelli aggiunti a mano, non solo le offerte inviate da qui. Il saldo del singolo extra non è tracciato: l&apos;incasso è sulla prenotazione.</div>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="mr-auto text-xs font-semibold uppercase tracking-wide text-faint">Registro offerte ({rows.length})</div>
          {([["all", "Tutte"], ["pending", "In attesa"], ["accepted", "Accettate"], ["declined", "Rifiutate"], ["expired", "Scadute"]] as [Filter, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-full border px-2.5 py-1 text-xs transition ${filter === k ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] font-medium text-focus" : "border-line text-dim hover:bg-wash"}`}>{l}{counts[k] ? ` (${counts[k]})` : ""}</button>
          ))}
        </div>
        {rows.length === 0 ? (
          <EmptyState title="Nessuna offerta ancora inviata" sub="Quando proponi degli extra a un ospite (WhatsApp, email o testo copiato) l'offerta compare qui e potrai segnarla come accettata o rifiutata: il tasso di conversione si calcola da solo." />
        ) : shown.length === 0 ? (
          <div className="py-8 text-center text-sm text-faint">Nessuna offerta in questo stato.</div>
        ) : (
          <div className="space-y-2">
            {shown.map((r) => {
              const o = r.offer; const out = OUT[r.outcome]; const cancelled = r.booking.status === "cancelled";
              const viaLink = offerAcceptedViaLink(o, r.booking, today);
              return (
                <div key={o.id} className={`rounded-lg border border-line bg-paper p-2.5 ${cancelled ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button onClick={() => openBooking(r.booking.id)} className="truncate text-sm font-semibold text-txt hover:underline">{guestName(r.booking)}</button>
                        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${out.color} 16%, transparent)`, color: out.color }}>{out.label}{viaLink ? " · dal link di check-in" : ""}</span>
                        {cancelled && <span className="rounded-full bg-wash px-1.5 py-0.5 text-[10px] font-semibold text-faint">prenotazione annullata</span>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-faint">{fdt(o.at)} · {VIA[o.via]}{multiStructure && r.structure ? ` · ${r.structure.name}` : ""} · soggiorno {r.booking.checkIn.slice(8)}/{r.booking.checkIn.slice(5, 7)}</div>
                      <div className="mt-0.5 text-xs text-dim">{o.items.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join(", ")}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold text-txt">{eur(r.outcome === "accepted" ? offerRevenue(o, r.booking) : o.total)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.outcome === "pending" && !cancelled && <>
                        <button onClick={() => accept(r)} className="rounded bg-[color:var(--ok)] px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90">Accettata: aggiungi alla prenotazione</button>
                        <button onClick={() => decline(r)} className="rounded border border-line px-2 py-1 text-[11px] font-medium text-dim hover:bg-wash">Rifiutata</button>
                      </>}
                      {(r.outcome === "declined" || r.outcome === "expired") && o.status !== "sent" && <button onClick={() => reopen(r)} className="rounded border border-line px-2 py-1 text-[11px] font-medium text-dim hover:bg-wash">Riapri</button>}
                      {r.outcome === "expired" && !cancelled && <button onClick={() => accept(r)} className="rounded border border-line px-2 py-1 text-[11px] font-medium text-dim hover:bg-wash">Segna accettata</button>}
                      {((o.status === "sent" && r.outcome !== "accepted") || r.outcome === "removed") &&<button onClick={() => del(r)} className="text-[11px] text-faint hover:text-[color:var(--err)]">Elimina</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {stats.perExtra.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm sm:p-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Rendimento per extra</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="text-[10px] uppercase tracking-wide text-faint"><th className="py-1 pr-3 font-semibold">Extra</th><th className="px-2 text-right font-semibold">Proposto</th><th className="px-2 text-right font-semibold">Accettato</th><th className="px-2 text-right font-semibold">Conversione</th><th className="px-2 text-right font-semibold">Venduti</th><th className="pl-2 text-right font-semibold">Ricavo</th></tr></thead>
              <tbody>
                {stats.perExtra.map((x) => {
                  const dec = x.accepted + x.declined;
                  return (
                    <tr key={x.key} className="border-t border-line">
                      <td className="py-1.5 pr-3 font-medium text-txt">{nameWithStruct(x)}</td>
                      <td className="px-2 text-right font-mono text-dim">{x.offered}</td>
                      <td className="px-2 text-right font-mono text-dim">{x.accepted}</td>
                      <td className="px-2 text-right font-mono text-dim">{dec ? `${Math.round((x.accepted / dec) * 100)}%` : "—"}</td>
                      <td className="px-2 text-right font-mono text-dim">{x.soldQty}</td>
                      <td className="pl-2 text-right font-mono font-semibold text-txt">{eur(x.soldRevenue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
