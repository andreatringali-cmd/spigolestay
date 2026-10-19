"use client";

// Gestione → incassi extra: la tassa di soggiorno (link di pagamento o «incassata») e il CONTO delle altre voci
// (extra, late checkout, voci libere) da stampare o mandare all'ospite, con un link di pagamento per l'importo che decidi tu.
import { useState } from "react";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { useConfirm } from "@/components/ConfirmProvider";
import { apiPost } from "@/lib/invoicing/client";
import { eur } from "@/lib/format";
import { cityTaxOfBooking, bookingGrandTotal } from "@/lib/booking";
import { billMessage, billOf } from "@/lib/booking-bill";
import { shortenLink } from "@/lib/guestlink";
import { chatPayGuestMessage, parseEurInput } from "@/lib/chat-pay-core";
import { guestLangOf } from "@/lib/guest-lang";
import { fillTemplateForBooking, linkedTemplate, templateRawFor } from "@/lib/template-fill";
import { markReminder, sendEmailToGuest, sendWhatsAppToGuest } from "@/lib/guest-messages";
import type { Booking, Guest, Structure } from "@/lib/types";

const btn = "rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-focus hover:bg-wash disabled:opacity-50";
const esc = (s: unknown) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] || c));

export default function BookingBillActions({ booking, structure, guest }: { booking: Booking; structure?: Structure; guest?: Guest }) {
  const { t } = useLang();
  const ask = useConfirm();
  const { updateBooking, bookings, getUnit, getRoomType } = useData();
  const lang = guestLangOf(guest);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [withLink, setWithLink] = useState(false);
  const [amount, setAmount] = useState("");

  const bill = billOf(booking, structure);
  const tax = booking.cityTaxExempt ? 0 : cityTaxOfBooking(structure, booking);
  const taxPaid = !!booking.cityTaxPaid;
  const hasPhone = !!(guest?.phone ?? "").replace(/\D/g, "");
  const hasMail = !!guest?.email;
  const meta = (rem: string) => ({ bid: booking.id, rem });

  const send = async (via: "wa" | "mail", body: string, subject: string, rem: string) => {
    const r = via === "wa" ? await sendWhatsAppToGuest(guest, body, meta(rem)) : await sendEmailToGuest(guest, subject, body, structure, meta(rem));
    if (r.ok) markReminder(booking.id, rem);
    setMsg({ ok: r.ok, text: r.message });
  };
  const wrap = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Operazione non riuscita." }); } finally { setBusy(""); }
  };

  // Testo del pagamento: dal MODELLO «Pagamento» / «Tassa di soggiorno» (Messaggi → Modelli) se c'è, altrimenti il testo di base.
  const payText = async (kind: "saldo" | "tassa", amountEur: number, link: string): Promise<string> => {
    const tpl = linkedTemplate(kind === "tassa" ? "tax" : "pay", booking.structureId);
    if (tpl) {
      const text = await fillTemplateForBooking(templateRawFor(tpl, guest), booking, guest, structure, { bookings, getUnit, getRoomType }, { importo: eur(amountEur), link_pagamento: link });
      if (text.trim()) return text;
    }
    return chatPayGuestMessage(lang, kind, Math.round(amountEur * 100), link);
  };

  // ── Tassa di soggiorno ──
  const sendTaxLink = (via: "wa" | "mail") => wrap(`tax-${via}`, async () => {
    const r = await apiPost<{ ok: boolean; url: string; amount: number }>("stripe/chat-pay", { bookingId: booking.id, kind: "tassa" });
    const link = await shortenLink(r.url);
    await send(via, await payText("tassa", r.amount, link), `${structure?.name ? structure.name + " · " : ""}${t("Tassa di soggiorno")}`, "pay-tassa");
  });
  const markTaxPaid = async () => {
    if (!(await ask({ title: t("Tassa di soggiorno"), message: t("Segnare la tassa di soggiorno come incassata?"), confirmLabel: t("Sì, incassata") }))) return;
    const grand = bookingGrandTotal(booking, structure);
    const inPaid = grand > 0 && (booking.paid ?? 0) + 0.005 >= grand; // se ha già versato tutto, tassa compresa, quei soldi sono dentro `paid`
    updateBooking(booking.id, inPaid ? { cityTaxPaid: true, cityTaxInPaid: true } : { cityTaxPaid: true });
  };

  // ── Conto ──
  const openBill = () => { setText(billMessage(bill, { lang, name: guest?.firstName || guest?.fullName, property: structure?.name })); setAmount(""); setWithLink(false); setMsg(null); setOpen(true); };
  const finalText = async (): Promise<string> => {
    if (!withLink) return text;
    // Importo vuoto = il «Da pagare» del conto (NON tutto il residuo della prenotazione, che comprende anche la tassa di soggiorno).
    const asked = amount.trim() ? (parseEurInput(amount) ?? NaN) : bill.due;
    if (!isFinite(asked) || asked <= 0) throw new Error(t("Importo non valido."));
    const r = await apiPost<{ ok: boolean; url: string; amount: number }>("stripe/chat-pay", { bookingId: booking.id, kind: "saldo", amount: asked });
    // La frase del link è quella di base: il conto ha già il suo saluto, niente seconda apertura «Ciao …» dal modello Pagamento.
    return `${text}\n\n${chatPayGuestMessage(lang, "saldo", Math.round(r.amount * 100), await shortenLink(r.url))}`;
  };
  const sendBill = (via: "wa" | "mail") => wrap(`bill-${via}`, async () => {
    await send(via, await finalText(), `${structure?.name ? structure.name + " · " : ""}${t("Conto del soggiorno")}`, "bill");
  });
  const copyBill = () => wrap("copy", async () => { await navigator.clipboard.writeText(await finalText()); setMsg({ ok: true, text: t("Testo copiato ✓") }); });
  const printBill = () => {
    const w = window.open("", "_blank", "width=760,height=900");
    if (!w) return;
    const rows = bill.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="n">${esc(eur(l.amount))}</td></tr>`).join("");
    const extra = [bill.paidAtPortal > 0 ? `<tr><td>${esc(t("Già pagato al portale"))}</td><td class="n">−${esc(eur(bill.paidAtPortal))}</td></tr>` : "", bill.paid > 0 ? `<tr><td>${esc(t("Già versato"))}</td><td class="n">−${esc(eur(bill.paid))}</td></tr>` : ""].join("");
    w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(t("Conto del soggiorno"))}</title><style>body{font-family:Arial,sans-serif;color:#1a2131;padding:40px;max-width:640px;margin:auto}h1{font-size:20px;margin:0 0 4px}.s{color:#666;font-size:13px;margin-bottom:22px}table{width:100%;border-collapse:collapse;font-size:14px}td{padding:8px 4px;border-bottom:1px solid #e3e6ee}.n{text-align:right;font-variant-numeric:tabular-nums}.t td{font-weight:700;font-size:16px;border-top:2px solid #1a2131;border-bottom:0}</style></head><body><h1>${esc(t("Conto del soggiorno"))}</h1><div class="s">${esc(structure?.name ?? "")} · ${esc(guest?.fullName ?? "")} · ${esc(booking.checkIn)} → ${esc(booking.checkOut)}</div><table>${rows}${extra}<tr class="t"><td>${esc(t("Da pagare"))}</td><td class="n">${esc(eur(bill.due))}</td></tr></table><script>window.addEventListener("load",function(){setTimeout(function(){window.print()},250)})</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
      {tax > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-txt">{t("Tassa di soggiorno")} <span className="font-mono tabular-nums">{eur(tax)}</span> {taxPaid ? <span className="text-xs font-semibold" style={{ color: "var(--ok)" }}>✓ {t("incassata")}</span> : <span className="text-xs font-semibold" style={{ color: "var(--warn)" }}>{t("da incassare")}</span>}</div>
          {!taxPaid && (
            <div className="flex flex-wrap gap-1.5">
              <button className={btn} disabled={!!busy || !hasPhone} onClick={() => void sendTaxLink("wa")} title={t("Manda il link di pagamento su WhatsApp")}>{t("Link WhatsApp")}</button>
              <button className={btn} disabled={!!busy || !hasMail} onClick={() => void sendTaxLink("mail")} title={t("Manda il link di pagamento per email")}>{t("Link email")}</button>
              <button className={btn} onClick={() => void markTaxPaid()}>{t("Segna incassata")}</button>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-txt">{t("Conto")} <span className="font-mono tabular-nums">{eur(bill.due)}</span> <span className="text-xs text-dim">{t("da pagare")}</span></div>
        <button className={btn} onClick={openBill}>{t("Prepara conto")}</button>
      </div>
      {msg && !open && <p className="text-xs font-semibold" style={{ color: msg.ok ? "var(--ok)" : "var(--err)" }} role="status">{msg.text}</p>}

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="flex max-h-[90dvh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-xl">
            <div className="flex items-center justify-between"><div className="text-sm font-bold text-txt">{t("Conto del soggiorno")}</div><button onClick={() => setOpen(false)} aria-label={t("Chiudi")} className="grid h-8 w-8 place-items-center rounded-lg text-lg text-dim hover:bg-wash">✕</button></div>
            <div className="flex flex-col gap-1 rounded-lg bg-wash p-2.5 text-sm">
              {bill.lines.map((l, i) => <div key={i} className="flex justify-between gap-3"><span className="text-dim">{l.label}</span><span className="font-mono tabular-nums">{eur(l.amount)}</span></div>)}
              {bill.paidAtPortal > 0 && <div className="flex justify-between gap-3"><span className="text-dim">{t("Già pagato al portale")}</span><span className="font-mono tabular-nums">−{eur(bill.paidAtPortal)}</span></div>}
              {bill.paid > 0 && <div className="flex justify-between gap-3"><span className="text-dim">{t("Già versato")}</span><span className="font-mono tabular-nums">−{eur(bill.paid)}</span></div>}
              <div className="mt-1 flex justify-between gap-3 border-t border-line pt-1 font-bold"><span>{t("Da pagare")}</span><span className="font-mono tabular-nums">{eur(bill.due)}</span></div>
              <p className="mt-1 text-[11px] text-dim">{t("Per cambiare voci, prezzi o aggiungerne di nuove usa «Extra» nella scheda.")}</p>
            </div>
            <label className="flex flex-col gap-1 text-xs text-dim">{t("Messaggio")}
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt" />
            </label>
            <label className="flex items-center gap-2 text-sm text-txt"><input type="checkbox" checked={withLink} onChange={(e) => setWithLink(e.target.checked)} /> {t("Aggiungi il link di pagamento")}</label>
            {withLink && (
              <label className="flex items-center gap-2 text-xs text-dim">{t("Importo da far pagare (vuoto = tutto il residuo)")}
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={eur(bill.due)} className="w-28 rounded-lg border border-line bg-paper px-2 py-1 text-right text-sm text-txt" />
              </label>
            )}
            <div className="flex flex-wrap gap-1.5">
              <button className={btn} disabled={!!busy || !hasPhone} onClick={() => void sendBill("wa")}>WhatsApp</button>
              <button className={btn} disabled={!!busy || !hasMail} onClick={() => void sendBill("mail")}>{t("Email")}</button>
              <button className={btn} disabled={!!busy} onClick={() => void copyBill()}>{t("Copia")}</button>
              <button className={btn} onClick={printBill}>{t("Stampa")}</button>
            </div>
            {msg && <p className="text-xs font-semibold" style={{ color: msg.ok ? "var(--ok)" : "var(--err)" }} role="status">{msg.text}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
