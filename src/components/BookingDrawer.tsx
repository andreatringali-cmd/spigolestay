"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { sortUnitsByName } from "@/lib/sortUnits";
import { bookingCode } from "@/lib/bookingCode";
import { sendVoucher } from "@/lib/mailer";
import { buildGuestLink, buildGroupGuestLink, guideMessage, shortenGuideLink, shortenLink } from "@/lib/guestlink";
import { CHANNELS, type Channel, type BookingStatus, type Structure } from "@/lib/types";
import { nights, parseISO, shiftISO } from "@/lib/dates";
import { eur } from "@/lib/format";
import { buildFatturaPA } from "@/lib/fatturapa";
import { invPost } from "@/lib/invoicing/client";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import { useAccess } from "@/lib/access";
import Icon from "@/components/Icon";
import QRCode from "qrcode";

const fmtDate = (iso: string) =>
  parseISO(iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

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

// Tassa di soggiorno secondo le impostazioni struttura: fissa (€ a persona/notte, con tetto notti)
// oppure in percentuale sul totale soggiorno. Default: 2 €/persona/notte, max 3 notti.
const cityTaxOf = (structure: Structure | undefined, adults: number, n: number, accommodation: number, exempt?: boolean) => {
  if (exempt || !structure?.cityTax) return 0;
  if (structure.cityTaxMode === "percent") return Math.round((accommodation || 0) * (structure.cityTaxPercent ?? 0) / 100);
  const rate = structure.cityTaxAmount ?? 2;
  const maxN = structure.cityTaxMaxNights ?? 3;
  return Math.round(adults * Math.min(n, maxN) * rate);
};

interface Form {
  checkIn: string; checkOut: string;
  channel: Channel; status: BookingStatus;
  adults: number; children: number;
  unitId: string | null;
  total: number; cleaningFee: number; commissionPct: number; paid: number;
  cityTaxExempt: boolean; cityTaxPaid: boolean; depositPaid: boolean; parking: boolean;
  note: string;
  lastName: string; firstName: string; email: string; phone: string; country: string;
}

const inputCls = "w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus";

export default function BookingDrawer() {
  const {
    selectedBookingId, closeBooking, bookings, units,
    getGuest, getUnit, getStructure, getRoomType,
    updateBooking, updateGuest, deleteBooking, deleteBookingGroup,
  } = useData();

  const router = useRouter();
  const ask = useConfirm();
  const { t } = useLang();
  const { moduleOn } = useAccess();
  const booking = bookings.find((b) => b.id === selectedBookingId) ?? null;

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  const [voucher, setVoucher] = useState<{ sending?: boolean; ok?: boolean; msg?: string }>({});
  const [emit, setEmit] = useState<{ busy?: boolean; msg?: string }>({});
  const emitDocument = async () => {
    if (!booking) return;
    setEmit({ busy: true });
    try {
      const r = await invPost<{ documentId: string }>("create", { bookingId: booking.id });
      router.push(`/documenti/${r.documentId}`);
    } catch (e) { setEmit({ msg: e instanceof Error ? e.message : "Errore" }); }
  };
  const [checkinQr, setCheckinQr] = useState("");
  const [expanded, setExpanded] = useState(false); // false = anteprima, true = scheda intera
  const [qa, setQa] = useState<null | "incasso" | "extra">(null); // azione rapida aperta
  const [incassoAmt, setIncassoAmt] = useState("");
  const [extraName, setExtraName] = useState("");
  const [extraPrice, setExtraPrice] = useState("");
  const checkinRef = useRef<HTMLDivElement>(null);

  const loadForm = () => {
    if (!booking) { setForm(null); return; }
    const g = getGuest(booking.guestId);
    setForm({
      checkIn: booking.checkIn, checkOut: booking.checkOut,
      channel: booking.channel, status: booking.status,
      adults: booking.adults, children: booking.children,
      unitId: booking.unitId,
      total: booking.total ?? 0, cleaningFee: booking.cleaningFee ?? 35,
      commissionPct: booking.commissionPct ?? Math.round(CHANNELS[booking.channel].commission * 100),
      paid: booking.paid ?? 0,
      cityTaxExempt: !!booking.cityTaxExempt, cityTaxPaid: !!booking.cityTaxPaid, depositPaid: !!booking.depositPaid, parking: !!booking.parking,
      note: booking.note ?? "",
      lastName: g?.lastName ?? (g?.fullName ? g.fullName.split(" ").slice(1).join(" ") : ""),
      firstName: g?.firstName ?? (g?.fullName ? g.fullName.split(" ")[0] : ""),
      email: g?.email ?? "", phone: g?.phone ?? "", country: g?.country ?? "",
    });
  };

  // All'apertura di una prenotazione: torna in vista e ricarica i dati.
  useEffect(() => {
    setMode("view");
    setExpanded(false);
    setQa(null);
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
  const departed = booking.checkOut <= new Date().toISOString().slice(0, 10);
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
  const waText = encodeURIComponent(`Buongiorno${guest?.fullName ? " " + guest.fullName : ""}, le scriviamo da ${structure?.name ?? "Xenora"} riguardo al soggiorno del ${fmtDate(booking.checkIn)}.`);

  // ── Conto in sola lettura (dai dati salvati) ──
  const nView = nights(booking.checkIn, booking.checkOut);
  const accV = booking.total ?? nView * (roomType?.basePrice ?? 100);
  const cleanV = booking.cleaningFee ?? 0;
  const extrasList = booking.extras ?? [];
  const extrasV = extrasList.reduce((a, e) => a + (e.price || 0), 0);
  const taxV = cityTaxOf(structure, booking.adults, nView, accV, booking.cityTaxExempt);
  const totalV = accV + cleanV + extrasV + taxV;
  const commPctV = booking.commissionPct ?? Math.round(ch.commission * 100);
  const commV = Math.round(accV * commPctV / 100);
  const nettoV = accV - commV;
  const paidV = booking.paid ?? 0;
  const balanceV = Math.max(0, totalV - paidV);

  const printReceipt = () => {
    const w = window.open("", "_blank", "width=820,height=940");
    if (!w) return;
    const money = (x: number) => "€ " + x.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const today = new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
    const unitV = getUnit(booking.unitId);
    const rows: [string, string][] = [
      [`Soggiorno · ${nView} ${nView === 1 ? "notte" : "notti"} (${fmtDate(booking.checkIn)} → ${fmtDate(booking.checkOut)})`, money(accV)],
      ["Pulizia finale", money(cleanV)],
    ];
    if (taxV > 0) rows.push(["Tassa di soggiorno", money(taxV)]);
    w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Ricevuta ${bookingCode(booking)}</title>
    <style>
      *{box-sizing:border-box} body{font-family:Georgia,'Times New Roman',serif;color:#1a2131;margin:0;padding:48px 54px;font-size:14px;line-height:1.5}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #4f46e5;padding-bottom:18px;margin-bottom:26px}
      .brand{font-size:26px;font-weight:700;letter-spacing:-.4px;color:#4f46e5}
      .meta{font-size:12px;color:#5c6479;text-align:right;line-height:1.6}
      h1{font-size:15px;letter-spacing:2px;text-transform:uppercase;color:#5c6479;margin:0 0 4px}
      .sub{color:#5c6479;font-size:12px;margin-bottom:26px}
      .box{background:#f5f6fa;border:1px solid #e3e6ef;border-radius:10px;padding:16px 18px;margin-bottom:24px}
      .box b{display:block;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#9aa2b6;margin-bottom:4px;font-family:Arial,sans-serif}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      td{padding:11px 4px;border-bottom:1px solid #e3e6ef}
      td.amt{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
      tr.tot td{border-top:2px solid #1a2131;border-bottom:none;font-weight:700;font-size:17px;padding-top:14px}
      .note{margin-top:34px;font-size:11px;color:#9aa2b6;border-top:1px solid #e3e6ef;padding-top:14px}
      @media print{body{padding:24px 30px}}
    </style></head><body>
      <div class="head">
        <div>
          <div class="brand">${structure?.name ?? "Xenora"}</div>
          <div style="font-size:12px;color:#5c6479;margin-top:4px">${structure?.address ?? "Siracusa"}${structure?.phone ? " · " + structure.phone : ""}</div>
          ${structure?.cin ? `<div style="font-size:11px;color:#9aa2b6;margin-top:2px">CIN ${structure.cin}</div>` : ""}
        </div>
        <div class="meta">Ricevuta n. <b style="color:#1a2131">${bookingCode(booking)}</b><br>${today}</div>
      </div>
      <h1>Ricevuta di pagamento</h1>
      <div class="sub">Soggiorno turistico · ${ch.label}</div>
      <div class="box"><b>Ospite</b>${guest?.fullName ?? "—"}${guest?.email ? " · " + guest.email : ""}${guest?.phone ? " · " + guest.phone : ""}<br>
      <span style="color:#5c6479;font-size:13px">${roomType?.name ?? ""}${unitV?.name ? " — " + unitV.name : ""} · ${booking.adults} adulti${booking.children ? " · " + booking.children + " bambini" : ""}</span></div>
      <table>
        ${rows.map((r) => `<tr><td>${r[0]}</td><td class="amt">${r[1]}</td></tr>`).join("")}
        <tr class="tot"><td>Totale</td><td class="amt">${money(totalV)}</td></tr>
      </table>
      <div class="note">Documento non fiscale, rilasciato a titolo di ricevuta. La tassa di soggiorno è versata al Comune di Siracusa. ${structure?.name ?? "Xenora"}.</div>
      <script>window.onload=function(){window.print()}<\/script>
    </body></html>`);
    w.document.close();
  };

  const nextInvoiceNo = () => { try { const y = new Date().getFullYear(); const key = "spigolestay:invoicecounter"; const raw = JSON.parse(localStorage.getItem(key) || "{}"); const n = (raw.year === y ? raw.n : 0) + 1; localStorage.setItem(key, JSON.stringify({ year: y, n })); return `${n}/${y}`; } catch { return `1/${new Date().getFullYear()}`; } };

  // Fattura elettronica FatturaPA (XML SdI) — genera e scarica il file.
  const nextProgressivo = () => { try { const key = "spigolestay:sdiprog"; const n = (JSON.parse(localStorage.getItem(key) || "0") || 0) + 1; localStorage.setItem(key, JSON.stringify(n)); return String(n).padStart(5, "0"); } catch { return "00001"; } };
  const exportFatturaXml = () => {
    const no = booking.invoiceNo ?? nextInvoiceNo();
    if (!booking.invoiceNo) updateBooking(booking.id, { invoiceNo: no });
    const { xml, filename, warnings } = buildFatturaPA(booking, structure, guest, { accommodation: accV, cleaning: cleanV, cityTax: taxV }, no, nextProgressivo());
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (warnings.length) window.setTimeout(() => alert(t("Fattura elettronica generata come BOZZA.") + "\n\n" + warnings.join("\n") + "\n\n" + t("Completa i dati fiscali nella scheda struttura per un file pronto all'invio allo SdI.")), 100);
  };
  const printInvoice = () => {
    const w = window.open("", "_blank", "width=820,height=940");
    if (!w) return;
    const money = (x: number) => "€ " + x.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const no = booking.invoiceNo ?? nextInvoiceNo();
    if (!booking.invoiceNo) updateBooking(booking.id, { invoiceNo: no });
    const today = new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
    const unitV = getUnit(booking.unitId);
    const forfettario = !structure?.vat;
    const imponibile = forfettario ? accV + cleanV : Math.round((accV + cleanV) / 1.1);
    const ivaAmt = forfettario ? 0 : (accV + cleanV) - imponibile;
    const seller = structure?.businessName || structure?.name || "Xenora";
    const fiscal = [structure?.vat ? `P. IVA ${structure.vat}` : "", structure?.taxCode ? `C.F. ${structure.taxCode}` : "", structure?.sdi ? `SDI ${structure.sdi}` : "", structure?.pec ? `PEC ${structure.pec}` : ""].filter(Boolean).join(" · ");
    const rows: [string, string][] = [
      [`Soggiorno · ${nView} ${nView === 1 ? "notte" : "notti"} (${fmtDate(booking.checkIn)} → ${fmtDate(booking.checkOut)})`, money(forfettario ? accV : Math.round(accV / 1.1))],
      ["Pulizia finale", money(forfettario ? cleanV : Math.round(cleanV / 1.1))],
    ];
    w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Fattura ${no}</title>
    <style>
      *{box-sizing:border-box} body{font-family:Georgia,'Times New Roman',serif;color:#1a2131;margin:0;padding:44px 52px;font-size:13px;line-height:1.5}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #4f46e5;padding-bottom:16px;margin-bottom:22px}
      .brand{font-size:20px;font-weight:700;color:#1a2131}
      .small{font-size:11px;color:#5c6479;margin-top:3px;line-height:1.5}
      .doc{text-align:right} .doc h1{font-size:15px;letter-spacing:1px;text-transform:uppercase;color:#4f46e5;margin:0 0 4px}
      .grid2{display:flex;gap:16px;margin-bottom:22px}
      .box{flex:1;background:#f5f6fa;border:1px solid #e3e6ef;border-radius:8px;padding:12px 14px}
      .box b{display:block;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#9aa2b6;margin-bottom:4px;font-family:Arial,sans-serif}
      table{width:100%;border-collapse:collapse;margin-top:6px}
      th{font-family:Arial,sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9aa2b6;text-align:left;border-bottom:1px solid #e3e6ef;padding:8px 4px}
      td{padding:10px 4px;border-bottom:1px solid #eef0f6} td.amt{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
      tr.sum td{border:none;padding:4px 4px} tr.tot td{border-top:2px solid #1a2131;font-weight:700;font-size:16px;padding-top:12px}
      .note{margin-top:26px;font-size:10px;color:#9aa2b6;border-top:1px solid #e3e6ef;padding-top:12px;line-height:1.6}
      @media print{body{padding:22px 28px}}
    </style></head><body>
      <div class="head">
        <div><div class="brand">${seller}</div><div class="small">${structure?.address ?? ""}${structure?.postalCode ? ", " + structure.postalCode : ""} ${structure?.city ?? "Siracusa"}<br>${fiscal}</div></div>
        <div class="doc"><h1>Fattura</h1><div class="small">n. <b style="color:#1a2131">${no}</b><br>${today}</div></div>
      </div>
      <div class="grid2">
        <div class="box"><b>Cliente</b>${guest?.fullName ?? "—"}${guest?.email ? "<br>" + guest.email : ""}${guest?.phone ? "<br>" + guest.phone : ""}</div>
        <div class="box"><b>Riferimento</b>Prenotazione ${bookingCode(booking)}<br>${roomType?.name ?? ""}${unitV?.name ? " — " + unitV.name : ""}<br>${booking.adults} adulti${booking.children ? " · " + booking.children + " bambini" : ""}</div>
      </div>
      <table>
        <tr><th>Descrizione</th><th style="text-align:right">${forfettario ? "Importo" : "Imponibile"}</th></tr>
        ${rows.map((r) => `<tr><td>${r[0]}</td><td class="amt">${r[1]}</td></tr>`).join("")}
        <tr class="sum"><td>${forfettario ? "Totale imponibile" : "Imponibile"}</td><td class="amt">${money(imponibile)}</td></tr>
        ${forfettario ? "" : `<tr class="sum"><td>IVA 10%</td><td class="amt">${money(ivaAmt)}</td></tr>`}
        ${taxV > 0 ? `<tr class="sum"><td>Imposta di soggiorno (fuori campo IVA)</td><td class="amt">${money(taxV)}</td></tr>` : ""}
        <tr class="tot"><td>Totale documento</td><td class="amt">${money(totalV)}</td></tr>
      </table>
      <div class="note">
        ${forfettario ? "Operazione effettuata ai sensi dell'art. 1, commi 54-89, L. 190/2014 (regime forfettario): non soggetta a IVA né a ritenuta d'acconto." : "IVA assolta con aliquota 10% sui servizi di alloggio (n. 120 Tab. A parte III DPR 633/72)."}<br>
        Imposta di soggiorno riscossa in nome e per conto del Comune di ${structure?.cityTaxComune || structure?.city || "Siracusa"} — fuori campo IVA art. 4 DPR 633/72.<br>
        Documento emesso da ${seller}${booking.paid ? ` · Acconto già versato: ${money(Math.min(booking.paid, totalV))}` : ""}.
      </div>
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
    setVoucher({ sending: true });
    const r = await sendVoucher(booking, { getStructure, getGuest, getRoomType, getUnit });
    setVoucher({ sending: false, ok: r.ok, msg: r.ok ? t("Voucher inviato a") + " " + guest.email : r.error });
  };

  // ─────────────── VISTA (sola lettura) ───────────────
  const registraIncasso = () => { const amt = Math.round(Number(incassoAmt) * 100) / 100; if (!amt) return; updateBooking(booking.id, { paid: paidV + amt }); setIncassoAmt(""); setQa(null); };
  const aggiungiExtra = () => { const p = Math.round(Number(extraPrice) * 100) / 100; if (!extraName.trim() || !p) return; updateBooking(booking.id, { extras: [...extrasList, { name: extraName.trim(), price: p }] }); setExtraName(""); setExtraPrice(""); setQa(null); };
  const removeExtra = (i: number) => updateBooking(booking.id, { extras: extrasList.filter((_, j) => j !== i) });
  const gestisciCheckin = () => { setQa(null); setTimeout(() => checkinRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); };
  const qaBtn = "flex flex-col items-center gap-1 rounded-xl border border-line bg-paper px-2 py-2.5 text-[11px] font-semibold text-txt transition hover:border-focus hover:bg-wash";

  const contactIcons = (
    <div className="flex shrink-0 gap-1.5">
      <a href={phoneDigits ? `https://wa.me/${phoneDigits}?text=${waText}` : undefined} target="_blank" rel="noopener noreferrer" title="WhatsApp" className={`grid h-8 w-8 place-items-center rounded-lg text-white ${phoneDigits ? "hover:opacity-90" : "pointer-events-none opacity-30"}`} style={{ backgroundColor: "#25D366" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.4-.7-2.9-1.2-4.7-4.1-4.8-4.3-.1-.2-1.1-1.5-1.1-2.9 0-1.3.7-2 1-2.3.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.1.1.3 0 .5l-.4.6c-.1.2-.3.3-.1.6.1.3.7 1.1 1.5 1.8 1 .9 1.8 1.1 2.1 1.3.3.1.4.1.6-.1l.7-.9c.2-.2.4-.2.6-.1l1.9.9c.2.1.4.2.5.3.1.3.1.7-.1 1.4Z" /></svg></a>
      <a href={guest?.phone ? `tel:${guest.phone}` : undefined} title={t("Chiama")} className={`grid h-8 w-8 place-items-center rounded-lg bg-focus text-white ${guest?.phone ? "hover:opacity-90" : "pointer-events-none opacity-30"}`}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.5a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z" /></svg></a>
      <a href={`mailto:${guest?.email ?? ""}`} title="Email" className="grid h-8 w-8 place-items-center rounded-lg border border-line text-dim hover:bg-wash hover:text-txt"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg></a>
    </div>
  );

  // ── ANTEPRIMA compatta ──
  const previewBody = (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-faint">{t("Contatti")}</span>
        {contactIcons}
      </div>
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
        <div className="flex items-baseline justify-between gap-4"><span className="text-sm font-semibold text-txt">{t("Totale ospite")}</span><span className="font-mono text-lg font-bold tabular-nums text-txt">{eur(totalV)}</span></div>
        <div className="mt-1 flex items-baseline justify-between gap-4"><span className="text-sm text-dim">{t("Saldo dovuto")}</span><span className="font-mono text-sm font-bold tabular-nums" style={{ color: balanceV > 0 ? "var(--warn)" : "var(--ok)" }}>{balanceV > 0 ? eur(balanceV) : t("Saldato ✓")}</span></div>
      </div>
      {balanceV > 0 && (
        qa === "incasso"
          ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-wash p-2">
              <span className="text-xs text-dim">{t("Importo")} €</span>
              <input type="number" min={0} value={incassoAmt} onChange={(e) => setIncassoAmt(e.target.value)} placeholder="0" className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus" />
              <button onClick={() => setIncassoAmt(String(balanceV))} className="rounded-md border border-line px-2 py-1 text-xs text-dim hover:bg-surface">{t("Saldo")} {eur(balanceV)}</button>
              <button onClick={registraIncasso} className="ml-auto rounded-md bg-focus px-3 py-1 text-xs font-semibold text-white hover:opacity-90">{t("Registra")}</button>
            </div>
          : <button onClick={() => setQa("incasso")} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-focus hover:bg-wash">💶 {t("Registra incasso")}</button>
      )}
      {departed && (() => {
        const first = guest?.fullName?.split(" ")[0] ?? "";
        const rmsg = `Grazie ${first} per aver soggiornato da ${structure?.name ?? "noi"}! Se ti sei trovato bene, ci lasceresti una recensione su Google? Ci aiuta tantissimo. ${reviewUrl}`.trim();
        const rwa = phoneDigits ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(rmsg)}` : "";
        return (
          <div className="rounded-xl border p-3" style={{ borderColor: "color-mix(in srgb, var(--ok) 32%, var(--line))", backgroundColor: "color-mix(in srgb, var(--ok) 6%, transparent)" }}>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-faint">⭐ {t("Recensione Google")}</div>
            {reviewUrl ? (
              <>
                <p className="mb-2 text-[13px] text-dim">{t("Ospite in partenza: chiedi ora una recensione, aumenta il ranking.")}</p>
                <div className="flex flex-wrap gap-1.5">
                  <a href={rwa || undefined} target="_blank" rel="noopener noreferrer" className={`flex h-8 items-center rounded-lg px-3 text-sm font-semibold text-white ${phoneDigits ? "hover:opacity-90" : "pointer-events-none opacity-40"}`} style={{ backgroundColor: "#25D366" }}>WhatsApp</a>
                  <a href={guest?.email ? `mailto:${guest.email}?subject=${encodeURIComponent("Grazie del soggiorno!")}&body=${encodeURIComponent(rmsg)}` : undefined} className={`flex h-8 items-center rounded-lg border border-line px-3 text-sm font-medium text-txt hover:bg-wash ${guest?.email ? "" : "pointer-events-none opacity-40"}`}>Email</a>
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
            <input type="number" min={0} value={incassoAmt} onChange={(e) => setIncassoAmt(e.target.value)} placeholder="0" className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus" />
            {balanceV > 0 && <button onClick={() => setIncassoAmt(String(balanceV))} className="rounded-md border border-line px-2 py-1 text-xs text-dim hover:bg-surface">{t("Saldo")} {eur(balanceV)}</button>}
            <button onClick={registraIncasso} className="ml-auto rounded-md bg-focus px-3 py-1 text-xs font-semibold text-white hover:opacity-90">{t("Registra")}</button>
          </div>
        )}
        {qa === "extra" && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-wash p-2">
            <input value={extraName} onChange={(e) => setExtraName(e.target.value)} placeholder={t("Descrizione (es. Transfer)")} className="min-w-[140px] flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus" />
            <input type="number" min={0} value={extraPrice} onChange={(e) => setExtraPrice(e.target.value)} placeholder="€" className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus" />
            <button onClick={aggiungiExtra} className="rounded-md bg-focus px-3 py-1 text-xs font-semibold text-white hover:opacity-90">{t("Aggiungi")}</button>
          </div>
        )}
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
        <Row label={t("Canale")} value={ch.label} />
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
            <span className="font-mono text-lg font-bold tabular-nums text-txt">{eur(totalV)}</span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-4 text-sm">
            <span className="text-dim">{t("Incassato")}</span>
            <span className="font-mono tabular-nums text-dim">{eur(paidV)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-4">
            <span className="text-sm text-dim">{t("Saldo dovuto")}</span>
            <span className="font-mono text-sm font-bold tabular-nums" style={{ color: balanceV > 0 ? "var(--warn)" : "var(--ok)" }}>{balanceV > 0 ? eur(balanceV) : t("Saldato ✓")}</span>
          </div>
        </div>
        <div className="my-1 border-t border-line" />
        {commV > 0 && <Row label={`${t("Commissione")} (${commPctV}%)`} value={eur(commV)} mono />}
        <Row label={t("Netto struttura")} value={eur(nettoV)} mono strong />
      </Section>

      {booking.movedFrom && (
        <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 14%, transparent)" }}>
          <span className="font-bold" style={{ color: "var(--warn)" }}>⇄</span>
          <div className="min-w-0 flex-1 text-txt">
            {t("Prenotazione spostata da")} <b>{booking.movedFrom.structureName || t("un'altra struttura")}</b>
            <div className="text-[11px] text-dim">{new Date(booking.movedFrom.at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
          </div>
          <button onClick={() => updateBooking(booking.id, { movedFrom: undefined })} className="shrink-0 text-xs font-semibold text-dim hover:text-txt">{t("Nascondi")}</button>
        </div>
      )}

      {booking.note && (
        <Section title={t("Note")}><p className="whitespace-pre-wrap text-sm text-txt">{booking.note}</p></Section>
      )}

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
          const ciMsg = (u: string) => `Buongiorno${guest?.fullName ? " " + guest.fullName.split(" ")[0] : ""}, per velocizzare l'arrivo a ${structure?.name ?? "Xenora"} completa il check-in online qui: ${u}`;
          const sendCiWa = async () => { const s = await shortenLink(link); window.open(`https://wa.me/${phoneDigits}?text=${encodeURIComponent(ciMsg(s))}`, "_blank", "noopener,noreferrer"); };
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
            ? buildGroupGuestLink({ structureId: booking.structureId, guestName: guest?.fullName || "", rooms: groupBk.map((bb) => ({ unitId: bb.unitId, unitCode: getUnit(bb.unitId)?.code || getUnit(bb.unitId)?.name || "", parking: !!bb.parking })) })
            : buildGuestLink({ structureId: booking.structureId, unitId: booking.unitId, unitCode: unitV?.code || unitV?.name || "", guestName: guest?.fullName || "", parking: !!booking.parking });
          const guideSubject = `${t("La tua guida")} · ${structure?.name || "Xenora"}`;
          const gmailGuide = (msg: string) => guest?.email ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(guest.email)}&su=${encodeURIComponent(guideSubject)}&body=${encodeURIComponent(msg)}` : "";
          const guideMsgWith = (link: string) => guideMessage(booking.structureId, { name: guest?.fullName || "", link, structureName: structure?.name || "" });
          const sendGuideWa = async () => {
            const short = await shortenGuideLink(gLink);
            window.open(`https://wa.me/${phoneDigits}?text=${encodeURIComponent(guideMsgWith(short))}`, "_blank", "noopener,noreferrer");
          };
          const sendGuideEmail = async () => {
            if (!guest?.email) { window.alert(t("L'ospite non ha un'email.")); return; }
            const to = guest.email;
            const short = await shortenGuideLink(gLink);
            const msg = guideMsgWith(short);
            try {
              const r = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "quote", to, subject: guideSubject, text: msg, accent: structure?.photoColor, replyTo: structure?.email }) });
              const j = await r.json().catch(() => ({}));
              if (r.ok && j?.ok) window.alert(`${t("Guida inviata a")} ${to}`);
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
              /* eslint-disable-next-line @next/next/no-img-element */
              <a key={i} href={src as string} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line"><img src={src as string} alt={t("Documento")} className="h-24 w-full object-cover" /></a>
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={booking.signature} alt={t("Firma")} className="h-16 rounded-lg border border-line bg-white p-1" />
          </div>
        )}
      </Section>

      <Section title={t("Documenti")}>
        <button onClick={emitDocument} disabled={emit.busy} className="flex w-full items-center justify-between rounded-lg bg-focus px-3 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
          <span>{emit.busy ? t("Creazione…") : t("Emetti documento")}</span>
          <span className="text-xs opacity-90">{t("fattura elettronica")} →</span>
        </button>
        {emit.msg && <p className="text-[11px] text-[color:var(--err)]">{emit.msg}</p>}
        <button onClick={printReceipt} className="flex w-full items-center justify-between rounded-lg border border-line bg-paper px-3 py-2.5 text-sm font-medium text-txt hover:border-focus hover:bg-wash">
          <span>{t("Ricevuta su carta intestata")}</span>
          <span className="text-xs text-dim">{t("PDF / Stampa")} →</span>
        </button>
        <button onClick={printInvoice} className="flex w-full items-center justify-between rounded-lg border border-line bg-paper px-3 py-2.5 text-sm font-medium text-txt hover:border-focus hover:bg-wash">
          <span>{t("Fattura")}{booking.invoiceNo ? ` n. ${booking.invoiceNo}` : ""}</span>
          <span className="text-xs text-dim">{t("PDF / Stampa")} →</span>
        </button>
        <button onClick={exportFatturaXml} className="flex w-full items-center justify-between rounded-lg border border-line bg-paper px-3 py-2.5 text-sm font-medium text-txt hover:border-focus hover:bg-wash">
          <span>{t("Fattura elettronica")} <span className="text-[10px] font-bold uppercase text-focus">FatturaPA · SdI</span></span>
          <span className="text-xs text-dim">{t("Scarica XML")} →</span>
        </button>
      </Section>

      <div className="border-t border-line px-5 py-3">
        <button onClick={sendVoucherNow} disabled={voucher.sending} className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "#285f92" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v14H4z" /><path d="m4 6 8 6 8-6" /></svg>
          {voucher.sending ? t("Invio…") : t("Invia voucher / conferma")}
        </button>
        {voucher.msg && <div className={`mt-1.5 text-center text-[11px] ${voucher.ok ? "text-[color:var(--ok)]" : "text-[color:var(--err)]"}`}>{voucher.msg}</div>}
        <button onClick={() => { const gid = booking.guestId; closeBooking(); router.push(`/ospiti/${gid}`); }} className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-xs font-medium text-focus hover:bg-wash">{t("Scheda completa ospite")} →</button>
      </div>
    </>
  );

  // ─────────────── MODIFICA ───────────────
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const nEdit = form ? Math.max(0, nights(form.checkIn, form.checkOut)) : 0;
  const taxEdit = form ? cityTaxOf(structure, form.adults, nEdit, form.total, form.cityTaxExempt) : 0;
  const totalEdit = form ? form.total + form.cleaningFee + taxEdit : 0;
  const structUnits = sortUnitsByName(units.filter((u) => u.structureId === booking.structureId));

  const save = () => {
    if (!form) return;
    updateBooking(booking.id, {
      checkIn: form.checkIn, checkOut: form.checkOut, channel: form.channel, status: form.status,
      adults: form.adults, children: form.children, unitId: form.unitId,
      total: form.total, cleaningFee: form.cleaningFee, commissionPct: form.commissionPct, paid: form.paid,
      cityTaxExempt: form.cityTaxExempt, cityTaxPaid: form.cityTaxPaid, depositPaid: form.depositPaid, parking: form.parking,
      note: form.note.trim() || undefined,
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
          <ContactBtn href={form.phone ? `tel:${form.phone}` : undefined} label={t("Chiama")} color="var(--focus)" missingTitle={t("Dato mancante")} />
          <ContactBtn href={`mailto:${form.email ?? ""}`} label={t("Email")} color="var(--dim)" missingTitle={t("Dato mancante")} />
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
          <Field label={t("Check-in")}><input type="date" className={inputCls} value={form.checkIn} onChange={(e) => set(e.target.value >= form.checkOut ? { checkIn: e.target.value, checkOut: shiftISO(e.target.value, 1) } : { checkIn: e.target.value })} /></Field>
          <Field label={t("Check-out")}><input type="date" className={inputCls} value={form.checkOut} min={shiftISO(form.checkIn, 1)} onChange={(e) => set({ checkOut: e.target.value })} /></Field>
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
          <Field label={`${t("Soggiorno")} (€)`}><input type="number" min={0} className={inputCls} value={form.total} onChange={(e) => set({ total: Math.max(0, +e.target.value) })} /></Field>
          <Field label={`${t("Pulizia")} (€)`}><input type="number" min={0} className={inputCls} value={form.cleaningFee} onChange={(e) => set({ cleaningFee: Math.max(0, +e.target.value) })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={`${t("Commissione")} (%)`}><input type="number" min={0} max={100} step={0.5} className={inputCls} value={form.commissionPct} onChange={(e) => set({ commissionPct: Math.max(0, Math.min(100, +e.target.value)) })} /></Field>
          <div className="flex flex-col justify-end">
            <span className="mb-1 block text-xs font-medium text-dim">{t("Netto (soggiorno − commissione)")}</span>
            <div className="rounded-lg border border-line bg-wash px-2.5 py-1.5 text-sm font-mono font-semibold text-[color:var(--ok)]">{eur(form.total - Math.round(form.total * form.commissionPct / 100))}</div>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-paper p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-txt">{t("Tassa di soggiorno")}</span>
            <span className="font-mono text-sm font-semibold text-txt">{eur(taxEdit)}</span>
          </div>
          <div className="mt-1 text-xs text-dim">{form.cityTaxExempt ? t("Esente") : (structure?.cityTaxMode === "percent" ? `${structure.cityTaxPercent ?? 0}% ${t("del totale soggiorno")}` : `${form.adults} ${t("adulti")} × ${Math.min(nEdit, structure?.cityTaxMaxNights ?? 3)} ${t("notti")} × € ${structure?.cityTaxAmount ?? 2}`)}</div>
          <div className="mt-2 flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5 text-xs text-dim"><input type="checkbox" checked={form.cityTaxExempt} onChange={(e) => set({ cityTaxExempt: e.target.checked })} /> {t("Esente")}</label>
            <label className="flex items-center gap-1.5 text-xs text-dim"><input type="checkbox" checked={form.cityTaxPaid} onChange={(e) => set({ cityTaxPaid: e.target.checked })} /> {t("Incassata")}</label>
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-dim"><input type="checkbox" checked={form.depositPaid} onChange={(e) => set({ depositPaid: e.target.checked })} /> {t("Caparra ricevuta")}</label>
        <label className="flex items-center gap-1.5 text-xs text-dim"><input type="checkbox" checked={form.parking} onChange={(e) => set({ parking: e.target.checked })} /> {t("Parcheggio prenotato")}</label>
        <div className="grid grid-cols-2 gap-2">
          <Field label={`${t("Acconto incassato")} (€)`}><input type="number" min={0} className={inputCls} value={form.paid} onChange={(e) => set({ paid: Math.max(0, +e.target.value) })} /></Field>
          <div className="flex flex-col justify-end">
            <span className="mb-1 block text-xs font-medium text-dim">{t("Saldo dovuto")}</span>
            <div className="rounded-lg border border-line bg-wash px-2.5 py-1.5 font-mono text-sm font-semibold" style={{ color: Math.max(0, totalEdit - form.paid) > 0 ? "var(--warn)" : "var(--ok)" }}>{Math.max(0, totalEdit - form.paid) > 0 ? eur(totalEdit - form.paid) : t("Saldato ✓")}</div>
          </div>
        </div>
        <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
          <span className="text-sm font-semibold text-txt">{t("Totale ospite")}</span>
          <span className="font-mono text-lg font-bold text-txt">{eur(totalEdit)}</span>
        </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button aria-label={t("Chiudi")} onClick={closeBooking} className="fixed inset-0 bg-black/40" />

      <div className={`anim-in relative z-10 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl transition-[max-width] ${expanded || mode === "edit" ? "max-w-2xl" : "max-w-md"}`}>
        {/* Accento canale */}
        <div className="h-1 w-full shrink-0" style={{ background: `var(${ch.cssVar})` }} />
        {/* Intestazione */}
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold text-white shadow-sm" style={{ backgroundColor: `var(${ch.cssVar})` }}>{(guest?.fullName ?? "?").split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?"}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-display text-2xl font-bold tracking-tight text-txt">{guest?.fullName ?? t("Ospite")}</h2>
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
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={closeBooking} aria-label={t("Chiudi")} className="grid h-8 w-8 place-items-center rounded-lg text-dim hover:bg-wash hover:text-txt">✕</button>
          </div>
        </div>

        {/* Avanzamento prenotazione (ispirato a Octorate, senza ripetizioni) */}
        {mode === "view" && (() => {
          const steps = [
            { label: t("Confermata"), done: booking.status === "confirmed" },
            { label: t("Check-in"), done: !!booking.webCheckin },
            { label: t("Incassata"), done: totalV > 0 && paidV >= totalV },
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
        <div className="flex-1 overflow-y-auto">{mode === "edit" ? editBody : (expanded ? viewBody : previewBody)}</div>

        {/* Barra azioni */}
        {mode === "edit" ? (
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
        )}
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

function Row({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-dim">{label}</span>
      <span className={`text-right text-sm ${mono ? "font-mono tabular-nums" : ""} ${strong ? "font-bold text-txt" : "text-txt"}`}>{value}</span>
    </div>
  );
}
