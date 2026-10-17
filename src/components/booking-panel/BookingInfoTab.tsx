"use client";

// Scheda "Informazioni" del pannello prenotazione: stesso impianto della pagina prenotazione di Channex
// (sezioni con righe etichetta/valore) con i dati REALI della prenotazione. SOLA LETTURA: le azioni stanno in "Gestione".
// Calcoli economici SOLO dalle funzioni dell'app (lib/booking.ts); formattazione/liste in lib/booking-info.ts (pura, testata).

import { useEffect, useState, type ReactNode } from "react";
import { apiPost } from "@/lib/invoicing/client";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { CHANNELS, type Booking, type BookingStatus, type Guest } from "@/lib/types";
import { bookingCode } from "@/lib/bookingCode";
import { directOriginLabel, directOriginOf } from "@/lib/direct-origin";
import { effectivePayMethod, otaPayDetail, PAY_METHOD_LABEL } from "@/lib/pay-method";
import { isRelayEmail } from "@/lib/contacts-check";
import { eur } from "@/lib/format";
import { fmtDate, nights } from "@/lib/dates";
import { lordoOf, nightlyRevenue } from "@/lib/booking";
import {
  cancelPenaltyLines, channelDisplay, channexCodeOf, channexIdOf, countryName, detectGenius, directCancelText, fmtDateWd, groupRooms,
  guestNames, languageName, notesBlocks, nightRows, occupancyLabel, safeMailtoHref, safeTelHref,
} from "@/lib/booking-info";

const STATUS: Record<BookingStatus, { label: string; color: string }> = {
  confirmed: { label: "Confermata", color: "var(--ok)" },
  tentative: { label: "Opzione", color: "var(--warn)" },
  cancelled: { label: "Cancellata", color: "var(--err)" },
  no_show: { label: "No-show", color: "var(--faint)" },
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const money = (n: number, cur?: string) => eur(n, !cur || cur.toUpperCase() === "EUR" ? "€" : cur.toUpperCase());

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-line px-5 py-4">
      <div className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-faint">{title}</div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

// Riga etichetta/valore: su telefono etichetta sopra e valore sotto, da tablet in su due colonne (etichetta ~11rem).
function Line({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <div className="text-sm text-dim sm:w-44 sm:shrink-0">{label}</div>
      <div className={`min-w-0 flex-1 break-words text-sm text-txt ${mono ? "font-mono tabular-nums" : ""}`}>{children}</div>
    </div>
  );
}

function Pill({ color, children, title }: { color: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-block rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
      {children}
    </span>
  );
}

function CopyBtn({ text }: { text: string }) {
  const { t } = useLang();
  const [done, setDone] = useState(false);
  const go = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* appunti non disponibili */ }
  };
  return (
    <button type="button" onClick={go} aria-label={t("Copia")} className="ml-2 rounded border border-line px-1.5 py-0.5 align-middle text-[10px] font-semibold text-dim hover:bg-wash hover:text-txt">
      {done ? t("Copiato") : t("Copia")}
    </button>
  );
}

const nightsTxt = (n: number, t: (s: string) => string) => `${n} ${n === 1 ? t("notte") : t("notti")}`;
const SubTitle = ({ children }: { children: ReactNode }) => <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{children}</div>;

export default function BookingInfoTab({ booking }: { booking: Booking }) {
  const { bookings, getGuest, getUnit, getRoomType, getStructure, updateGuest, patchBookingsSilently } = useData();
  const { t } = useLang();

  const structure = getStructure(booking.structureId);
  const guest = getGuest(booking.guestId);
  // Città, CAP e indirizzo arrivano con la revisione Channex ma le prenotazioni già importate non li hanno: alla prima apertura si legge la revisione
  // più recente (1 chiamata) e si completano SOLO i campi vuoti dell'ospite; poi non si richiede per 7 giorni (promemoria solo su questo dispositivo).
  const chxId = booking.extId?.startsWith("channex:") ? booking.extId.slice(8) : "";
  const needCustomer = !!chxId && !!guest && !guest.city && !guest.zip && !guest.address;
  const [fetched, setFetched] = useState<{ forId: string; revisionId?: string; ruid?: string; policiesText?: string; deposits?: string } | null>(null);
  const fx = fetched && fetched.forId === booking.id ? fetched : null;
  useEffect(() => {
    if (!chxId) return;
    let alive = true;
    apiPost<{ ok?: boolean; revisions?: { kind?: string; at?: string | null; revisionId?: string; ruid?: string; policiesText?: string; deposits?: string; customer?: { city?: string; address?: string; zip?: string } }[] }>("channex/revisions", { bookingId: booking.id, channexBookingId: chxId, latest: true })
      .then((r) => {
        if (!alive) return;
        const rev0 = r.revisions?.[0];
        if (!rev0) return;
        setFetched({ forId: booking.id, revisionId: rev0.revisionId, ruid: rev0.ruid, policiesText: rev0.policiesText, deposits: rev0.deposits });
        // salva lo stato dell'ultima revisione (senza avvisi né registro attività)
        if ((rev0.kind === "new" || rev0.kind === "modified" || rev0.kind === "cancelled") && (!booking.otaRevision || !booking.otaRevision.id)) {
          patchBookingsSilently([{ id: booking.id, patch: { otaRevision: { status: booking.otaRevision?.status ?? rev0.kind, at: booking.otaRevision?.at ?? (rev0.at ? Date.parse(rev0.at) || Date.now() : Date.now()), ...(rev0.revisionId ? { id: rev0.revisionId } : {}) } } }]);
        }
        const c = rev0.customer;
        if (!c || !needCustomer || !guest) return;
        const patch: Partial<Guest> = {};
        if (c.city) patch.city = c.city;
        if (c.zip) patch.zip = c.zip;
        if (c.address && !guest.address) patch.address = c.address;
        if (Object.keys(patch).length) updateGuest(guest.id, patch);
      })
      .catch(() => { /* senza accesso o senza rete: si riprova alla prossima apertura */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id, chxId]);
  const ch = CHANNELS[booking.channel];
  const st = STATUS[booking.status] ?? STATUS.confirmed;
  const isOta = booking.channel !== "direct" && booking.channel !== "blocked";
  const origin = directOriginOf(booking);
  const sourceLabel = origin ? directOriginLabel(origin, structure?.name) : ch.label;
  const otaName = (booking.otaName ?? "").trim();
  const sourceTxt = otaName && isOta && squash(otaName) !== squash(ch.label) && !squash(ch.label).includes(squash(otaName)) ? `${sourceLabel} · ${otaName}` : sourceLabel;
  const channexId = channexIdOf(booking.extId);
  const channelTxt = channelDisplay({ extId: booking.extId, otaName: otaName || undefined, channelLabel: sourceLabel, structureName: structure?.name });
  const code = bookingCode(booking);
  const hasOtaCode = isOta && !!booking.code;

  const rooms = groupRooms(booking, bookings);
  const nTot = nights(booking.checkIn, booking.checkOut);
  const info = booking.otaInfo;
  const genius = booking.channel === "booking" ? detectGenius([info?.notes, info?.paymentInstruction, booking.note, booking.guestRequests]) : undefined;
  const names = guestNames(booking, guest);
  const arrival = booking.arrivalTime || info?.arrivalHour;
  const email = guest?.email?.trim();
  const phone = guest?.phone?.trim();
  const phoneDigits = (phone ?? "").replace(/[^\d]/g, "");
  const addressTxt = [[guest?.address, guest?.streetNumber].filter(Boolean).join(" "), guest?.province ? `(${guest.province})` : ""].filter(Boolean).join(" ");
  const notes = notesBlocks(booking);
  const noteLabel = { ota: t("Richieste del cliente (dal canale)"), note: t("Note interne"), guest: t("Richieste dell'ospite") };

  // ── Spese di prenotazione (stesse funzioni del resto dell'app) ──
  const lordo = lordoOf(booking);
  const noPrice = !booking.total;
  const pm = effectivePayMethod(booking);
  const pmDetail = pm.method === "ota" ? otaPayDetail(booking) : undefined;
  const payTypeTxt = info?.paymentType === "credit_card" ? t("carta di credito") : info?.paymentType === "bank_transfer" ? t("bonifico") : undefined;
  const pmTxt = pm.method ? `${t(PAY_METHOD_LABEL[pm.method])}${pmDetail ? ` · ${t(pmDetail)}` : ""}${pm.auto ? ` · ${t("automatico")}` : ""}` : payTypeTxt;

  return (
    <div className="flex flex-col">
      {/* 1 · Dati principali */}
      <Section title={t("Prenotazione")}>
        <Line label={t("Stato")}>
          {booking.otaRevision && (booking.status === "confirmed" || booking.status === "cancelled")
            ? <Pill color={booking.otaRevision.status === "modified" ? "var(--warn)" : booking.otaRevision.status === "cancelled" ? "var(--err)" : "var(--ok)"} title={t("Stato dell'ultima revisione ricevuta dal portale (come su Channex)")}>{booking.otaRevision.status === "modified" ? t("Modificata") : booking.otaRevision.status === "cancelled" ? t("Cancellata") : t("Nuovo")}</Pill>
            : <Pill color={st.color}>{t(st.label)}</Pill>}
        </Line>
        <Line label={t("Fonte/OTA")}>{sourceTxt}</Line>
        {channelTxt !== sourceTxt && <Line label={t("Canale")}>{channelTxt}</Line>}
        <Line label={t("ID della prenotazione")} mono>{hasOtaCode ? channexCodeOf(booking.channel, code) : code}<CopyBtn text={hasOtaCode ? channexCodeOf(booking.channel, code) : code} /></Line>
        {channexId && <Line label={t("ID prenotazione")} mono>{channexId}<CopyBtn text={channexId} /></Line>}
        {(fx?.revisionId || booking.otaRevision?.id) && <Line label={t("Identificativo della revisione")} mono>{fx?.revisionId || booking.otaRevision?.id}<CopyBtn text={(fx?.revisionId || booking.otaRevision?.id) as string} /></Line>}
        {hasOtaCode && <Line label={t("ID prenotazione OTA")} mono>{code}<CopyBtn text={code} /></Line>}
        {booking.bookedOn && <Line label={t("Prenotato il")}>{fmtDateWd(booking.bookedOn)}</Line>}
        <Line label={t("Proprietà")}>{structure?.name ?? "—"}</Line>
        {fx?.ruid && <Line label="RUID" mono>{fx.ruid}<CopyBtn text={fx.ruid} /></Line>}
      </Section>

      {/* 2 · Check-in */}
      <Section title={t("Dettagli del check-in")}>
        <Line label={t("Data di check-in")}>{fmtDateWd(booking.checkIn)}</Line>
        <Line label={t("Data di partenza")}>{fmtDateWd(booking.checkOut)}</Line>
        <Line label={t("Orario di arrivo")}>{arrival || "—"}</Line>
        <Line label={t("Notti")}>{nTot}</Line>
        <Line label={t("Camere")}>{rooms.length}</Line>
        <Line label={t("Occupazione")} mono>{occupancyLabel(booking)}</Line>
      </Section>

      {/* 3 · Cliente */}
      <Section title={t("Cliente")}>
        <Line label={t("Nome")}>{names[0] || guest?.fullName || "—"}{genius && <> <Pill color="var(--focus)">{genius}</Pill></>}</Line>
        <Line label={t("E-mail")}>
          {email
            ? <><a href={safeMailtoHref(email)} className="text-focus hover:underline">{email}</a>{isRelayEmail(email) && <> <Pill color="var(--dim)" title={t("Indirizzo di inoltro del canale: i messaggi passano dall'OTA fino all'ospite")}>{t("email OTA")}</Pill></>}</>
            : "—"}
        </Line>
        <Line label={t("Telefono")} mono={!phone}>
          {phone
            ? <><a href={safeTelHref(phone)} className="font-mono tabular-nums text-focus hover:underline">{phone}</a>{phoneDigits && <> <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-focus hover:underline">WhatsApp</a></>}</>
            : "—"}
        </Line>
        <Line label={t("Lingua")}>{languageName(guest?.language) || "—"}</Line>
        <Line label={t("Paese")}>{countryName(guest?.country) || "—"}</Line>
        <Line label={t("Indirizzo")}>{addressTxt || "—"}</Line>
        <Line label={t("Città")}>{guest?.city || "—"}</Line>
        <Line label={t("CAP")}>{guest?.zip || "—"}</Line>
      </Section>

      {/* 4 · Camere */}
      <Section title={rooms.length > 1 ? `${t("Camere")} (${rooms.length})` : t("Camere")}>
        {rooms.map((r, rIdx) => {
          const rt = getRoomType(r.roomTypeId);
          const un = getUnit(r.unitId);
          const rg = getGuest(r.guestId);
          const rInfo = r.otaInfo;
          const rNights = nights(r.checkIn, r.checkOut);
          const bd = nightRows(r, (iso) => nightlyRevenue(r, iso));
          const rNames = guestNames(r, rg);
          const lines = cancelPenaltyLines(rInfo?.cancelPenalties);
          const directCancel = lines.length === 0 && !isOta ? directCancelText(r) : undefined;
          const ages = r.childAges && r.childAges.length ? r.childAges : undefined;
          return (
            <div key={r.id} className="rounded-xl border border-line bg-paper p-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0 text-sm font-semibold text-txt">
                  {rt?.name ?? "—"} · {un?.name ?? t("Da assegnare")}
                  {r.status === "cancelled" && <> <Pill color={STATUS.cancelled.color}>{t(STATUS.cancelled.label)}</Pill></>}
                </div>
                <div className="shrink-0 font-mono text-sm font-bold tabular-nums text-txt">{r.total ? eur(r.total) : "—"}</div>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                <Line label={t("Date")}>{fmtDateWd(r.checkIn)} → {fmtDateWd(r.checkOut)} · {nightsTxt(rNights, t)}</Line>
                {r.ratePlanName && <Line label={t("Tariffa")}>{r.ratePlanName}</Line>}

                <div>
                  <SubTitle>{t("Dettaglio prezzi")}</SubTitle>
                  <div className="mt-1 flex flex-col gap-0.5 text-sm">
                    {bd.exact
                      ? bd.rows.map((n) => (
                          <div key={n.date} className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 text-dim">{n.label}{r.ratePlanName ? <span className="text-faint"> · {r.ratePlanName}</span> : null}</span>
                            <span className="shrink-0 font-mono tabular-nums text-txt">{eur(n.amount)}</span>
                          </div>
                        ))
                      : (
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-dim">{t("Soggiorno")} · {nightsTxt(rNights, t)}</span>
                            <span className="shrink-0 font-mono tabular-nums text-txt">{r.total ? eur(r.total) : t("Prezzo mancante")}</span>
                          </div>
                        )}
                    {bd.exact && (
                      <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-1 font-semibold">
                        <span className="text-txt">{t("Subtotale")}</span>
                        <span className="shrink-0 font-mono tabular-nums text-txt">{eur(bd.subtotal)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <Line label={t("Ospiti")}>{rNames.length ? rNames.map((n, i) => <div key={i}>{n}</div>) : "—"}</Line>
                <Line label={t("Occupazione")}>
                  {t("Adulti")}: {r.adults} · {t("Bambini")}: {r.children}{ages ? ` (${ages.join(", ")} ${t("anni")})` : ""}{typeof r.cribs === "number" ? ` · ${t("Neonati")}: ${r.cribs}` : ""}
                </Line>
                {rInfo?.mealPlan && <Line label={t("Piano pasto")}>{rInfo.mealPlan}</Line>}
                {rInfo?.smokingPreferences && <Line label={t("Preferenze fumatori")}>{rInfo.smokingPreferences}</Line>}
                {rInfo?.bedPreferences && <Line label={t("Preferenze letti")}>{rInfo.bedPreferences}</Line>}
                {(rInfo?.policies || rInfo?.paymentInstruction || (rIdx === 0 && fx?.policiesText)) && <Line label={t("Politiche")}><span className="whitespace-pre-wrap">{rInfo?.policies || rInfo?.paymentInstruction || fx?.policiesText}</span></Line>}
                {lines.length > 0 && (
                  <Line label={t("Politica di cancellazione")}>
                    <div className="flex flex-col gap-0.5">
                      {lines.map((l, i) => (
                        <div key={i} className="flex items-baseline justify-between gap-3">
                          <span className="text-dim">{t("Da")} {l.from}</span>
                          <span className="shrink-0 font-mono tabular-nums" style={l.free ? { color: "var(--ok)" } : undefined}>{l.free ? t("Gratuita") : money(l.amount, l.currency)}</span>
                        </div>
                      ))}
                    </div>
                  </Line>
                )}
                {directCancel && <Line label={t("Politica di cancellazione")}>{t(directCancel)}</Line>}
              </div>
            </div>
          );
        })}
      </Section>

      {/* 5 · Garanzia */}
      <Section title={t("Garanzia")}>
        {booking.otaCard?.present ? (
          <>
            <Line label={t("Carta virtuale OTA")}>
              {booking.otaCard.charged ? <Pill color="var(--ok)">{t("Addebitata ✓")}</Pill> : <Pill color="var(--warn)">{t("Da addebitare")}</Pill>}
            </Line>
            {booking.otaCard.balance != null && <Line label={t("Importo addebitabile")} mono>{money(booking.otaCard.balance, booking.otaCard.currency)}</Line>}
            {booking.otaCard.effectiveDate && <Line label={t("Addebitabile dal")}>{fmtDate(booking.otaCard.effectiveDate)}</Line>}
            {booking.otaCard.expirationDate && <Line label={t("Scadenza carta")}>{fmtDate(booking.otaCard.expirationDate)}</Line>}
          </>
        ) : (
          <p className="text-sm italic text-dim">{t("Con questa prenotazione non viene fornita alcuna carta di credito")}</p>
        )}
      </Section>

      {/* 6 · Appunti */}
      {notes.length > 0 && (
        <Section title={t("Appunti")}>
          {notes.map((n) => (
            <Line key={n.key} label={noteLabel[n.key]}><span className="whitespace-pre-wrap">{n.text}</span></Line>
          ))}
        </Section>
      )}

      {/* 7 · Spese di prenotazione */}
      <Section title={t("Spese di prenotazione")}>
        <SubTitle>{t("Importo")}</SubTitle>
        <Line label={t("Importo totale")} mono>{noPrice ? <span className="font-sans text-dim">{t("Prezzo mancante")}</span> : <b>{eur(lordo)}</b>}</Line>
        {rooms.length > 1 && <p className="text-[11px] text-faint">{t("Camera di un gruppo: importi di questa sola camera.")}</p>}
        {pmTxt && <Line label={t("Metodo di pagamento")}>{pmTxt}</Line>}
        {chxId && <Line label={t("Depositi")}>{fx?.deposits || "—"}</Line>}
        {(booking.paidOnline ?? 0) > 0 && (
          <Line label={t("Acconti")} mono>{eur(booking.paidOnline)}<span className="font-sans text-[11px] text-faint"> · {t("pagamento online")}{booking.paidAt ? ` ${fmtDate(booking.paidAt)}` : ""}</span></Line>
        )}
      </Section>
    </div>
  );
}
