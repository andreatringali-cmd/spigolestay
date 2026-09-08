"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { sortUnitsByName } from "@/lib/sortUnits";
import { bookingCode } from "@/lib/bookingCode";
import { sendVoucher } from "@/lib/mailer";
import { CHANNELS, type Channel, type BookingStatus, type Structure } from "@/lib/types";
import { nights, parseISO } from "@/lib/dates";
import { eur } from "@/lib/format";
import { buildFatturaPA } from "@/lib/fatturapa";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import Icon from "@/components/Icon";

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
  cityTaxExempt: boolean; cityTaxPaid: boolean; depositPaid: boolean;
  note: string;
  lastName: string; firstName: string; email: string; phone: string; country: string;
}

const inputCls = "w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus";

export default function BookingDrawer() {
  const {
    selectedBookingId, closeBooking, bookings, units,
    getGuest, getUnit, getStructure, getRoomType,
    updateBooking, updateGuest, deleteBooking,
  } = useData();

  const router = useRouter();
  const ask = useConfirm();
  const { t } = useLang();
  const booking = bookings.find((b) => b.id === selectedBookingId) ?? null;

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  const [voucher, setVoucher] = useState<{ sending?: boolean; ok?: boolean; msg?: string }>({});

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
      cityTaxExempt: !!booking.cityTaxExempt, cityTaxPaid: !!booking.cityTaxPaid, depositPaid: !!booking.depositPaid,
      note: booking.note ?? "",
      lastName: g?.lastName ?? (g?.fullName ? g.fullName.split(" ").slice(1).join(" ") : ""),
      firstName: g?.firstName ?? (g?.fullName ? g.fullName.split(" ")[0] : ""),
      email: g?.email ?? "", phone: g?.phone ?? "", country: g?.country ?? "",
    });
  };

  // All'apertura di una prenotazione: torna in vista e ricarica i dati.
  useEffect(() => {
    setMode("view");
    setSaved(false);
    loadForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBookingId]);

  if (!booking) return null;

  const guest = getGuest(booking.guestId);
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
  const cleanV = booking.cleaningFee ?? 35;
  const taxV = cityTaxOf(structure, booking.adults, nView, accV, booking.cityTaxExempt);
  const totalV = accV + cleanV + taxV;
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

  const remove = async () => { if (await ask({ title: t("Elimina prenotazione"), message: t("Eliminare definitivamente questa prenotazione?"), danger: true, confirmLabel: t("Elimina") })) deleteBooking(booking.id); };

  const sendVoucherNow = async () => {
    if (!booking) return;
    if (!guest?.email) { setVoucher({ ok: false, msg: t("L'ospite non ha un'email.") }); return; }
    setVoucher({ sending: true });
    const r = await sendVoucher(booking, { getStructure, getGuest, getRoomType, getUnit });
    setVoucher({ sending: false, ok: r.ok, msg: r.ok ? t("Voucher inviato a") + " " + guest.email : r.error });
  };

  // ─────────────── VISTA (sola lettura) ───────────────
  const viewBody = (
    <>
      <Section title={t("Ospite")}>
        <Row label={t("Nome")} value={guest?.fullName ?? "—"} />
        <Row label={t("Email")} value={guest?.email ?? "—"} />
        <Row label={t("Telefono")} value={guest?.phone ?? "—"} mono />
        <Row label={t("Paese")} value={guest?.country ?? "—"} />
      </Section>

      <Section title={t("Soggiorno")}>
        <Row label={t("Struttura")} value={structure?.name ?? "—"} />
        <Row label={t("Tipologia")} value={roomType?.name ?? "—"} />
        <Row label={t("Unità")} value={unitV?.name ?? t("Da assegnare")} />
        {effBedConfig && <Row label={t("Letti")} value={effBedConfig} />}
        {effSize ? <Row label={t("Superficie")} value={`${effSize} m²`} mono /> : null}
        <Row label={t("Check-in")} value={fmtDate(booking.checkIn)} />
        <Row label={t("Check-out")} value={fmtDate(booking.checkOut)} />
        <Row label={t("Notti")} value={String(nView)} mono />
        <Row label={t("Ospiti")} value={`${booking.adults} ${t("adulti")} · ${booking.children} ${t("bambini")}`} />
      </Section>

      <Section title={t("Conto")}>
        <Row label={`${t("Soggiorno")} (${nView} ${t("notti")})`} value={eur(accV)} mono />
        <Row label={t("Pulizia")} value={eur(cleanV)} mono />
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-dim">{t("Tassa di soggiorno")} {booking.cityTaxPaid && <span className="ml-1 rounded bg-[color:color-mix(in_srgb,var(--ok)_18%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--ok)]">{t("incassata")}</span>}</span>
          <span className="text-right font-mono text-sm text-txt">{eur(taxV)}</span>
        </div>
        {booking.depositPaid && <Row label={t("Caparra")} value={t("ricevuta ✓")} />}
        <div className="my-2 border-t border-line" />
        <Row label={t("Totale ospite")} value={eur(totalV)} mono strong />
        <Row label={t("Incassato")} value={eur(paidV)} mono />
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-dim">{t("Saldo dovuto")}</span>
          <span className="text-right font-mono text-sm font-bold" style={{ color: balanceV > 0 ? "var(--warn)" : "var(--ok)" }}>{balanceV > 0 ? eur(balanceV) : t("Saldato ✓")}</span>
        </div>
        <div className="my-2 border-t border-line" />
        {commV > 0 && <Row label={`${t("Commissione")} (${commPctV}%)`} value={eur(commV)} mono />}
        <Row label={t("Netto struttura")} value={eur(nettoV)} mono strong />
      </Section>

      {booking.note && (
        <Section title={t("Note")}><p className="whitespace-pre-wrap text-sm text-txt">{booking.note}</p></Section>
      )}

      <Section title={t("Check-in online")}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-dim">{t("Stato")}</span>
          {booking.webCheckin
            ? <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }}>{t("Completato ✓")}</span>
            : <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: "var(--wash)", color: "var(--dim)" }}>{t("Da compilare")}</span>}
        </div>
        {booking.arrivalTime && booking.arrivalTime !== "Non lo so" && <Row label={t("Arrivo previsto")} value={booking.arrivalTime} />}
        {(() => {
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          const link = `${origin}/checkin?b=${booking.id}`;
          const waText = encodeURIComponent(`Buongiorno${guest?.fullName ? " " + guest.fullName.split(" ")[0] : ""}, per velocizzare l'arrivo a ${structure?.name ?? "Xenora"} completa il check-in online qui: ${link}`);
          return (
            <div className="flex flex-wrap gap-2 pt-0.5">
              {phoneDigits && <a href={`https://wa.me/${phoneDigits}?text=${waText}`} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-lg py-2 text-center text-xs font-semibold text-white" style={{ backgroundColor: "#25D366" }}>{t("Invia link WhatsApp")}</a>}
              <button onClick={() => navigator.clipboard?.writeText(link)} className="flex-1 rounded-lg border border-line py-2 text-center text-xs font-semibold text-txt hover:bg-wash">{t("Copia link")}</button>
              <a href={link} target="_blank" rel="noreferrer" className="flex-1 rounded-lg border border-line py-2 text-center text-xs font-semibold text-txt hover:bg-wash">{t("Apri")} ↗</a>
            </div>
          );
        })()}
      </Section>

      {(booking.webCheckin || booking.docPhotoFront || booking.signature) && (
        <Section title={t("Check-in online")}>
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" }}>✓ {t("Completato")}</span>
            {booking.arrivalTime && booking.arrivalTime !== "Non lo so" && <span className="text-dim">{t("Arrivo previsto")}: <b className="text-txt">{booking.arrivalTime}</b></span>}
          </div>
          {(booking.docPhotoFront || booking.docPhotoBack) && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[booking.docPhotoFront, booking.docPhotoBack].filter(Boolean).map((src, i) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <a key={i} href={src as string} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line"><img src={src as string} alt={t("Documento")} className="h-24 w-full object-cover" /></a>
              ))}
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
      )}

      <Section title={t("Documenti")}>
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
        <div className="flex gap-2">
          <ContactBtn href={phoneDigits ? `https://wa.me/${phoneDigits}?text=${waText}` : undefined} label="WhatsApp" color="#25D366" missingTitle={t("Dato mancante")} />
          <ContactBtn href={guest?.phone ? `tel:${guest.phone}` : undefined} label={t("Chiama")} color="var(--focus)" missingTitle={t("Dato mancante")} />
          <ContactBtn href={guest?.email ? `mailto:${guest.email}` : undefined} label={t("Email")} color="var(--dim)" missingTitle={t("Dato mancante")} />
        </div>
        <button onClick={sendVoucherNow} disabled={voucher.sending || !guest?.email} title={!guest?.email ? t("L'ospite non ha un'email.") : undefined} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "#285f92" }}>
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
      cityTaxExempt: form.cityTaxExempt, cityTaxPaid: form.cityTaxPaid, depositPaid: form.depositPaid,
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
          <ContactBtn href={form.email ? `mailto:${form.email}` : undefined} label={t("Email")} color="var(--dim)" missingTitle={t("Dato mancante")} />
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
          <Field label={t("Check-in")}><input type="date" className={inputCls} value={form.checkIn} onChange={(e) => set({ checkIn: e.target.value })} /></Field>
          <Field label={t("Check-out")}><input type="date" className={inputCls} value={form.checkOut} onChange={(e) => set({ checkOut: e.target.value })} /></Field>
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
        <button onClick={remove} className="w-full rounded-lg border border-line px-3 py-2 text-sm font-medium text-[color:var(--err)] hover:bg-[color:color-mix(in_srgb,var(--err)_10%,transparent)]">{t("Elimina prenotazione")}</button>
      </Section>
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button aria-label={t("Chiudi")} onClick={closeBooking} className="fixed inset-0 bg-black/40" />

      <div className="anim-in relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        {/* Intestazione */}
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: `var(${ch.cssVar})`, color: ch.text }}>{ch.label}</span>
              <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: st.color }}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: st.color }} />{t(st.label)}
              </span>
              <span className="text-xs text-dim">#{bookingCode(booking)}</span>
            </div>
            <h2 className="mt-2 truncate font-display text-xl font-bold tracking-tight text-txt">{guest?.fullName ?? t("Ospite")}</h2>
            {(() => { const bd = birthdayInStay(guest?.birthDate, booking.checkIn, booking.checkOut); return bd ? (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, #DB2777 15%, transparent)", color: "#DB2777" }} title={t("Compleanno durante il soggiorno")}>
                <Icon name="cake" size={13} />{t("Compleanno")} {fmtDate(bd)}
              </span>
            ) : null; })()}
          </div>
          <div className="flex items-center gap-1">
            {mode === "view" && (
              <button onClick={() => { loadForm(); setMode("edit"); }} className="rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">{t("Modifica")}</button>
            )}
            <button onClick={closeBooking} className="rounded-md px-2 py-1 text-dim hover:bg-wash hover:text-txt">✕</button>
          </div>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto">{mode === "view" ? viewBody : editBody}</div>

        {/* Barra azioni */}
        {mode === "edit" ? (
          <div className="flex items-center gap-3 border-t border-line bg-surface px-5 py-3">
            <button onClick={() => { loadForm(); setMode("view"); }} className="rounded-lg border border-line px-4 py-2 text-sm text-dim hover:bg-wash">{t("Annulla")}</button>
            <button onClick={save} className="ml-auto rounded-lg bg-focus px-5 py-2 text-sm font-semibold text-white hover:opacity-90">{t("Salva modifiche")}</button>
          </div>
        ) : (
          <div className="flex items-center gap-3 border-t border-line bg-surface px-5 py-3 text-xs text-dim">
            {saved ? <span className="font-medium text-[color:var(--ok)]">{t("Salvato ✓")}</span> : <span>{t("Clicca “Modifica” per aggiornare la prenotazione.")}</span>}
            <button onClick={closeBooking} className="ml-auto rounded-lg border border-line px-4 py-2 text-sm text-dim hover:bg-wash">{t("Chiudi")}</button>
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
