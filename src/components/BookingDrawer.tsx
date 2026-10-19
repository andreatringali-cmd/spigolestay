"use client";

import { useEffect, useRef, useState } from "react";
import { BOOKING_COLORS, isHexColor } from "@/lib/booking-color";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { sortUnitsByName } from "@/lib/sortUnits";
import { bookingCode } from "@/lib/bookingCode";
import { sendVoucher, voucherPayload } from "@/lib/mailer";
import { captureA4ToPdfBlob, blobToBase64 } from "@/lib/pdf-capture";
import VoucherDoc from "@/components/pdf/VoucherDoc";
import { guestLangOf } from "@/lib/guest-lang";
import { buildGuestLink, buildGroupGuestLink, guideMessage, shortenGuideLink, shortenLink } from "@/lib/guestlink";
import { CHANNELS, type Booking, type Channel, type BookingStatus, type Structure } from "@/lib/types";
import NumInput from "@/components/NumInput";
import BookingChannelLogo from "@/components/BookingChannelLogo";
import { directOriginLabel, directOriginOf } from "@/lib/direct-origin";
import BookingExtrasPicker from "@/components/booking/BookingExtrasPicker";
import BookingBillActions from "@/components/booking-panel/BookingBillActions";
import BookingMessageButtons from "@/components/BookingMessageButtons";
import { entriesTotal } from "@/lib/booking-extras";
import { collectRuleOf, effectivePayMethod, otaPayDetail, MANUAL_PAY_METHODS, PAY_METHOD_LABEL, isPayMethod, type PayMethod } from "@/lib/pay-method";
import { roundCents } from "@/lib/money";
import { nights, parseISO, shiftISO, fmtDate as fmtDateIt, fmtDM, fmtDateTime } from "@/lib/dates";
import DateField from "@/components/DateField";
import { isNetPayout, otaAcceleratorFee, commissionIsEstimate, COMMISSION_ESTIMATE_HINT, cityTaxOfBooking, cityTaxOfBookingRaw, nightlyRevenue, commissionBaseOf, commissionOf, commissionPctOf, commissionShareOf, defaultCommissionInfo, nettoOf, otaAdjustmentOf, paymentFeeOf } from "@/lib/booking";
import { checkUnderpriced, underpriceReason } from "@/lib/priceAlert";
import { loadWeekendPct } from "@/lib/pricing";
import { eur } from "@/lib/format";
import { plural } from "@/lib/plural";
import { friendlyError } from "@/lib/friendly-error";
import { ymdRome } from "@/lib/dates-rome";
import { bookingGrandTotal } from "@/lib/booking";
import { balanceDue, otaCoveredAmount, paymentStatus } from "@/lib/incassi";
import { describeCancelPenalties } from "@/lib/channex-guestdata";
import { invPost } from "@/lib/invoicing/client";
import AdempimentiPanel from "@/components/booking/AdempimentiPanel";
import OtaReportMenu from "@/components/booking/OtaReportMenu";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import { useAccess } from "@/lib/access";
import Icon from "@/components/Icon";
import MediaImg from "@/components/MediaImg";
import MediaLink from "@/components/MediaLink";
import QRCode from "qrcode";
import BookingInfoTab from "@/components/booking-panel/BookingInfoTab";
import BookingTimelineTab from "@/components/booking-panel/BookingTimelineTab";
import BookingMessagesTab from "@/components/booking-panel/BookingMessagesTab";
import { recordOutgoing, markReminder } from "@/lib/guest-messages";
import { renderSystemMessage } from "@/lib/msg-overrides";
import { waSendUrl } from "@/lib/wa-link";
import { fillTemplateForBooking, fillTemplateNow, linkedTemplate, templateRawFor } from "@/lib/template-fill";
import { channexCodeOf, countryName, fmtDateWd, groupRooms, guestNames, languageName, nightRows, notesBlocks, safeMailtoHref, safeTelHref } from "@/lib/booking-info";
import { bookingSheetHtml, type SheetInput } from "@/lib/booking-sheet";

const fmtDate = (iso: string) => fmtDateIt(iso);

// Compleanno dell'ospite che cade durante il soggiorno [checkIn, checkOut): ritorna la data ISO o null.
const birthdayInStay = (birthDate?: string, checkIn?: string, checkOut?: string): string | null => {
  if (!birthDate || !checkIn || !checkOut) return null;
  const md = birthDate.slice(5);
  for (const y of new Set([checkIn.slice(0, 4), checkOut.slice(0, 4)])) {
    const iso = `${y}-${md}`;
    if (iso >= checkIn && iso < checkOut) return iso;
  }
  return null;
};

const STATUS: Record<BookingStatus, { label: string; color: string }> = {
  confirmed: { label: "Confermata", color: "var(--ok)" },
  tentative: { label: "Opzione", color: "var(--warn)" },
  cancelled: { label: "Cancellata", color: "var(--err)" },
  no_show: { label: "No-show", color: "var(--faint)" },
};

// Tassa di soggiorno: logica unica condivisa in @/lib/booking (cityTaxOf).

interface Form {
  checkIn: string; checkOut: string;
  channel: Channel; status: BookingStatus;
  adults: number; children: number;
  unitId: string | null;
  total: number; cleaningFee: number; commissionPct: number; commissionAmount: number | null; paid: number;
  code: string;
  cityTaxExempt: boolean; cityTaxPaid: boolean; depositPaid: boolean; parking: boolean;
  note: string; color: string;
  lastName: string; firstName: string; email: string; phone: string; country: string;
  extras: NonNullable<Booking["extras"]>; paymentMethod: PayMethod | "";
}

type PanelTab = "info" | "timeline" | "msg" | "manage";
const PANEL_TABS: [PanelTab, string][] = [["info", "Informazioni"], ["timeline", "Timeline"], ["msg", "Messaggi OTA"], ["manage", "Gestione"]];

const inputCls = "w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus";

export default function BookingDrawer() {
  const {
    selectedBookingId, closeBooking, bookings, units, roomTypes, rateOverrides,
    getGuest, getUnit, getStructure, getRoomType,
    updateBooking, updateGuest, deleteBooking, deleteBookingGroup,
  } = useData();
  const weekendPct = loadWeekendPct();

  const router = useRouter();
  const ask = useConfirm();
  const { t } = useLang();
  const { moduleOn } = useAccess();
  const booking = bookings.find((b) => b.id === selectedBookingId) ?? null;

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [tab, setTab] = useState<PanelTab>("info"); // scheda del pannello: al clic su una riga si apre Informazioni
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  const [voucher, setVoucher] = useState<{ sending?: boolean; ok?: boolean; msg?: string }>({});
  const [emit, setEmit] = useState<{ busy?: boolean; msg?: string }>({});
  const emitDocument = async () => {
    if (!booking) return;
    setEmit({ busy: true });
    try {
      const r = await invPost<{ documentId: string }>("create", { bookingId: booking.id });
      setEmit({}); // la scheda resta montata nel layout: senza reset il pulsante resterebbe bloccato anche per le prenotazioni successive
      closeBooking();
      router.push(`/documenti/${r.documentId}`);
    } catch (e) { setEmit({ msg: friendlyError(e) }); }
  };
  const [checkinQr, setCheckinQr] = useState("");
  const [expanded, setExpanded] = useState(false); // false = anteprima, true = scheda intera
  const [qa, setQa] = useState<null | "incasso" | "extra">(null); // azione rapida aperta
  const [payOpen, setPayOpen] = useState(false); // «Impostazioni dei pagamenti»: chiusa all'apertura della scheda
  const [incassoAmt, setIncassoAmt] = useState<number | null>(null);
  const [incassoMethod, setIncassoMethod] = useState<PayMethod>("contanti"); // come ha pagato (contanti, carta, bonifico…) per l'incasso che stai registrando
  const checkinRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  // Su telefono le schede scorrono: la scheda attiva si porta in vista (altrimenti "Gestione" resta fuori schermo).
  useEffect(() => { (tabsRef.current?.querySelector('[aria-selected="true"]') as HTMLElement | null)?.scrollIntoView({ inline: "center", block: "nearest" }); }, [tab, selectedBookingId]);
  const voucherPdfRef = useRef<HTMLDivElement>(null); const lastSendRef = useRef<Record<string, number>>({}); const sendOnce = (k: string) => { const n = Date.now(); if (n - (lastSendRef.current[k] ?? 0) < 3000) return false; lastSendRef.current[k] = n; return true; }; // anti-doppio-clic (3 s): evita invii/registrazioni duplicate, un nuovo invio dopo 3 s resta possibile

  const loadForm = () => {
    if (!booking) { setForm(null); return; }
    const g = getGuest(booking.guestId);
    setForm({
      checkIn: booking.checkIn, checkOut: booking.checkOut,
      channel: booking.channel, status: booking.status,
      adults: booking.adults, children: booking.children,
      unitId: booking.unitId,
      total: booking.total ?? 0, cleaningFee: booking.cleaningFee ?? 0,
      commissionPct: booking.commissionPct ?? defaultCommissionInfo(booking.channel, booking.structureId).pct,
      commissionAmount: booking.commissionAmount ?? null,
      paid: booking.paid ?? 0, code: booking.code ?? "",
      cityTaxExempt: !!booking.cityTaxExempt, cityTaxPaid: !!booking.cityTaxPaid, depositPaid: !!booking.depositPaid, parking: !!booking.parking,
      note: booking.note ?? "", color: booking.color ?? "",
      lastName: g?.lastName ?? (g?.fullName ? g.fullName.split(" ").slice(1).join(" ") : ""),
      firstName: g?.firstName ?? (g?.fullName ? g.fullName.split(" ")[0] : ""),
      email: g?.email ?? "", phone: g?.phone ?? "", country: g?.country ?? "",
      extras: (booking.extras ?? []).map((x) => ({ ...x })), paymentMethod: isPayMethod(booking.paymentMethod) ? booking.paymentMethod : "",
    });
  };

  // All'apertura di una prenotazione: torna in vista e ricarica i dati.
  useEffect(() => {
    setMode("view");
    setTab("info");
    setExpanded(false);
    setQa(null);
    setPayOpen(false);
    setIncassoAmt(null); // importo/messaggi di un'altra prenotazione non devono restare nei campi della nuova
    setVoucher({});
    setEmit({});
    setSaved(false);
    loadForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBookingId]);

  // QR del link di gestione (self check-in) per la prenotazione aperta.
  useEffect(() => {
    if (!selectedBookingId || typeof window === "undefined") { setCheckinQr(""); return; }
    const link = `${window.location.origin}/checkin?b=${selectedBookingId}`;
    let alive = true;
    QRCode.toDataURL(link, { margin: 1, width: 220 }).then((d) => { if (alive) setCheckinQr(d); }).catch(() => { if (alive) setCheckinQr(""); });
    return () => { alive = false; };
  }, [selectedBookingId]);

  if (!booking) return null;

  // Stesso controllo "sotto costo" già mostrato su Calendario e Prenotazioni (lib/priceAlert):
  // mancava qui, nella scheda di dettaglio — unico posto a non segnalarlo finora.
  const underprice = booking.channel !== "blocked" ? checkUnderpriced(booking, roomTypes, rateOverrides, weekendPct) : null;

  const guest = getGuest(booking.guestId);
  // ── Memoria ospite (CRM): riconosci chi torna, con preferenze e VIP ──
  const guestStays = guest ? bookings.filter((b) => b.guestId === guest.id && b.status !== "cancelled") : [];
  const priorStays = guestStays.filter((b) => b.id !== booking.id);
  const gTimes = guestStays.length;
  const gReturning = priorStays.length >= 1;
  const gTotalSpent = guestStays.reduce((a, b) => a + (b.total ?? 0), 0);
  const gLastPrior = priorStays.map((b) => b.checkIn).sort().pop();
  const gVip = !!guest?.vip || gTimes >= 3; // VIP manuale oppure automatico dal 3° soggiorno
  // ── Recensione Google dopo il check-out ──
  const departed = booking.checkOut <= ymdRome(new Date());
  const reviewUrl = (() => { try { return JSON.parse(localStorage.getItem("spigolestay:guides") || "{}")?.[booking.structureId]?.reviewUrl || ""; } catch { return ""; } })();
  const structure = getStructure(booking.structureId);
  const roomType = getRoomType(booking.roomTypeId);
  const unitV = getUnit(booking.unitId);
  // Info effettive della camera: valore della camera se impostato, altrimenti della tipologia; dotazioni sommate.
  const effBedConfig = unitV?.bedConfig || roomType?.bedConfig;
  const effSize = unitV?.size ?? roomType?.size;
  const ch = CHANNELS[booking.channel];
  const st = STATUS[booking.status];

  // ── Contatti (dai dati salvati) ──
  const phoneDigits = (guest?.phone ?? "").replace(/[^\d]/g, "");
  const waText = encodeURIComponent(renderSystemMessage("contact", guestLangOf(guest), { nome: guest?.fullName ?? "", struttura: structure?.name ?? "Xenora", checkin: fmtDate(booking.checkIn) })); // testo modificabile (Messaggi → Modelli)

  // ── Conto in sola lettura (dai dati salvati) ──
  const nView = nights(booking.checkIn, booking.checkOut);
  const noPrice = !booking.total; // prezzo mancante (es. OTA senza importo): nessun totale inventato
  const accV = booking.total ?? 0;
  const cleanV = booking.cleaningFee ?? 0;
  const extrasList = booking.extras ?? [];
  const extrasV = extrasList.reduce((a, e) => a + (e.price || 0), 0);
  const taxV = cityTaxOfBooking(structure, booking); // quota di gruppo, oppure paganti (adulti + minori sopra soglia) con divisore = tutti gli ospiti
  // "Totale ospite" = quanto pagato per il soggiorno (senza tassa di soggiorno, riscossa
  // localmente e mai transitata dall'OTA): torna con l'importo che mostra Booking.com ecc.
  const totalV = accV + cleanV + extrasV;
  const commPctV = commissionShareOf(booking); // % REALE di questa prenotazione: (lordo − netto) ÷ lordo, cioè commissione + costo incasso ÷ lordo (cambia con promo e livello Genius)
  const commTotV = commissionOf(booking);
  // Soggiorno e extra restano separati: commissione e netto dell'OTA riguardano SOLO il soggiorno; gli extra li vende la struttura (nessuna commissione).
  const stayV = accV + cleanV;
  // OTA che paga già il NETTO (Expedia con carta virtuale): il totale è il netto; il lordo si ricostruisce con le trattenute dichiarate e l'Accelerator Fee.
  const netPayV = isNetPayout(booking);
  const dedV = netPayV ? (booking.otaDeductions ?? booking.commissionAmount ?? 0) : (booking.otaDeductions ?? 0); // righe importate prima del flag: la commissione di Expedia è in commissionAmount
  const accelV = netPayV ? otaAcceleratorFee(booking) : 0;
  const grossV = netPayV && stayV > 0 ? roundCents(stayV + dedV + accelV) : stayV;
  const nettoStayV = netPayV ? stayV : stayV > 0 ? Math.max(0, roundCents(stayV - commTotV)) : 0;
  const commPctStayV = netPayV ? (grossV > 0 ? Math.round(((dedV + accelV) / grossV) * 1000) / 10 : 0) : stayV > 0 ? Math.round((commTotV / stayV) * 1000) / 10 : 0;
  const commV = commissionBaseOf(booking);
  const payFeeV = paymentFeeOf(booking);
  const adjV = otaAdjustmentOf(booking); // sconti applicati dall'OTA (differenza con la carta virtuale)
  const nettoV = nettoOf(booking);
  const paidV = booking.paid ?? 0;
  const otaPaidV = otaCoveredAmount(booking, structure); // già pagato all'OTA quando incassa lei (regola del canale o dato della prenotazione)
  const balanceV = Math.max(0, totalV - paidV - otaPaidV);

  // «Stampa» del pannello: scheda della prenotazione come la stampa di Channex (la ricevuta per l'ospite è il pulsante «Ricevuta» di Gestione).
  // Testo dal MODELLO collegato al passaggio (check-in, guida, recensione) se c'è: i pulsanti usano lo stesso testo dei modelli. Senza modello, il testo di base.
  const fillDeps = { bookings, getUnit, getRoomType };
  const modelText = async (srcId: string): Promise<string | null> => {
    const tpl = linkedTemplate(srcId, booking.structureId);
    if (!tpl) return null;
    const text = await fillTemplateForBooking(templateRawFor(tpl, guest), booking, guest, structure, fillDeps);
    return text.trim() ? text : null;
  };
  const modelTextNow = (srcId: string): string | null => {
    const tpl = linkedTemplate(srcId, booking.structureId);
    if (!tpl) return null;
    const text = fillTemplateNow(templateRawFor(tpl, guest), booking, guest, structure, fillDeps);
    return text.trim() ? text : null;
  };

  const printSheet = () => {
    const w = window.open("", "_blank", "width=820,height=940");
    if (!w) return;
    const rooms = groupRooms(booking, bookings);
    const info = booking.otaInfo;
    const adultsT = rooms.reduce((a, r) => a + (r.adults ?? 0), 0), childT = rooms.reduce((a, r) => a + (r.children ?? 0), 0);
    const occ = (a: number, c: number, cribs?: number) => [`${a} ${a === 1 ? "adulto" : "adulti"}`, c ? `${c} ${c === 1 ? "bambino" : "bambini"}` : "", cribs ? `${cribs} ${cribs === 1 ? "neonato" : "neonati"}` : ""].filter(Boolean).join(", ");
    const nT = nights(booking.checkIn, booking.checkOut);
    const lordo = rooms.reduce((a, r) => a + (r.total ?? 0), 0) || booking.total || 0;
    const names0 = guestNames(booking, guest)[0] || guest?.fullName || "";
    const commission = isOtaChannelV ? commissionBaseOf(booking) : 0;
    const otaNote = notesBlocks(booking).find((n) => n.key === "ota")?.text;
    const payTxt = pmView.method ? `${t(PAY_METHOD_LABEL[pmView.method])}${pmDetail ? ` · ${t(pmDetail)}` : ""}` : undefined;
    const input: SheetInput = {
      property: structure?.name ?? "", channel: (booking.otaName || "").trim() || ch.label,
      header: [fmtDateWd(booking.checkIn), plural(nT, "notte", "notti"), names0].filter(Boolean).join(" - "),
      checkIn: fmtDateWd(booking.checkIn), checkOut: fmtDateWd(booking.checkOut), arrival: booking.arrivalTime && booking.arrivalTime !== "Non lo so" ? booking.arrivalTime : (info?.arrivalHour || "N/D"),
      nights: String(nT), rooms: String(rooms.length), occupancy: occ(adultsT, childT), total: lordo ? eur(lordo) : "—",
      customer: { name: names0, country: countryName(guest?.country) || undefined, language: languageName(guest?.language) || undefined, email: guest?.email, phone: guest?.phone },
      otaCode: booking.code && isOtaChannelV ? booking.code : undefined, bookedAt: booking.bookedOn ? fmtDateWd(booking.bookedOn) : undefined,
      commission: commission > 0 ? eur(commission) : undefined, notes: otaNote, payment: payTxt,
      roomsList: rooms.map((r) => {
        const rt = getRoomType(r.roomTypeId); const bd = nightRows(r, (iso) => nightlyRevenue(r, iso)); const ri = r.otaInfo;
        return {
          title: `${rt?.name ?? "—"} - ${r.total ? eur(r.total) : "—"}`, checkIn: fmtDateWd(r.checkIn), checkOut: fmtDateWd(r.checkOut),
          guests: guestNames(r, getGuest(r.guestId)), occupancy: occ(r.adults ?? 0, r.children ?? 0, r.cribs), mealPlan: ri?.mealPlan, smoking: ri?.smokingPreferences, bed: ri?.bedPreferences, policies: ri?.policies || ri?.paymentInstruction,
          nights: bd.exact ? bd.rows.map((n) => ({ date: fmtDateWd(n.date), rate: r.ratePlanName, price: eur(n.amount) })) : [{ date: `${fmtDateWd(r.checkIn)} → ${fmtDateWd(r.checkOut)}`, rate: r.ratePlanName, price: r.total ? eur(r.total) : "—" }],
          subtotal: eur(bd.exact ? bd.subtotal : (r.total ?? 0)), total: r.total ? eur(r.total) : "—",
        };
      }),
    };
    w.document.write(bookingSheetHtml(input, `${t("Prenotazione")} ${bookingCode(booking)}`));
    w.document.close();
  };

  const printReceipt = () => {
    if (noPrice) { window.alert(t("Prezzo mancante: imposta l'importo del soggiorno prima di stampare la ricevuta.")); return; }
    const w = window.open("", "_blank", "width=820,height=940");
    if (!w) return;
    const money = eur;
    const today = fmtDateIt(new Date());
    const unitV = getUnit(booking.unitId);
    const rows: [string, string][] = [
      [`Soggiorno · ${plural(nView, "notte", "notti")} (${fmtDate(booking.checkIn)} → ${fmtDate(booking.checkOut)})`, money(accV)],
    ];
    if (cleanV > 0) rows.push(["Pulizia finale", money(cleanV)]);
    for (const e of extrasList) if ((e.price || 0) > 0) rows.push([e.name || "Extra", money(e.price || 0)]);
    if (taxV > 0) rows.push(["Tassa di soggiorno", money(taxV)]);
    // Totale e saldo dalle stesse funzioni usate nel resto dell'app: il totale è la somma delle righe qui sopra (tassa compresa).
    const totalR = bookingGrandTotal(booking, structure);
    const balanceR = balanceDue(booking, structure);
    const paidR = Math.max(0, roundCents(totalR - balanceR));
    const payStatus = paymentStatus(booking, structure);
    const stampLabel = payStatus === "saldato" ? "Saldato" : payStatus === "acconto" ? "Acconto versato" : "Da saldare";
    const stampColor = payStatus === "saldato" ? "#0e7c4a" : "#c98a12";
    const accent = structure?.photoColor || "#285f92";
    const esc = (s: unknown) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] || c));
    const contacts = [structure?.email, structure?.phone, structure?.website].filter(Boolean).map(esc).join(" · ");
    const addr = [structure?.address, structure?.streetNumber, structure?.city].filter(Boolean).map(esc).join(" ");
    const ids = [structure?.cin ? `CIN ${esc(structure.cin)}` : "", structure?.vat ? `P.IVA ${esc(structure.vat)}` : ""].filter(Boolean).join(" · ");
    const logo = structure?.logo
      ? `<img src="${esc(structure.logo)}" alt="" style="height:56px;width:auto;max-width:180px;object-fit:contain"/>`
      : `<div style="height:56px;width:56px;border-radius:12px;background:${accent};color:#fff;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;font-weight:800;font-size:22px">${esc((structure?.name ?? "XN").slice(0, 2).toUpperCase())}</div>`;
    w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Ricevuta di soggiorno ${esc(bookingCode(booking))}</title>
    <style>
      *{box-sizing:border-box} body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1a2131;margin:0;padding:52px 58px;font-size:14px;line-height:1.55}
      .head{display:flex;justify-content:space-between;align-items:center;gap:18px;padding-bottom:20px;margin-bottom:6px;border-bottom:3px solid ${accent}}
      .brandwrap{display:flex;align-items:center;gap:14px}
      .brand{font-size:22px;font-weight:800;letter-spacing:-.3px;color:#1a2131}
      .brandsub{font-size:12px;color:#6b7280;margin-top:3px}
      .meta{font-size:12px;color:#6b7280;text-align:right;line-height:1.7}
      .ids{font-size:10.5px;color:#9aa2b6;margin-top:2px}
      h1{font-size:13px;letter-spacing:2.5px;text-transform:uppercase;color:${accent};margin:26px 0 2px;font-weight:700}
      .sub{color:#6b7280;font-size:12px;margin-bottom:22px}
      .box{background:#f7f8fb;border:1px solid #e6e9f0;border-radius:12px;padding:15px 18px;margin-bottom:22px}
      .box b{display:block;font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:#9aa2b6;margin-bottom:5px}
      table{width:100%;border-collapse:collapse;margin-top:6px}
      td{padding:11px 4px;border-bottom:1px solid #eceef4}
      td.amt{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
      tr.tot td{border-top:2px solid #1a2131;border-bottom:none;font-weight:800;font-size:17px;padding-top:14px}
      tr.pay td{border-bottom:none;padding:6px 4px;color:#4b5563;font-size:13px}
      tr.pay td.amt.paid{color:#0e7c4a;font-weight:700}
      tr.pay td.amt.due{color:${accent};font-weight:800}
      .stamp{display:inline-block;margin-top:20px;border:2px solid ${stampColor};color:${stampColor};border-radius:8px;padding:4px 12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;font-size:12px;transform:rotate(-3deg)}
      .note{margin-top:30px;font-size:10.5px;color:#9aa2b6;border-top:1px solid #eceef4;padding-top:14px}
      .foot{margin-top:6px;font-size:10.5px;color:#b6bccb;text-align:center}
      @media print{body{padding:26px 32px}}
    </style></head><body>
      <div class="head">
        <div class="brandwrap">${logo}<div>
          <div class="brand">${esc(structure?.name ?? "Xenora")}</div>
          ${addr ? `<div class="brandsub">${addr}</div>` : ""}
          ${contacts ? `<div class="brandsub">${contacts}</div>` : ""}
          ${ids ? `<div class="ids">${ids}</div>` : ""}
        </div></div>
        <div class="meta">Riferimento prenotazione<br><b style="color:#1a2131;font-size:15px">${esc(bookingCode(booking))}</b><br>${today}</div>
      </div>
      <h1>Ricevuta di soggiorno</h1>
      <div class="sub">Soggiorno turistico · ${esc(ch.label)}</div>
      <div class="box"><b>Ospite</b>${esc(guest?.fullName ?? "—")}${guest?.email ? " · " + esc(guest.email) : ""}${guest?.phone ? " · " + esc(guest.phone) : ""}<br>
      <span style="color:#6b7280;font-size:13px">${esc(roomType?.name ?? "")}${unitV?.name ? " — " + esc(unitV.name) : ""} · ${plural(booking.adults, "adulto", "adulti")}${booking.children ? " · " + plural(booking.children, "bambino", "bambini") : ""}</span></div>
      <table>
        ${rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="amt">${r[1]}</td></tr>`).join("")}
        <tr class="tot"><td>Totale</td><td class="amt">${money(totalR)}</td></tr>
        <tr class="pay"><td>Incassato</td><td class="amt paid">${money(paidR)}</td></tr>
        <tr class="pay"><td>Saldo dovuto</td><td class="amt due">${money(balanceR)}</td></tr>
      </table>
      <div class="stamp">${stampLabel}</div>
      <div class="note">Documento non fiscale, rilasciato a titolo di ricevuta. La tassa di soggiorno è versata al Comune${structure?.city ? " di " + esc(structure.city) : ""}.</div>
      <div class="foot">Generato con Xenora · Digital Solution</div>
      <script>window.onload=function(){window.print()}<\/script>
    </body></html>`);
    w.document.close();
  };


  const groupSize = booking?.groupId ? bookings.filter((x) => x.groupId === booking.groupId).length : 0;
  const removeGroup = async () => {
    if (!booking?.groupId) return;
    if (await ask({ title: t("Elimina prenotazione di gruppo"), message: `${t("Eliminare definitivamente tutte le")} ${groupSize} ${t("camere di questo gruppo?")}`, danger: true, confirmLabel: t("Elimina tutto il gruppo") })) deleteBookingGroup(booking.groupId);
  };
  const remove = async () => { if (await ask({ title: t("Elimina prenotazione"), message: t("Eliminare definitivamente questa prenotazione?"), danger: true, confirmLabel: t("Elimina") })) deleteBooking(booking.id); };

  const sendVoucherNow = async () => {
    if (!booking) return;
    if (!guest?.email) { setVoucher({ ok: false, msg: t("L'ospite non ha un'email.") }); return; }
    if (!sendOnce(`voucher:${booking.id}`)) return;
    setVoucher({ sending: true });
    // Cattura l'anteprima reale del voucher (VoucherDoc, fuori schermo) come vero PDF allegato —
    // stessa tecnica dei preventivi (fotocopia html2canvas), invece del disegno pdf-lib a parte.
    // Se la cattura fallisce per qualsiasi motivo, l'email parte comunque (il server ripiega sul
    // disegno pdf-lib): non blocchiamo mai l'invio per questo.
    let pdf: { pdfBase64?: string; pdfFilename?: string } | undefined;
    try {
      if (voucherPdfRef.current) {
        const blob = await captureA4ToPdfBlob([voucherPdfRef.current]);
        pdf = { pdfBase64: await blobToBase64(blob), pdfFilename: `voucher-${bookingCode(booking)}.pdf` };
      }
    } catch (e) { console.error("sendVoucherNow: cattura PDF anteprima fallita, invio con fallback server:", e instanceof Error ? e.message : e); }
    const r = await sendVoucher(booking, { getStructure, getGuest, getRoomType, getUnit }, pdf);
    if (r.ok) recordOutgoing(guest.id, `Voucher di conferma inviato a ${guest.email}`, "Email", undefined, { bid: booking.id, rem: "voucher" }); // resta traccia nella Timeline e in Messaggi
    setVoucher({ sending: false, ok: r.ok, msg: r.ok ? t("Voucher inviato a") + " " + guest.email : r.error });
  };

  // ─────────────── VISTA (sola lettura) ───────────────
  const registraIncasso = () => { const amt = roundCents(incassoAmt ?? 0); if (!amt) return; updateBooking(booking.id, { paid: roundCents(paidV + amt), ...(pmView.auto ? {} : { paymentMethod: incassoMethod }) }); setIncassoAmt(null); setQa(null); };
  const removeExtra = (i: number) => updateBooking(booking.id, { extras: extrasList.filter((_, j) => j !== i) });
  const gestisciCheckin = () => { setQa(null); setTimeout(() => checkinRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); };
  // Extra della prenotazione: catalogo della struttura (+ animali, culla, letto suggeriti) con quantità; salva subito.
  const extraPanel = qa === "extra" && (
    <div className="rounded-lg border border-line bg-wash p-2">
      <div className="mb-1.5 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-faint">{t("Extra")}</span><button onClick={() => setQa(null)} className="text-xs text-dim hover:text-txt">{t("Chiudi")} ✕</button></div>
      <BookingExtrasPicker entries={extrasList} onChange={(next) => updateBooking(booking.id, { extras: next })} catalog={structure?.extras} stay={booking} onConfigure={() => { closeBooking(); router.push("/upselling?tab=catalogo"); }} />
    </div>
  );
  // Come è stato incassato: scelto dal gestore, oppure "Incasso OTA" in automatico quando l'OTA incassa dall'ospite.
  const payRule = collectRuleOf(structure, booking.channel);
  const pmView = effectivePayMethod(booking, payRule);
  const pmDetail = pmView.method === "ota" ? otaPayDetail(booking, payRule) : undefined;
  // «Da incassare» per la struttura: sulle OTA è il NETTO (quello che ti arriva), non il totale che paga l'ospite. Fa eccezione l'OTA che dichiara/imposta «incassa la struttura»: lì l'ospite ti consegna il totale.
  const ownCollectV = booking.otaInfo?.paymentCollect === "property" || payRule?.collect === "property";
  // OTA che incassa (soggiorno già pagato al portale): restano gli extra → balanceV. OTA senza dato su chi incassa: l'incasso atteso è il netto + gli extra.
  const dueV = (booking.channel !== "direct" && booking.channel !== "blocked") && !ownCollectV && !noPrice
    ? (otaPaidV > 0 ? balanceV : Math.max(0, roundCents(nettoStayV + extrasV - paidV)))
    : balanceV;
  const isOtaChannelV = booking.channel !== "direct" && booking.channel !== "blocked";
  const payMethodRow = (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-dim">{t("Incassato con")}</span>
      {pmView.auto
        ? <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }} title={t("Impostato in automatico: l'OTA incassa dall'ospite e poi versa alla struttura")}>{t(PAY_METHOD_LABEL.ota)}{pmDetail ? ` · ${t(pmDetail)}` : ""} · {t("automatico")}</span>
        : <select value={pmView.method ?? ""} onChange={(e) => updateBooking(booking.id, { paymentMethod: isPayMethod(e.target.value) ? e.target.value : undefined })} aria-label={t("Incassato con")} className="rounded-lg border border-line bg-paper px-2 py-1 text-xs text-txt outline-none focus:border-focus">
            <option value="">{t("Da indicare")}</option>
            {[...MANUAL_PAY_METHODS, ...(isOtaChannelV ? (["ota"] as PayMethod[]) : [])].map((m) => <option key={m} value={m}>{t(PAY_METHOD_LABEL[m])}</option>)}
          </select>}
    </div>
  );
  const qaBtn = "flex flex-col items-center gap-1 rounded-xl border border-line bg-paper px-2 py-2.5 text-[11px] font-semibold text-txt transition hover:border-focus hover:bg-wash";

  const contactIcons = (
    <div className="flex shrink-0 gap-1.5">
      <a href={phoneDigits ? `https://wa.me/${phoneDigits}?text=${waText}` : undefined} target="_blank" rel="noopener noreferrer" title="WhatsApp" className={`grid h-8 w-8 place-items-center rounded-lg text-white ${phoneDigits ? "hover:opacity-90" : "pointer-events-none opacity-30"}`} style={{ backgroundColor: "#25D366" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.4-.7-2.9-1.2-4.7-4.1-4.8-4.3-.1-.2-1.1-1.5-1.1-2.9 0-1.3.7-2 1-2.3.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.1.1.3 0 .5l-.4.6c-.1.2-.3.3-.1.6.1.3.7 1.1 1.5 1.8 1 .9 1.8 1.1 2.1 1.3.3.1.4.1.6-.1l.7-.9c.2-.2.4-.2.6-.1l1.9.9c.2.1.4.2.5.3.1.3.1.7-.1 1.4Z" /></svg></a>
      <a href={safeTelHref(guest?.phone)} title={t("Chiama")} className={`grid h-8 w-8 place-items-center rounded-lg bg-focus text-white ${guest?.phone ? "hover:opacity-90" : "pointer-events-none opacity-30"}`}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.5a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z" /></svg></a>
      <a href={safeMailtoHref(guest?.email) ?? "mailto:"} title="Email" className="grid h-8 w-8 place-items-center rounded-lg border border-line text-dim hover:bg-wash hover:text-txt"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg></a>
    </div>
  );

  // ── ANTEPRIMA compatta ──
  const previewBody = (
    <div className="flex flex-col gap-3 px-5 py-4">
      {guest && (gReturning || gVip || !!guest.preferences?.trim() || (guest.tags ?? []).length > 0) && (
        <div className="rounded-xl border p-3" style={{ borderColor: "color-mix(in srgb, var(--focus) 30%, var(--line))", backgroundColor: "color-mix(in srgb, var(--focus) 5%, transparent)" }}>
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">{t("Memoria ospite")}</span>
            {gVip && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ backgroundColor: "color-mix(in srgb, #D4A017 22%, transparent)", color: "#B8860B" }}>VIP</span>}
            {gReturning
              ? <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 16%, transparent)", color: "var(--focus)" }}>{t("Ospite di ritorno")} · {gTimes}ª {t("volta")}</span>
              : <span className="rounded-full bg-wash px-2 py-0.5 text-[10px] font-bold text-dim">{t("Primo soggiorno")}</span>}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-dim">
            <span>{gTimes} {gTimes === 1 ? t("soggiorno") : t("soggiorni")}</span>
            <span>{t("Speso")} {eur(gTotalSpent)}</span>
            {gLastPrior && <span>{t("Ultima volta")} {fmtDate(gLastPrior)}</span>}
          </div>
          {guest.preferences?.trim() && <div className="mt-1.5 text-sm text-txt"><span className="text-[11px] font-semibold text-dim">{t("Preferenze")}: </span>{guest.preferences}</div>}
          {(guest.tags ?? []).length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{(guest.tags ?? []).map((tg) => <span key={tg} className="rounded-full bg-wash px-2 py-0.5 text-[10px] text-dim">{t(tg)}</span>)}</div>}
          <button onClick={() => { closeBooking(); router.push(`/ospiti/${guest.id}`); }} className="mt-2 text-[11px] font-semibold text-focus hover:underline">{t("Apri scheda ospite")} →</button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <div><div className="text-[11px] font-medium text-dim">{t("Camera")}</div><div className="truncate text-sm text-txt">{roomType?.name ?? "—"}{unitV?.name ? ` · ${unitV.name}` : ""}</div></div>
        <div><div className="text-[11px] font-medium text-dim">{t("Ospiti")}</div><div className="text-sm text-txt">{booking.adults} {t("adulti")}{booking.children ? ` · ${booking.children} ${t("bambini")}` : ""}</div></div>
        <div><div className="text-[11px] font-medium text-dim">{t("Check-in")}</div><div className="text-sm text-txt">{fmtDate(booking.checkIn)}</div></div>
        <div><div className="text-[11px] font-medium text-dim">{t("Check-out")}</div><div className="text-sm text-txt">{fmtDate(booking.checkOut)}</div></div>
      </div>
      <div className="rounded-xl bg-wash px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm font-semibold text-txt">{netPayV && (dedV > 0 || accelV > 0) ? t("Lordo prima delle trattenute") : t("Totale ospite")}</span>
          <span className="inline-flex items-center gap-1.5">
            {underprice?.flagged && <span title={underpriceReason(booking, underprice)} className="font-sans text-base font-extrabold leading-none" style={{ color: "var(--err)" }}>!</span>}
            <span className="font-mono text-lg font-bold tabular-nums text-txt">{noPrice ? t("Prezzo mancante") : eur(grossV)}</span>
          </span>
        </div>
        {!noPrice && (commV > 0 || payFeeV > 0 || adjV > 0 || dedV > 0 || accelV > 0) && (
          <div className="mt-1.5 flex flex-col gap-0.5 border-t border-line pt-1.5 text-sm text-dim">
            {commV > 0 && <div className="flex items-baseline justify-between gap-4"><span>{t("Commissione OTA")}{commissionIsEstimate(booking) ? ` (${t("stima")})` : ""}{payFeeV <= 0 && adjV <= 0 ? ` · ${String(commPctStayV).replace(".", ",")}%` : ""}</span><span className="font-mono tabular-nums">−{eur(commV)}</span></div>}
            {payFeeV > 0 && <div className="flex items-baseline justify-between gap-4"><span>{t("Costo d'incasso")}</span><span className="font-mono tabular-nums">−{eur(payFeeV)}</span></div>}
            {adjV > 0 && <div className="flex items-baseline justify-between gap-4"><span>{t("Sconti OTA (carta virtuale)")}</span><span className="font-mono tabular-nums">−{eur(adjV)}</span></div>}
            {accelV > 0 && <div className="flex items-baseline justify-between gap-4"><span>{t("Acceleratore")}</span><span className="font-mono tabular-nums">−{eur(accelV)}</span></div>}
            {dedV > 0 && <div className="flex items-baseline justify-between gap-4"><span>{netPayV ? t("Commissione OTA") : t("Trattenute dichiarate dall'OTA")}</span><span className="font-mono tabular-nums">−{eur(dedV)}</span></div>}
            {commTotV > 0 && (payFeeV > 0 || adjV > 0) && <div className="flex items-baseline justify-between gap-4 text-[11px]"><span>{t("Totale costi")} ({String(commPctStayV).replace(".", ",")}%)</span><span className="font-mono tabular-nums">−{eur(commTotV)}</span></div>}
          </div>
        )}
        {!noPrice && (
          <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-line pt-1.5">
            <span className="text-sm font-semibold text-txt">{extrasV > 0 ? t("Netto del soggiorno") : netPayV && (dedV > 0 || accelV > 0) ? t("Netto (importo della carta virtuale)") : t("Incasso netto per te")}</span>
            <span className="font-mono text-lg font-bold tabular-nums" style={{ color: "var(--ok)" }}>{eur(nettoStayV)}</span>
          </div>
        )}
        {!noPrice && extrasV > 0 && (
          <>
            <div className="mt-1 flex items-baseline justify-between gap-4 text-sm text-dim"><span>{t("Extra e altre voci")}</span><span className="font-mono tabular-nums">+{eur(extrasV)}</span></div>
            <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-line pt-1.5">
              <span className="text-sm font-semibold text-txt">{t("Incasso netto per te")}</span>
              <span className="font-mono text-lg font-bold tabular-nums" style={{ color: "var(--ok)" }}>{eur(roundCents(nettoStayV + extrasV))}</span>
            </div>
          </>
        )}
        <div className="mt-2 border-t border-line pt-1.5" />
        {otaPaidV > 0 && <div className="mt-1 flex items-baseline justify-between gap-4"><span className="text-sm text-dim">{t("Pagato al portale")}</span><span className="font-mono text-sm font-semibold tabular-nums text-dim">{eur(otaPaidV)}</span></div>}
        <div className="mt-1 flex items-baseline justify-between gap-4"><span className="text-sm text-dim">{t("Incassato")}</span><span className="font-mono text-sm font-semibold tabular-nums" style={{ color: "var(--ok)" }}>{eur(Math.min(paidV, totalV))}</span></div>
        <div className="mt-1 flex items-baseline justify-between gap-4"><span className="text-sm text-dim">{t("Saldo dovuto")}</span><span className="font-mono text-sm font-bold tabular-nums" style={{ color: noPrice ? "var(--faint)" : dueV > 0 ? "var(--warn)" : "var(--ok)" }}>{noPrice ? "—" : dueV > 0 ? eur(dueV) : t("Saldato ✓")}</span></div>
        {extrasV > 0 && <div className="mt-1 flex items-baseline justify-between gap-4"><span className="text-sm text-dim">{t("di cui extra")}</span><span className="font-mono text-sm tabular-nums text-dim">{eur(extrasV)}</span></div>}
        <div className="mt-1.5">{payMethodRow}</div>
        {booking.nightlyRates && (
          <details className="mt-2 border-t border-line pt-2">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Dettaglio notte per notte")} ({t("da")} {CHANNELS[booking.channel]?.label ?? booking.channel})</summary>
            <div className="mt-1.5 space-y-0.5">
              {Array.from({ length: nights(booking.checkIn, booking.checkOut) }, (_, i) => shiftISO(booking.checkIn, i)).map((iso) => (
                <div key={iso} className="flex items-baseline justify-between gap-4 text-xs">
                  <span className="text-dim">{["dom", "lun", "mar", "mer", "gio", "ven", "sab"][parseISO(iso).getDay()]} {fmtDM(iso)}</span>
                  <span className="font-mono font-medium tabular-nums text-txt">{eur(nightlyRevenue(booking, iso))}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
      {booking.status !== "cancelled" && booking.channel !== "blocked" && <BookingMessageButtons booking={booking} guest={guest} structure={structure} />}
      <div className="rounded-xl border border-line">
        <button type="button" onClick={() => setPayOpen((v) => !v)} aria-expanded={payOpen} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
          <span className="flex items-center gap-2 text-sm font-semibold text-txt">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 text-dim transition-transform ${payOpen ? "" : "-rotate-90"}`}><path d="M6 9l6 6 6-6" /></svg>
            {t("Impostazioni dei pagamenti")}
          </span>
          {!noPrice && dueV > 0 && <span className="font-mono text-xs font-semibold tabular-nums" style={{ color: "var(--warn)" }}>{t("Da incassare")} {eur(dueV)}</span>}
        </button>
        {payOpen && <div className="flex flex-col gap-2 border-t border-line p-3">
      {dueV > 0 && (
        qa === "incasso"
          ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-wash p-2">
              <span className="text-xs text-dim">{t("Importo")} €</span>
              <NumInput value={incassoAmt} allowNull onChange={setIncassoAmt} placeholder="0" aria-label={t("Importo")} className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-right text-sm text-txt outline-none focus:border-focus" />
              <button onClick={() => setIncassoAmt(dueV)} className="rounded-md border border-line px-2 py-1 text-xs text-dim hover:bg-surface">{t("Saldo")} {eur(dueV)}</button>
              <select value={incassoMethod} onChange={(e) => setIncassoMethod(isPayMethod(e.target.value) ? e.target.value : "contanti")} aria-label={t("Pagato con")} className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-txt">{MANUAL_PAY_METHODS.map((m) => <option key={m} value={m}>{t(PAY_METHOD_LABEL[m])}</option>)}</select>
              <button onClick={registraIncasso} className="ml-auto rounded-md bg-focus px-3 py-1 text-xs font-semibold text-white hover:opacity-90">{t("Registra")}</button>
            </div>
          : <button onClick={() => setQa("incasso")} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-focus hover:bg-wash">💶 {t("Registra incasso")}</button>
      )}
      {qa === "extra"
        ? extraPanel
        : <button onClick={() => setQa("extra")} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-focus hover:bg-wash">＋ {t("Extra")} <span className="font-normal text-faint">· {t("animali, culla, letto aggiuntivo…")}</span></button>}
      {!noPrice && booking.status !== "cancelled" && <BookingBillActions booking={booking} structure={structure} guest={guest} />}
        </div>}
      </div>
      {departed && (() => {
        const first = guest?.fullName?.split(" ")[0] ?? "";
        const rmsg = renderSystemMessage("reviewQuick", guestLangOf(guest), { nome: first, struttura: structure?.name ?? "noi", link: reviewUrl ?? "" }).trim();
        const rwa = phoneDigits ? waSendUrl(phoneDigits, rmsg) : "";
        return (
          <div className="rounded-xl border p-3" style={{ borderColor: "color-mix(in srgb, var(--ok) 32%, var(--line))", backgroundColor: "color-mix(in srgb, var(--ok) 6%, transparent)" }}>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-faint">⭐ {t("Recensione Google")}</div>
            {reviewUrl ? (
              <>
                <p className="mb-2 text-[13px] text-dim">{t("Ospite in partenza: chiedi ora una recensione, aumenta il ranking.")}</p>
                <div className="flex flex-wrap gap-1.5">
                  <a href={rwa || undefined} target="_blank" rel="noopener noreferrer" onClick={() => { if (!booking.reviewRequestedAt) updateBooking(booking.id, { reviewRequestedAt: Date.now(), reviewRequestChannel: "whatsapp" }); }} className={`flex h-8 items-center rounded-lg px-3 text-sm font-semibold text-white ${phoneDigits ? "hover:opacity-90" : "pointer-events-none opacity-40"}`} style={{ backgroundColor: "#25D366" }}>WhatsApp</a>
                  <a href={safeMailtoHref(guest?.email) ? `${safeMailtoHref(guest?.email)}?subject=${encodeURIComponent("Grazie del soggiorno!")}&body=${encodeURIComponent(rmsg)}` : undefined} onClick={() => { if (!booking.reviewRequestedAt) updateBooking(booking.id, { reviewRequestedAt: Date.now(), reviewRequestChannel: "email" }); }} className={`flex h-8 items-center rounded-lg border border-line px-3 text-sm font-medium text-txt hover:bg-wash ${guest?.email ? "" : "pointer-events-none opacity-40"}`}>Email</a>
                  <button onClick={() => navigator.clipboard?.writeText(rmsg)} className="flex h-8 items-center rounded-lg border border-line px-3 text-sm font-medium text-txt hover:bg-wash">{t("Copia")}</button>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-dim">{t("Aggiungi il link recensioni Google nella")} <button onClick={() => { closeBooking(); router.push("/guida-ospiti"); }} className="font-semibold text-focus hover:underline">{t("Guida ospiti")}</button> {t("per chiedere le recensioni con un tap.")}</p>
            )}
          </div>
        );
      })()}
    </div>
  );

  const viewBody = (
    <>
      {/* Azioni rapide */}
      <div className="border-b border-line px-5 py-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button onClick={() => setQa(qa === "incasso" ? null : "incasso")} className={qaBtn} style={qa === "incasso" ? { borderColor: "var(--focus)", color: "var(--focus)" } : undefined}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>
            {t("Incasso")}
          </button>
          <button onClick={printReceipt} className={qaBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" /><path d="M9 7h6M9 11h6" /></svg>
            {t("Ricevuta")}
          </button>
          <button onClick={() => setQa(qa === "extra" ? null : "extra")} className={qaBtn} style={qa === "extra" ? { borderColor: "var(--focus)", color: "var(--focus)" } : undefined}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            {t("Extra")}
          </button>
          <button onClick={gestisciCheckin} className={qaBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 8v8a2 2 0 0 1-2 2h-6" /><path d="M4 12h11" /><path d="m11 8 4 4-4 4" /></svg>
            {t("Check-in")}
          </button>
        </div>
        {qa === "incasso" && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-wash p-2">
            <span className="text-xs text-dim">{t("Importo")} €</span>
            <NumInput value={incassoAmt} allowNull onChange={setIncassoAmt} placeholder="0" aria-label={t("Importo")} className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-right text-sm text-txt outline-none focus:border-focus" />
            {dueV > 0 && <button onClick={() => setIncassoAmt(dueV)} className="rounded-md border border-line px-2 py-1 text-xs text-dim hover:bg-surface">{t("Saldo")} {eur(dueV)}</button>}
              <select value={incassoMethod} onChange={(e) => setIncassoMethod(isPayMethod(e.target.value) ? e.target.value : "contanti")} aria-label={t("Pagato con")} className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-txt">{MANUAL_PAY_METHODS.map((m) => <option key={m} value={m}>{t(PAY_METHOD_LABEL[m])}</option>)}</select>
            <button onClick={registraIncasso} className="ml-auto rounded-md bg-focus px-3 py-1 text-xs font-semibold text-white hover:opacity-90">{t("Registra")}</button>
          </div>
        )}
        {extraPanel && <div className="mt-2">{extraPanel}</div>}
      </div>

      <Section title={t("Ospite")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 flex flex-col gap-2">
            <Row label={t("Email")} value={guest?.email ?? "—"} />
            <Row label={t("Telefono")} value={guest?.phone ?? "—"} mono />
            <Row label={t("Paese")} value={guest?.country ?? "—"} />
          </div>
          {contactIcons}
        </div>
      </Section>

      <Section title={t("Soggiorno")}>
        <Row label={t("Codice")} value={bookingCode(booking)} mono />
        <Row label={t("Canale")} value={directOriginOf(booking) ? directOriginLabel(directOriginOf(booking)!, structure?.name) : ch.label} icon={<BookingChannelLogo booking={booking} structure={structure} size={18} title={ch.label} />} />
        <Row label={t("Struttura")} value={structure?.name ?? "—"} />
        <Row label={t("Tipologia")} value={roomType?.name ?? "—"} />
        <Row label={t("Unità")} value={unitV?.name ?? t("Da assegnare")} />
        {effBedConfig && <Row label={t("Letti")} value={effBedConfig} />}
        {effSize ? <Row label={t("Superficie")} value={`${effSize} m²`} mono /> : null}
        <Row label={t("Ospiti")} value={`${booking.adults} ${t("adulti")} · ${booking.children} ${t("bambini")}`} />
      </Section>

      <Section title={t("Conto")}>
        <Row label={`${t("Soggiorno")} (${nView} ${t("notti")})`} value={eur(accV)} mono />
        <Row label={t("Pulizia")} value={eur(cleanV)} mono />
        {extrasList.map((e, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-dim">{e.name} <button onClick={() => removeExtra(i)} className="ml-1 text-faint hover:text-[color:var(--err)]" title={t("Rimuovi")}>✕</button></span>
            <span className="text-right font-mono text-sm text-txt">{eur(e.price)}</span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-dim">{t("Tassa di soggiorno")} {booking.cityTaxPaid && <span className="ml-1 rounded bg-[color:color-mix(in_srgb,var(--ok)_18%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--ok)]">{t("incassata")}</span>}</span>
          <span className="text-right font-mono text-sm text-txt">{eur(taxV)}</span>
        </div>
        {booking.depositPaid && <Row label={t("Caparra")} value={t("ricevuta ✓")} />}
        {booking.parking && <Row label={t("Parcheggio")} value={t("prenotato ✓")} />}
        <div className="mt-1 rounded-xl bg-wash px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm font-semibold text-txt">{t("Totale ospite")}</span>
            <span className="font-mono text-lg font-bold tabular-nums text-txt">{noPrice ? t("Prezzo mancante") : eur(totalV)}</span>
          </div>
          {otaPaidV > 0 && (
            <div className="mt-1.5 flex items-baseline justify-between gap-4 text-sm">
              <span className="text-dim">{t("Pagato al portale")}</span>
              <span className="font-mono tabular-nums text-dim">{eur(otaPaidV)}</span>
            </div>
          )}
          <div className="mt-1.5 flex items-baseline justify-between gap-4 text-sm">
            <span className="text-dim">{t("Incassato")}</span>
            <span className="font-mono tabular-nums text-dim">{eur(paidV)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-4">
            <span className="text-sm text-dim">{t("Saldo dovuto")}</span>
            <span className="font-mono text-sm font-bold tabular-nums" style={{ color: noPrice ? "var(--faint)" : dueV > 0 ? "var(--warn)" : "var(--ok)" }}>{noPrice ? "—" : dueV > 0 ? eur(dueV) : t("Saldato ✓")}</span>
          </div>
        </div>
        {payMethodRow}
        <div className="my-1 border-t border-line" />
        {commTotV > 0 && <Row label={`${t("Commissioni")} (${String(commPctV).replace(".", ",")}%)`} value={eur(commTotV)} mono />}
        {commV > 0 && (payFeeV > 0 || adjV > 0) && <Row label={`↳ ${t("Commissione")}`} value={eur(commV)} mono />}
        {payFeeV > 0 && <Row label={`↳ ${t("Costo incasso")}`} value={eur(payFeeV)} mono />}
        {adjV > 0 && <Row label={`↳ ${t("Sconti OTA (carta virtuale)")}`} value={eur(adjV)} mono />}
        <Row label={t("Netto struttura")} value={eur(nettoV)} mono strong />
      </Section>

      {booking.otaCard?.present && (() => {
        const c = booking.otaCard!;
        const fmtDate = (s?: string) => { if (!s) return null; return fmtDateIt(s) || s; };
        const eff = fmtDate(c.effectiveDate); const exp = fmtDate(c.expirationDate);
        return (
          <Section title={t("Carta virtuale OTA")}>
            <div className="rounded-xl border border-line bg-wash px-3 py-2.5 text-sm">
              {c.balance != null && (
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-dim">{t("Importo addebitabile")}</span>
                  <span className="font-mono font-bold tabular-nums text-txt">{c.balance.toFixed(2)} {c.currency || ""}</span>
                </div>
              )}
              {eff && <div className="mt-1 flex items-baseline justify-between gap-4"><span className="text-dim">{t("Addebitabile dal")}</span><span className="font-mono tabular-nums text-txt">{eff}</span></div>}
              {exp && <div className="mt-1 flex items-baseline justify-between gap-4"><span className="text-dim">{t("Scadenza carta")}</span><span className="font-mono tabular-nums text-txt">{exp}</span></div>}
              <p className="mt-2 text-[12px] leading-snug text-faint">
                {t("Per sicurezza (PCI) Xenora non mostra né salva il numero della carta. Addebitala dal tuo POS o dall'extranet del canale, poi segnala come addebitata qui sotto.")}
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm font-medium text-txt">
                <input type="checkbox" checked={!!c.charged} onChange={(e) => updateBooking(booking.id, { otaCard: { ...c, charged: e.target.checked } })} />
                {c.charged
                  ? <span className="rounded bg-[color:color-mix(in_srgb,var(--ok)_18%,transparent)] px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--ok)]">{t("Addebitata ✓")}</span>
                  : t("Segna come addebitata")}
              </label>
            </div>
          </Section>
        );
      })()}

      {booking.movedFrom && (
        <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 14%, transparent)" }}>
          <span className="font-bold" style={{ color: "var(--warn)" }}>⇄</span>
          <div className="min-w-0 flex-1 text-txt">
            {t("Prenotazione spostata da")} <b>{booking.movedFrom.structureName || t("un'altra struttura")}</b>
            <div className="text-[11px] text-dim">{fmtDateTime(booking.movedFrom.at)}</div>
          </div>
          <button onClick={() => updateBooking(booking.id, { movedFrom: undefined })} className="shrink-0 text-xs font-semibold text-dim hover:text-txt">{t("Nascondi")}</button>
        </div>
      )}

      {booking.note && (
        <Section title={t("Note")}><p className="whitespace-pre-wrap text-sm text-txt">{booking.note}</p></Section>
      )}

      {/* Dati letti dalla booking revision del canale (Channex): solo testo, mostrati se presenti. */}
      {(() => {
        const o = booking.otaInfo;
        const ages = booking.childAges && booking.childAges.length ? booking.childAges : undefined;
        const cancelTxt = describeCancelPenalties(o?.cancelPenalties);
        const pay = o?.paymentCollect === "ota" ? t("Pagato all'OTA (incassa il canale)") : o?.paymentCollect === "property" ? t("Da incassare dalla struttura") : undefined;
        const payType = o?.paymentType === "credit_card" ? t("carta di credito") : o?.paymentType === "bank_transfer" ? t("bonifico") : undefined;
        if (!o && !ages) return null;
        if (!ages && !cancelTxt && !pay && !payType && !o?.paymentInstruction && !o?.mealPlan && !o?.bedPreferences && !o?.smokingPreferences) return null;
        return (
          <Section title={t("Dati dal canale")}>
            {pay && <Row label={t("Pagamento")} value={payType ? `${pay} · ${payType}` : pay} />}
            {ages && <Row label={t("Età bambini")} value={ages.join(", ")} />}
            {o?.mealPlan && <Row label={t("Trattamento")} value={o.mealPlan} />}
            {o?.bedPreferences && <Row label={t("Letti")} value={o.bedPreferences} />}
            {o?.smokingPreferences && <Row label={t("Fumatori")} value={o.smokingPreferences} />}
            {cancelTxt && <Row label={t("Cancellazione")} value={cancelTxt} />}
            {o?.paymentInstruction && <p className="text-[12px] leading-snug text-dim">{o.paymentInstruction}</p>}
          </Section>
        );
      })()}

      <div ref={checkinRef} className="scroll-mt-2" />
      <Section title={t("Check-in online")}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-dim">{t("Stato")}</span>
          {booking.webCheckin
            ? <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }}>{t("Completato ✓")}</span>
            : <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: "var(--wash)", color: "var(--dim)" }}>{t("Da compilare")}</span>}
        </div>
        {booking.arrivalTime && booking.arrivalTime !== "Non lo so" && <Row label={t("Arrivo previsto")} value={booking.arrivalTime} />}
        {guest && (guest.docNumber || guest.birthDate || guest.citizenship) && (
          <div className="mt-2 rounded-lg border border-line bg-paper p-2.5">
            <div className="mb-1 text-xs font-semibold text-dim">{t("Dati ospite (documento)")}</div>
            <div className="flex flex-col">
              {(guest.firstName || guest.lastName || guest.fullName) && <Row label={t("Nominativo")} value={`${guest.firstName ?? ""} ${guest.lastName ?? ""}`.trim() || guest.fullName || "—"} />}
              {guest.sex && <Row label={t("Sesso")} value={guest.sex === "M" ? "M" : "F"} />}
              {(guest.birthDate || guest.birthPlace) && <Row label={t("Nascita")} value={[guest.birthDate ? fmtDate(guest.birthDate) : "", guest.birthPlace].filter(Boolean).join(" · ") || "—"} />}
              {guest.citizenship && <Row label={t("Cittadinanza")} value={guest.citizenship} />}
              {(guest.docType || guest.docNumber) && <Row label={t("Documento")} value={[guest.docType, guest.docNumber].filter(Boolean).join(" · ") || "—"} />}
              {guest.docPlace && <Row label={t("Rilasciato da")} value={guest.docPlace} />}
            </div>
          </div>
        )}
        {!booking.webCheckin && (() => {
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          const link = `${origin}/checkin?b=${booking.id}`;
          const ciMsg = (u: string) => renderSystemMessage("checkinShort", guestLangOf(guest), { nome: guest?.fullName ? guest.fullName.split(" ")[0] : "", struttura: structure?.name ?? "Xenora", link: u });
          const sendCiWa = async () => { if (!sendOnce(`ci:${booking.id}`)) return; const s = await shortenLink(link); const ciText = (await modelText("selfcheckin")) ?? ciMsg(s); window.open(waSendUrl(phoneDigits, ciText), "_blank", "noopener,noreferrer"); if (guest) { recordOutgoing(guest.id, ciText, "WhatsApp (link)", undefined, { bid: booking.id, rem: "checkin" }); markReminder(booking.id, "checkin"); } };
          const copyCi = async () => { const s = await shortenLink(link); try { await navigator.clipboard.writeText(s); } catch {} };
          if (!moduleOn("checkin")) return (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-wash px-3 py-2 text-[11px] text-dim">
              🔒 {t("Self check-in online disponibile nel piano Ultimate.")} <a href="/abbonamento" className="font-semibold text-focus hover:underline">{t("Vedi i piani")}</a>
            </div>
          );
          return (
            <div className="flex items-center gap-3 pt-0.5">
              {checkinQr && <img src={checkinQr} alt="QR" title={t("Inquadra per gestire la prenotazione")} className="h-16 w-16 shrink-0 rounded-lg border border-line" />}
              <div className="flex flex-1 flex-col gap-2">
                {phoneDigits && <button onClick={sendCiWa} className="rounded-lg py-2 text-center text-xs font-semibold text-white" style={{ backgroundColor: "#25D366" }}>{t("Invia link WhatsApp")}</button>}
                <button onClick={copyCi} className="rounded-lg border border-line py-2 text-center text-xs font-semibold text-txt hover:bg-wash">{t("Copia link")}</button>
              </div>
            </div>
          );
        })()}
        {/* Invia la guida ospite: link con camera + codici (per camera, filtrati dal parcheggio) */}
        {(() => {
          const groupBk = booking.groupId ? bookings.filter((x) => x.groupId === booking.groupId) : [booking];
          const gLink = groupBk.length > 1
            ? buildGroupGuestLink({ structureId: booking.structureId, guestName: guest?.fullName || "", lang: guestLangOf(guest), rooms: groupBk.map((bb) => ({ unitId: bb.unitId, unitCode: getUnit(bb.unitId)?.code || getUnit(bb.unitId)?.name || "", parking: !!bb.parking })) })
            : buildGuestLink({ structureId: booking.structureId, unitId: booking.unitId, unitCode: unitV?.code || unitV?.name || "", guestName: guest?.fullName || "", lang: guestLangOf(guest), parking: !!booking.parking });
          const guideSubject = `${t("La tua guida")} · ${structure?.name || "Xenora"}`;
          const gmailGuide = (msg: string) => guest?.email ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(guest.email)}&su=${encodeURIComponent(guideSubject)}&body=${encodeURIComponent(msg)}` : "";
          const guideMsgWith = (link: string) => guideMessage(booking.structureId, { name: guest?.fullName || "", link, structureName: structure?.name || "" });
          const sendGuideWa = async () => {
            if (!sendOnce(`guidewa:${booking.id}`)) return;
            const short = await shortenGuideLink(gLink);
            const gText = (await modelText("guida")) ?? guideMsgWith(short);
            window.open(waSendUrl(phoneDigits, gText), "_blank", "noopener,noreferrer");
            if (guest) { recordOutgoing(guest.id, gText, "WhatsApp (link)", undefined, { bid: booking.id, rem: "guide" }); markReminder(booking.id, "guide"); }
          };
          const sendGuideEmail = async () => {
            if (!guest?.email) { window.alert(t("L'ospite non ha un'email.")); return; }
            if (!sendOnce(`guideemail:${booking.id}`)) return;
            const to = guest.email;
            const short = await shortenGuideLink(gLink);
            const msg = (await modelText("guida")) ?? guideMsgWith(short);
            try {
              const r = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "guest_message", lang: guestLangOf(guest), to, subject: guideSubject, text: msg, accent: structure?.photoColor, replyTo: structure?.email, brand: { name: structure?.name, logo: structure?.logo, address: [structure?.address, structure?.streetNumber, structure?.city].filter(Boolean).join(" "), phone: structure?.phone, email: structure?.email, website: structure?.website, accent: structure?.photoColor, cin: structure?.cin, vat: structure?.vat } }) });
              const j = await r.json().catch(() => ({}));
              if (r.ok && j?.ok) { if (guest) { recordOutgoing(guest.id, msg, "Email", undefined, { bid: booking.id, rem: "guide" }); markReminder(booking.id, "guide"); } window.alert(`${t("Guida inviata a")} ${to}`); }
              else window.open(gmailGuide(msg), "_blank");
            } catch { window.open(gmailGuide(msg), "_blank"); }
          };
          const copyGuide = async () => { const short = await shortenGuideLink(gLink); try { await navigator.clipboard.writeText(short); } catch {} };
          return (
            <div className="mt-2 border-t border-line pt-3">
              <div className="mb-1 flex items-center gap-1.5 text-sm text-dim">📖 {t("Guida ospiti")}{!unitV && <span className="text-[11px]" style={{ color: "var(--warn)" }}>· {t("assegna la camera per i codici")}</span>}</div>
              <div className="flex flex-wrap gap-2">
                {phoneDigits && <button onClick={sendGuideWa} className="flex-1 rounded-lg py-2 text-center text-xs font-semibold text-white" style={{ backgroundColor: "#25D366" }}>{t("Invia guida")}</button>}
                <button onClick={sendGuideEmail} className="flex-1 rounded-lg py-2 text-center text-xs font-semibold text-white" style={{ backgroundColor: "#285f92" }}>{t("Email")}</button>
                <button onClick={copyGuide} className="flex-1 rounded-lg border border-line py-2 text-center text-xs font-semibold text-txt hover:bg-wash">{t("Copia link")}</button>
                <a href={gLink} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-line px-3 py-2 text-center text-xs font-semibold text-txt hover:bg-wash">↗</a>
              </div>
            </div>
          );
        })()}
        {(booking.docPhotoFront || booking.docPhotoBack) && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[booking.docPhotoFront, booking.docPhotoBack].filter(Boolean).map((src, i) => (
              <MediaLink key={i} src={src as string} className="block overflow-hidden rounded-lg border border-line"><MediaImg src={src as string} alt={t("Documento")} className="h-24 w-full object-cover" /></MediaLink>
            ))}
          </div>
        )}
        {booking.guestRequests && (
          <div className="mt-2 rounded-lg border border-line bg-wash p-2.5">
            <div className="mb-0.5 text-xs font-semibold text-dim">📝 {t("Note / richieste dell'ospite")}</div>
            <p className="whitespace-pre-wrap text-sm text-txt">{booking.guestRequests}</p>
          </div>
        )}
        {booking.extraGuests && booking.extraGuests.length > 0 && (
          <div className="mt-2">
            <div className="mb-1 text-xs font-semibold text-dim">{t("Ospiti aggiuntivi")} ({booking.extraGuests.length})</div>
            <div className="flex flex-col gap-1.5">
              {booking.extraGuests.map((eg, i) => (
                <div key={i} className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm">
                  <div className="font-medium text-txt">{[eg.firstName, eg.lastName].filter(Boolean).join(" ") || `${t("Ospite")} ${i + 2}`}</div>
                  <div className="mt-0.5 text-[11px] text-dim">{[eg.birthDate, eg.birthPlace, eg.citizenship].filter(Boolean).join(" · ")}{(eg.docType || eg.docNumber) ? ` · ${[eg.docType, eg.docNumber].filter(Boolean).join(" ")}` : ""}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {booking.signature && (
          <div className="mt-2">
            <div className="mb-1 text-xs text-dim">{t("Firma ospite")}</div>
            <MediaImg src={booking.signature} alt={t("Firma")} className="h-16 rounded-lg border border-line bg-white p-1" />
          </div>
        )}
      </Section>

      <Section title={t("Adempimenti")}>
        <AdempimentiPanel booking={booking} />
      </Section>

      {/* Segnalazioni a Booking.com (no-show / carta): si rende solo per prenotazioni Channex Booking.com */}
      {booking.channel === "booking" && booking.extId?.startsWith("channex:") && (
        <div className="border-b border-line px-5 py-3"><OtaReportMenu booking={booking} /></div>
      )}

      <Section title={t("Documenti")}>
        <button onClick={emitDocument} disabled={emit.busy} className="flex w-full items-center justify-between rounded-lg bg-focus px-3 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
          <span>{emit.busy ? t("Creazione…") : t("Emetti documento")}</span>
          <span className="text-xs opacity-90">{t("fattura elettronica")} →</span>
        </button>
        {emit.msg && <p className="text-[11px] text-[color:var(--err)]">{emit.msg}</p>}
        <p className="text-[11px] text-faint">{t("Fattura, ricevuta e nota di credito si gestiscono in")} <span className="font-semibold text-focus">Documenti fiscali</span>.</p>
      </Section>

      <div className="border-t border-line px-5 py-3">
        <button onClick={sendVoucherNow} disabled={voucher.sending} className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "#285f92" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v14H4z" /><path d="m4 6 8 6 8-6" /></svg>
          {voucher.sending ? t("Invio…") : t("Invia voucher / conferma")}
        </button>
        {voucher.msg && <div className={`mt-1.5 text-center text-[11px] ${voucher.ok ? "text-[color:var(--ok)]" : "text-[color:var(--err)]"}`}>{voucher.msg}</div>}
        <button onClick={() => { const gid = booking.guestId; closeBooking(); router.push(`/ospiti/${gid}`); }} className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-xs font-medium text-focus hover:bg-wash">{t("Scheda completa ospite")} →</button>
      </div>

      {/* Contenitore fuori schermo (MAI display:none, altrimenti html2canvas non lo cattura):
         anteprima reale del voucher, a piena risoluzione (scale=1), usata solo al momento
         dell'invio per generare il vero PDF allegato (vedi sendVoucherNow). Sempre montato così
         il ref è già pronto al click. Stessi dati inviati nell'email (voucherPayload), niente
         calcoli duplicati. */}
      <div aria-hidden="true" style={{ position: "fixed", left: -10000, top: 0, width: 794, zIndex: -1, pointerEvents: "none" }}>
        <div ref={voucherPdfRef} style={{ width: 794 }}>
          {(() => {
            const vp = voucherPayload(booking, { getStructure, getGuest, getRoomType, getUnit });
            const fmtLong = (iso?: string) => { if (!iso) return ""; return fmtDateIt(iso) || iso; };
            return (
              <VoucherDoc
                scale={1} accent={vp.color || "#285f92"} logo={vp.logo} structureName={vp.structureName || "Xenora"}
                address={vp.address || ""} contacts={[vp.phone, vp.structureEmail, vp.website].filter(Boolean).join("  ·  ")}
                legal={[vp.cin ? `CIN ${vp.cin}` : "", vp.vat ? `P.IVA ${vp.vat}` : ""].filter(Boolean).join(" · ")}
                code={vp.code} guestName={vp.guestName || ""} guestEmail={vp.guestEmail}
                roomType={vp.roomType || ""} unitName={vp.unitName} checkIn={fmtLong(vp.checkIn)} checkOut={fmtLong(vp.checkOut)}
                checkInFrom={vp.checkInFrom} checkOutBy={vp.checkOutBy} adults={vp.adults ?? 1} children={vp.children ?? 0}
                nights={vp.nights} ratePlan={vp.ratePlanName} total={typeof vp.grandTotal === "number" ? eur(vp.grandTotal, vp.currency || "€") : undefined}
                cancelText={vp.cancelPolicy || ""}
              />
            );
          })()}
        </div>
      </div>
    </>
  );

  // ─────────────── MODIFICA ───────────────
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const nEdit = form ? Math.max(0, nights(form.checkIn, form.checkOut)) : 0;
  const taxEdit = form ? cityTaxOfBookingRaw(structure, { adults: form.adults, children: form.children, childAges: booking.childAges, checkIn: form.checkIn, checkOut: form.checkOut, total: form.total, cityTaxExempt: form.cityTaxExempt }) : 0;
  // Totale ospite = soggiorno + pulizia + extra, come nella vista (la tassa di soggiorno si riscuote a parte e non rientra).
  const totalEdit = form ? form.total + form.cleaningFee + entriesTotal(form.extras) : 0;
  const pmEdit = effectivePayMethod(form ? { ...booking, channel: form.channel, paymentMethod: form.paymentMethod || undefined } : booking);
  const isOtaChannelE = form ? form.channel !== "direct" && form.channel !== "blocked" : false;
  const structUnits = sortUnitsByName(units.filter((u) => u.structureId === booking.structureId));

  const save = async () => {
    if (!form) return;
    // Sovrapposizione: consentita (come nel Calendario) ma segnalata, con conferma, se cambiano camera/date/stato.
    const placementChanged = form.unitId !== booking.unitId || form.checkIn !== booking.checkIn || form.checkOut !== booking.checkOut || form.status !== booking.status;
    if (placementChanged && form.unitId && form.status !== "cancelled" && form.status !== "no_show") {
      const clash = bookings.find((o) => o.id !== booking.id && o.unitId === form.unitId && o.status !== "cancelled" && o.status !== "no_show" && o.checkIn < form.checkOut && o.checkOut > form.checkIn);
      if (clash) {
        const who = getGuest(clash.guestId)?.fullName || t("Ospite");
        if (!(await ask({ title: t("Sovrapposizione"), message: `${t("La camera è già occupata da")} ${who} (${fmtDate(clash.checkIn)} → ${fmtDate(clash.checkOut)}). ${t("Salvare comunque?")}`, confirmLabel: t("Salva comunque") }))) return;
      }
    }
    const newUnit = form.unitId !== booking.unitId && form.unitId ? units.find((u) => u.id === form.unitId) : undefined;
    updateBooking(booking.id, {
      checkIn: form.checkIn, checkOut: form.checkOut, channel: form.channel, status: form.status,
      adults: form.adults, children: form.children, unitId: form.unitId,
      ...(newUnit ? { roomTypeId: newUnit.roomTypeId } : {}),
      total: form.total, cleaningFee: form.cleaningFee,
      commissionPct: form.commissionPct === (booking.commissionPct ?? defaultCommissionInfo(booking.channel, booking.structureId).pct) ? booking.commissionPct : form.commissionPct,
      commissionAmount: form.commissionAmount ?? undefined, paid: form.paid,
      ...(JSON.stringify(form.extras) !== JSON.stringify(booking.extras ?? []) ? { extras: form.extras } : {}),
      ...(pmEdit.auto ? {} : { paymentMethod: form.paymentMethod || undefined }),
      cityTaxExempt: form.cityTaxExempt, cityTaxPaid: form.cityTaxPaid, depositPaid: form.depositPaid, parking: form.parking,
      note: form.note.trim() || undefined, code: form.code.trim() || undefined, color: isHexColor(form.color) ? form.color : undefined,
    });
    updateGuest(booking.guestId, {
      firstName: form.firstName.trim() || undefined, lastName: form.lastName.trim() || undefined, fullName: `${form.firstName} ${form.lastName}`.trim() || undefined, email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined, country: form.country.trim() || undefined,
    });
    setSaved(true);
    setMode("view");
    window.setTimeout(() => setSaved(false), 2500);
  };

  const editBody = form && (
    <>
      <Section title={t("Ospite")}>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("Cognome")}><input className={inputCls} value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} /></Field>
          <Field label={t("Nome")}><input className={inputCls} value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("Telefono")}><input className={inputCls} value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+39…" /></Field>
          <Field label={t("Paese")}><input className={inputCls} value={form.country} onChange={(e) => set({ country: e.target.value })} /></Field>
        </div>
        <Field label={t("Email")}><input className={inputCls} value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="nome@email.it" /></Field>
        <div className="flex gap-2 pt-0.5">
          <ContactBtn href={form.phone.replace(/[^\d]/g, "") ? `https://wa.me/${form.phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(`Buongiorno${form.firstName ? " " + form.firstName : ""}, le scriviamo da ${structure?.name ?? "Xenora"} riguardo al soggiorno del ${fmtDate(form.checkIn)}.`)}` : undefined} label="WhatsApp" color="#25D366" missingTitle={t("Dato mancante")} />
          <ContactBtn href={safeTelHref(form.phone)} label={t("Chiama")} color="var(--focus)" missingTitle={t("Dato mancante")} />
          <ContactBtn href={safeMailtoHref(form.email) ?? "mailto:"} label={t("Email")} color="var(--dim)" missingTitle={t("Dato mancante")} />
        </div>
      </Section>

      <Section title={t("Soggiorno")}>
        <Row label={t("Struttura")} value={structure?.name ?? "—"} />
        <Field label={t("Unità")}>
          <select className={inputCls} value={form.unitId ?? ""} onChange={(e) => set({ unitId: e.target.value || null })}>
            <option value="">{t("Da assegnare")}</option>
            {structUnits.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("Check-in")}><DateField className={inputCls + " w-full text-left"} value={form.checkIn} onChange={(v) => set(v >= form.checkOut ? { checkIn: v, checkOut: shiftISO(v, 1) } : { checkIn: v })} /></Field>
          <Field label={t("Check-out")}><DateField className={inputCls + " w-full text-left"} value={form.checkOut} min={shiftISO(form.checkIn, 1)} onChange={(v) => set({ checkOut: v })} /></Field>
        </div>
        <div className="text-xs text-dim">{t("Durata")}: <b className="font-mono text-txt">{nEdit}</b> {nEdit === 1 ? t("notte") : t("notti")}</div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("Adulti")}><input type="number" min={0} className={inputCls} value={form.adults} onChange={(e) => set({ adults: Math.max(0, +e.target.value) })} /></Field>
          <Field label={t("Bambini")}><input type="number" min={0} className={inputCls} value={form.children} onChange={(e) => set({ children: Math.max(0, +e.target.value) })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("Canale")}>
            <select className={inputCls} value={form.channel} onChange={(e) => set({ channel: e.target.value as Channel })}>
              {(Object.keys(CHANNELS) as Channel[]).filter((c) => c !== "blocked").map((c) => (<option key={c} value={c}>{CHANNELS[c].label}</option>))}
            </select>
          </Field>
          <Field label={t("Stato")}>
            <select className={inputCls} value={form.status} onChange={(e) => set({ status: e.target.value as BookingStatus })}>
              {(Object.keys(STATUS) as BookingStatus[]).map((s) => (<option key={s} value={s}>{t(STATUS[s].label)}</option>))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title={t("Conto")}>
        <div className="grid grid-cols-2 gap-2">
          <Field label={`${t("Soggiorno")} (€)`}><NumInput className={inputCls} value={form.total} onChange={(v) => set({ total: v ?? 0 })} /></Field>
          <Field label={`${t("Pulizia")} (€)`}><NumInput className={inputCls} value={form.cleaningFee} onChange={(v) => set({ cleaningFee: v ?? 0 })} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label={`${t("Commissione")} (€)`}>
            <NumInput allowNull className={inputCls}
              value={form.commissionAmount ?? Math.round(form.total * form.commissionPct / 100)}
              onChange={(v) => set({ commissionAmount: v })} />
          </Field>
          <Field label={`${t("Commissione")} (%)`}><NumInput decimals={1} max={100} className={inputCls} value={commissionPctOf(form)} onChange={(v) => set({ commissionPct: v ?? 0, commissionAmount: null })} /></Field>
          <div className="flex flex-col justify-end">
            <span className="mb-1 block text-xs font-medium text-dim">{t("Netto (soggiorno − commissione)")}</span>
            <div className="rounded-lg border border-line bg-wash px-2.5 py-1.5 text-sm font-mono font-semibold text-[color:var(--ok)]">{eur(form.total - (form.commissionAmount ?? Math.round(form.total * form.commissionPct / 100)))}</div>
          </div>
        </div>
        {commissionIsEstimate(booking) && form.commissionAmount == null && <p className="rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>⚠ {COMMISSION_ESTIMATE_HINT}</p>}
        <p className="text-[11px] text-faint">{t("Se conosci la cifra esatta (es. da Booking.com) inseriscila in €: avrà sempre la priorità sulla %. Modificando la % l'importo esatto viene rimosso.")}</p>
        <Field label={t("Numero prenotazione (OTA)")}><input className={inputCls} value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder={t("es. 6400788454")} /></Field>
        <div className="rounded-lg border border-line bg-paper p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-txt">{t("Tassa di soggiorno")}</span>
            <span className="font-mono text-sm font-semibold text-txt">{eur(taxEdit)}</span>
          </div>
          <div className="mt-1 text-[11px] text-faint">{t("Non rientra nel totale: si riscuote in struttura")}</div>
          <div className="mt-1 text-xs text-dim">{form.cityTaxExempt ? t("Esente") : (structure?.cityTaxMode === "percent" ? `${structure.cityTaxPercent ?? 0}% ${t("del totale soggiorno")}` : `${form.adults} ${t("adulti")} × ${Math.min(nEdit, structure?.cityTaxMaxNights ?? 3)} ${t("notti")} × € ${structure?.cityTaxAmount ?? 2}`)}</div>
          <div className="mt-2 flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5 text-xs text-dim"><input type="checkbox" checked={form.cityTaxExempt} onChange={(e) => set({ cityTaxExempt: e.target.checked })} /> {t("Esente")}</label>
            <label className="flex items-center gap-1.5 text-xs text-dim"><input type="checkbox" checked={form.cityTaxPaid} onChange={(e) => set({ cityTaxPaid: e.target.checked })} /> {t("Incassata")}</label>
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-dim"><input type="checkbox" checked={form.depositPaid} onChange={(e) => set({ depositPaid: e.target.checked })} /> {t("Caparra ricevuta")}</label>
        <label className="flex items-center gap-1.5 text-xs text-dim"><input type="checkbox" checked={form.parking} onChange={(e) => set({ parking: e.target.checked })} /> {t("Parcheggio prenotato")}</label>
        <div className="grid grid-cols-2 gap-2">
          <Field label={`${t("Acconto incassato")} (€)`}><NumInput className={inputCls} value={form.paid} onChange={(v) => set({ paid: v ?? 0 })} /></Field>
          <div className="flex flex-col justify-end">
            <span className="mb-1 block text-xs font-medium text-dim">{t("Saldo dovuto")}</span>
            <div className="rounded-lg border border-line bg-wash px-2.5 py-1.5 font-mono text-sm font-semibold" style={{ color: Math.max(0, totalEdit - form.paid) > 0 ? "var(--warn)" : "var(--ok)" }}>{Math.max(0, totalEdit - form.paid) > 0 ? eur(totalEdit - form.paid) : t("Saldato ✓")}</div>
          </div>
        </div>
        <Field label={t("Incassato con")}>
          {pmEdit.auto
            ? <div className="rounded-lg border border-line bg-wash px-2.5 py-1.5 text-sm text-txt" title={t("Impostato in automatico: l'OTA incassa dall'ospite e poi versa alla struttura")}>{t(PAY_METHOD_LABEL.ota)}{otaPayDetail(booking) ? ` · ${t(otaPayDetail(booking) as string)}` : ""} · {t("automatico")}</div>
            : <select className={inputCls} value={form.paymentMethod} onChange={(e) => set({ paymentMethod: isPayMethod(e.target.value) ? e.target.value : "" })}>
                <option value="">{t("Da indicare")}</option>
                {[...MANUAL_PAY_METHODS, ...(isOtaChannelE ? (["ota"] as PayMethod[]) : [])].map((m) => <option key={m} value={m}>{t(PAY_METHOD_LABEL[m])}</option>)}
              </select>}
        </Field>
        <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
          <span className="text-sm font-semibold text-txt">{t("Totale ospite")}</span>
          <span className="font-mono text-lg font-bold text-txt">{eur(totalEdit)}</span>
        </div>
      </Section>

      <Section title={t("Extra")}>
        <BookingExtrasPicker entries={form.extras} onChange={(next) => set({ extras: next })} catalog={structure?.extras} stay={{ checkIn: form.checkIn, checkOut: form.checkOut, adults: form.adults }} onConfigure={() => { closeBooking(); router.push("/upselling?tab=catalogo"); }} />
      </Section>

      <Section title={t("Colore nel calendario")}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => set({ color: "" })} aria-label={t("Colore predefinito del canale")} title={t("Colore predefinito del canale")} className={`h-7 rounded-full border px-3 text-xs font-semibold ${!isHexColor(form.color) ? "border-focus text-focus" : "border-line text-dim hover:bg-wash"}`}>{t("Predefinito")}</button>
          {BOOKING_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => set({ color: c })} aria-label={`${t("Colore")} ${c}`} title={c} className="h-7 w-7 rounded-full border-2 transition hover:scale-110" style={{ backgroundColor: c, borderColor: form.color === c ? "var(--txt)" : "transparent" }} />
          ))}
          <label className="flex items-center gap-1.5 text-xs text-dim">
            <input id="booking-color-custom" type="color" value={isHexColor(form.color) ? form.color : "#2563eb"} onChange={(e) => set({ color: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent p-0.5" />
            {t("Personalizzato")}
          </label>
        </div>
        <p className="mt-1.5 text-[11px] text-faint">{t("Cambia solo il colore di questa prenotazione nel calendario. Premi Salva per applicarlo.")}</p>
      </Section>

      <Section title={t("Note")}>
        <textarea className={`${inputCls} min-h-[72px] resize-y`} value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder={t("Richieste particolari, orario di arrivo, promemoria interni…")} />
      </Section>

      <Section title={t("Zona pericolo")}>
        {groupSize > 1 && <button onClick={removeGroup} className="w-full rounded-lg px-3 py-2 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: "var(--err)" }}>{t("Elimina tutto il gruppo")} ({groupSize} {t("camere")})</button>}
        <button onClick={remove} className="w-full rounded-lg border border-line px-3 py-2 text-sm font-medium text-[color:var(--err)] hover:bg-[color:color-mix(in_srgb,var(--err)_10%,transparent)]">{groupSize > 1 ? t("Elimina solo questa camera") : t("Elimina prenotazione")}</button>
      </Section>
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label={t("Chiudi")} onClick={closeBooking} className="fixed inset-0 bg-black/40" />

      <div className="anim-slide-r relative z-10 flex h-full w-full max-w-[720px] flex-col overflow-hidden border-l border-line bg-surface shadow-2xl">
        {/* Accento canale */}
        <div className="h-1 w-full shrink-0" style={{ background: `var(${ch.cssVar})` }} />
        {/* Titolo del pannello */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <button onClick={closeBooking} aria-label={t("Chiudi")} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg text-dim hover:bg-wash hover:text-txt">✕</button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-txt">{t("Prenotazione")} {booking.code && booking.channel !== "direct" && booking.channel !== "blocked" ? channexCodeOf(booking.channel, bookingCode(booking)) : bookingCode(booking)}</h1>
          <button onClick={printSheet} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-txt hover:bg-wash">{t("Stampa")}</button>
        </div>
        {/* Schede */}
        <div ref={tabsRef} role="tablist" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 [scrollbar-width:none]">
          {PANEL_TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${tab === k ? "border-focus text-focus" : "border-transparent text-dim hover:text-txt"}`}>{t(label)}</button>
          ))}
        </div>

        {/* Intestazione: chi, quando, dove — solo nella scheda Gestione (le altre schede, come su Channex, partono direttamente dal contenuto) */}
        {tab === "manage" && (
        <div className="flex items-start gap-3 border-b border-line px-5 py-3 max-sm:flex-wrap">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold text-white shadow-sm" style={{ backgroundColor: `var(${ch.cssVar})` }}>{(guest?.fullName ?? "?").split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?"}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-display text-xl font-bold tracking-tight text-txt">{guest?.fullName ?? t("Ospite")}</h2>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `color-mix(in srgb, ${st.color} 14%, transparent)`, color: st.color }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.color }} />{t(st.label)}
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-dim">{roomType?.name}{unitV?.name ? ` · ${unitV.name}` : ""} · {fmtDate(booking.checkIn)} → {fmtDate(booking.checkOut)} · {nView} {nView === 1 ? t("notte") : t("notti")}</div>
            {(() => { const bd = birthdayInStay(guest?.birthDate, booking.checkIn, booking.checkOut); return bd ? (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, #DB2777 15%, transparent)", color: "#DB2777" }} title={t("Compleanno durante il soggiorno")}>
                <Icon name="cake" size={13} />{t("Compleanno")} {fmtDate(bd)}
              </span>
            ) : null; })()}
          </div>
          <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-end">
            {structure?.logo
              ? <img src={structure.logo} alt={structure?.name ?? ""} title={structure?.name} className="h-9 w-9 rounded-lg border border-line bg-white object-contain p-0.5" />
              : structure?.name
                ? <div className="grid h-9 w-9 place-items-center rounded-lg text-xs font-bold text-white" title={structure?.name} style={{ backgroundColor: structure?.photoColor || "#285f92" }}>{structure.name.slice(0, 2).toUpperCase()}</div>
                : null}
          </div>
        </div>
        )}

        {/* Avanzamento prenotazione (ispirato a Octorate, senza ripetizioni) */}
        {tab === "manage" && mode === "view" && (() => {
          const steps = [
            { label: t("Confermata"), done: booking.status === "confirmed" },
            { label: t("Check-in"), done: !!booking.webCheckin },
            { label: t("Incassata"), done: totalV > 0 && paidV + otaPaidV >= totalV },
            { label: t("Fatturata"), done: !!booking.invoiceNo },
          ];
          return (
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-line px-5 py-2 [scrollbar-width:none]">
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={s.done ? { backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" } : { backgroundColor: "var(--wash)", color: "var(--faint)" }}>
                    {s.done
                      ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                      : <span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-current text-[8px] leading-none">{i + 1}</span>}
                    {s.label}
                  </span>
                  {i < steps.length - 1 && <span className="h-px w-3 bg-line" />}
                </div>
              ))}
            </div>
          );
        })()}

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto">
          {tab === "manage"
            ? (mode === "edit" ? editBody : (expanded ? viewBody : previewBody))
            : tab === "info" ? <BookingInfoTab booking={booking} />
            : tab === "timeline" ? <BookingTimelineTab booking={booking} />
            : <BookingMessagesTab booking={booking} />}
        </div>

        {/* Barra azioni (solo nella scheda Gestione) */}
        {tab === "manage" && (mode === "edit" ? (
          <div className="flex items-center gap-3 border-t border-line bg-surface px-5 py-3">
            <button onClick={() => { loadForm(); setMode("view"); }} className="rounded-lg border border-line px-4 py-2 text-sm text-dim hover:bg-wash">{t("Annulla")}</button>
            <button onClick={save} className="ml-auto rounded-lg bg-focus px-5 py-2 text-sm font-semibold text-white hover:opacity-90">{t("Salva modifiche")}</button>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-t border-line bg-surface px-5 py-3 text-xs text-dim">
            {saved && <span className="font-medium text-[color:var(--ok)]">{t("Salvato ✓")}</span>}
            <button onClick={() => setExpanded((v) => !v)} className="mr-auto rounded-lg border border-line px-3 py-2 text-sm font-medium text-focus hover:bg-wash">{expanded ? `← ${t("Anteprima")}` : `${t("Dettagli")} →`}</button>
            <button onClick={closeBooking} className="rounded-lg border border-line px-4 py-2 text-sm text-dim hover:bg-wash">{t("Chiudi")}</button>
            <button onClick={() => { loadForm(); setMode("edit"); }} className="rounded-lg bg-focus px-5 py-2 text-sm font-semibold text-white hover:opacity-90">{t("Modifica")}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContactBtn({ href, label, color, missingTitle }: { href?: string; label: string; color: string; missingTitle?: string }) {
  if (!href) return (
    <span className="flex-1 cursor-not-allowed rounded-lg border border-line bg-paper py-2 text-center text-xs font-semibold text-faint" title={missingTitle}>{label}</span>
  );
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-lg py-2 text-center text-xs font-semibold text-white transition hover:opacity-90" style={{ backgroundColor: color }}>{label}</a>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line px-5 py-4">
      <div className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-faint">{title}</div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-dim">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value, mono, strong, icon }: { label: string; value: string; mono?: boolean; strong?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-dim">{label}</span>
      <span className={`${icon ? "flex items-center justify-end gap-1.5" : ""} text-right text-sm ${mono ? "font-mono tabular-nums" : ""} ${strong ? "font-bold text-txt" : "text-txt"}`}>{icon}{value}</span>
    </div>
  );
}
