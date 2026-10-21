"use client";

// Dettagli della prenotazione accanto alla conversazione OTA (come nella posta di Booking.com): chi è l'ospite, quando arriva, quanto paga, cosa ha chiesto.
// Legge SOLO i dati di Xenora della prenotazione collegata (extId channex:<id>); senza prenotazione è una «Richiesta di informazioni».
import type { ReactNode } from "react";
import ChannelLogo from "@/components/ChannelLogo";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { nights as nightsBetween } from "@/lib/dates";
import { fmtDateWd } from "@/lib/booking-info";
import { bookingCode } from "@/lib/bookingCode";
import { cityTaxOfBooking } from "@/lib/booking";
import { balanceDue, paymentStatus, type PayStatus } from "@/lib/incassi";
import { guestLangOf } from "@/lib/guest-lang";
import { GUEST_LANGS } from "@/lib/guest-i18n";
import { providerChannel, providerLabel, type OtaThread } from "@/lib/channex-threads";
import type { Booking } from "@/lib/types";

const PAY_LABEL: Record<PayStatus, string> = { saldato: "Saldato", acconto: "Acconto versato", "da incassare": "Da incassare" };
const PAY_COLOR: Record<PayStatus, string> = { saldato: "var(--ok)", acconto: "var(--warn)", "da incassare": "var(--dim)" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 py-1.5">
      <dt className="text-xs text-dim">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-txt">{children}</dd>
    </div>
  );
}

export default function OtaThreadDetails({ thread, guestName, onOpenBooking }: { thread: OtaThread; guestName: string; onOpenBooking: (bookingId: string) => void }) {
  const { bookings, guests, units, roomTypes, getStructure } = useData();
  const b: Booking | undefined = thread.bookingId ? bookings.find((x) => x.extId === `channex:${thread.bookingId}`) : undefined;
  const channel = providerChannel(thread.provider);

  // Senza prenotazione collegata: richiesta di informazioni (Airbnb) oppure prenotazione non ancora importata/di un'altra struttura.
  if (!b) {
    return (
      <div className="p-4">
        <h3 className="font-display text-base font-bold text-txt">{guestName}</h3>
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-dim"><ChannelLogo channel={channel} size={18} title={providerLabel(thread.provider)} />{providerLabel(thread.provider)}</p>
        <div className="mt-4 rounded-lg border border-line bg-wash/50 px-3 py-3">
          <p className="text-sm font-semibold text-txt">{thread.bookingId ? "Prenotazione non trovata in Xenora" : "Richiesta di informazioni"}</p>
          <p className="mt-1 text-xs text-dim">{thread.bookingId
            ? "La prenotazione di questa conversazione non è (ancora) nel gestionale, oppure appartiene a una struttura che non stai guardando."
            : "L'ospite ha scritto prima di prenotare: non c'è nessuna prenotazione collegata."}</p>
        </div>
      </div>
    );
  }

  const structure = getStructure(b.structureId);
  const guest = guests.find((g) => g.id === b.guestId);
  // Tutte le camere della stessa prenotazione di gruppo (stesso groupId), annullate e blocchi esclusi.
  const group = b.groupId ? bookings.filter((x) => x.groupId === b.groupId && x.status !== "cancelled" && x.channel !== "blocked") : [b];
  const rows = group.length ? group : [b];
  const roomName = (x: Booking) => {
    const u = x.unitId ? units.find((y) => y.id === x.unitId) : undefined;
    const rt = roomTypes.find((r) => r.id === (u?.roomTypeId ?? x.roomTypeId));
    return [u?.name, rt?.name].filter(Boolean).join(" · ") || "Camera non assegnata";
  };
  const n = Math.max(1, nightsBetween(b.checkIn, b.checkOut));
  const adults = rows.reduce((s, x) => s + Math.max(0, x.adults ?? 0), 0);
  const children = rows.reduce((s, x) => s + Math.max(0, x.children ?? 0), 0);
  const total = rows.reduce((s, x) => s + (x.total ?? 0), 0);
  const tax = rows.reduce((s, x) => s + cityTaxOfBooking(structure, x), 0);
  const taxPaid = rows.every((x) => x.cityTaxPaid || x.cityTaxInPaid);
  const taxExempt = rows.every((x) => x.cityTaxExempt);
  const pay = paymentStatus(b, structure);
  const due = rows.reduce((s, x) => s + balanceDue(x, getStructure(x.structureId)), 0);
  const lang = GUEST_LANGS.find((l) => l.code === guestLangOf(guest ?? undefined));
  const requests = (b.guestRequests || b.otaInfo?.notes || "").trim();
  const cancelled = b.status === "cancelled";

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-bold text-txt">{guestName}</h3>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-dim"><ChannelLogo channel={channel} size={18} title={providerLabel(thread.provider)} />{providerLabel(thread.provider)}</p>
        </div>
        {cancelled && <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: "var(--err)", backgroundColor: "color-mix(in srgb, var(--err) 12%, transparent)" }}>Annullata</span>}
      </div>

      <dl className="mt-3 divide-y divide-line">
        <Row label="Prenotazione"><span className="font-mono text-[13px] select-all">{bookingCode(b)}</span></Row>
        <Row label="Struttura">{structure?.name ?? "—"}</Row>
        <Row label={rows.length > 1 ? "Camere" : "Camera"}>
          <ul className="space-y-0.5">{rows.map((x) => <li key={x.id}>{roomName(x)}</li>)}</ul>
        </Row>
        <Row label="Arrivo">{fmtDateWd(b.checkIn)}</Row>
        <Row label="Partenza">{fmtDateWd(b.checkOut)}</Row>
        <Row label="Notti">{n}</Row>
        <Row label="Ospiti">{adults} {adults === 1 ? "adulto" : "adulti"}{children > 0 && <>, {children} {children === 1 ? "bambino" : "bambini"}</>}</Row>
        <Row label="Lingua">{lang ? <><span aria-hidden>{lang.flag} </span>{lang.label}</> : "—"}</Row>
        <Row label="Prezzo totale">{total > 0 ? <span className="font-semibold">{eur(total)}</span> : <span className="text-dim">Prezzo mancante</span>}</Row>
        <Row label="Pagamento">
          <span className="font-semibold" style={{ color: PAY_COLOR[pay] }}>{PAY_LABEL[pay]}</span>
          {pay !== "saldato" && due > 0 && <span className="text-dim"> · restano {eur(due)}</span>}
        </Row>
        <Row label="Tassa di soggiorno">
          {taxExempt ? "Esente" : tax > 0 ? <>{eur(tax)} <span className="text-dim">· {taxPaid ? "incassata" : "da incassare"}</span></> : <span className="text-dim">Non dovuta</span>}
        </Row>
        {requests && <Row label="Richieste"><span className="whitespace-pre-wrap">{requests}</span></Row>}
      </dl>

      <button type="button" onClick={() => onOpenBooking(b.id)} className="mt-4 w-full rounded-lg border border-line-strong px-3 py-2 text-sm font-semibold text-txt transition hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] max-sm:min-h-11">Apri prenotazione</button>
    </div>
  );
}
