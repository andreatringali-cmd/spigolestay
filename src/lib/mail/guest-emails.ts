// Email transazionali all'OSPITE (voucher/conferma, annullamento, sollecito check-in, messaggio libero, preventivo) e
// avvisi interni (check-in completato, ricevuta abbonamento). Costruiscono solo l'HTML: logo già risolto in URL, QR già caricato.
// Ogni testo passa da et()/T() (lingua dell'ospite): niente italiano dentro le email in altre lingue.
import { et, emailLang, cancelPolicyIn, cityTaxRuleIn, type CityTaxRule } from "../email-i18n";
import { asGuestLang } from "../guest-i18n";
import {
  esc, emailShell, eventBadgeHtml, statusBadgeHtml, kvRow, kvTable, sectionTitle, cardBox, ctaButtonHtml, ghostButtonHtml, textBlockHtml,
  fmtDay, money, countLabel, peopleLabel, greetingName, accentText, normHex, INK,
  type Brand, type Lang,
} from "./shell";

export interface GuestBookingPayload {
  code?: string; status?: string; statusKey?: string; structureName?: string; structureEmail?: string; guestName?: string; guestFirstName?: string; guestEmail?: string;
  roomType?: string; unitName?: string; checkIn?: string; checkOut?: string; nights?: number;
  adults?: number; children?: number; total?: number; currency?: string; cleaningFee?: number;
  checkInFrom?: string; checkOutBy?: string; address?: string; mapsUrl?: string; phone?: string; color?: string;
  ratePlan?: string; ratePlanName?: string; cancelPolicy?: string; refunded?: number;
  // Importo che l'ospite dovrebbe riavere ma che non è stato rimborsato in automatico (la struttura lo gestisce a mano): l'email non deve dire "nessun rimborso".
  unrefunded?: number;
  logo?: string; website?: string; cin?: string; vat?: string;
  // Dettaglio in stile Octorate: extra, tassa di soggiorno, incassi, richieste.
  extras?: { name: string; price: number }[]; extrasTotal?: number; bookingTotal?: number;
  cityTaxAmount?: number; cityTaxRuleText?: string; grandTotal?: number; paid?: number; due?: number;
  guestRequests?: string;
  // Prenotazione di GRUPPO (più camere): una riga per camera; i totali sono quelli dell'insieme.
  rooms?: { roomType?: string; unitName?: string; adults?: number; children?: number; total?: number }[];
  // Lingua dell'email: `lang` esplicita, altrimenti dalla scheda ospite / Paese / prefisso del telefono (lib/email-i18n.ts).
  lang?: string; guestPhone?: string; guestCountry?: string; guestLanguage?: string;
  refundable?: boolean; cancelDays?: number; cityTaxRule?: CityTaxRule;
  // Identificativo interno: serve solo al link "apri la scheda" delle email al titolare.
  bookingId?: string;
}

type StatusKind = "confirmed" | "tentative" | "cancelled" | "no_show";
/** Stato della prenotazione dal codice (statusKey) o dall'etichetta italiana/inglese; sconosciuto → confermata (compatibilità). */
export function statusKindOf(b: Pick<GuestBookingPayload, "status" | "statusKey">): StatusKind {
  const k = String(b.statusKey ?? "").toLowerCase();
  if (k === "confirmed" || k === "tentative" || k === "cancelled" || k === "no_show") return k;
  const l = String(b.status ?? "").trim().toLowerCase();
  if (!l) return "confirmed";
  if (l.startsWith("in attesa") || l.includes("pending") || l === "tentative") return "tentative";
  if (l.startsWith("annullat") || l.startsWith("cancel")) return "cancelled";
  if (l.includes("no-show") || l === "no_show") return "no_show";
  return "confirmed";
}

export const brandFrom = (b: GuestBookingPayload): Brand => ({ name: b.structureName, logo: b.logo, address: b.address, phone: b.phone, email: b.structureEmail, website: b.website, accent: b.color, cin: b.cin, vat: b.vat });

const tFor = (L: Lang) => (s: string, v?: Record<string, string | number>) => et(L, s, v);
const nonEmpty = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const roomName = (r: { roomType?: string; unitName?: string }) => [nonEmpty(r.roomType), nonEmpty(r.unitName)].filter(Boolean).join(" · ");
const hello = (T: ReturnType<typeof tFor>, b: GuestBookingPayload) =>
  `<p style="margin:0 0 4px;font-size:16px;">${T("Ciao <b>{name}</b>,", { name: esc(greetingName(b.guestName, b.guestFirstName) || T("ospite")) })}</p>`;

// ── Voucher / conferma ──────────────────────────────────────────────────────
/** Politica di cancellazione e tassa di soggiorno nella lingua dell'email. Nelle lingue diverse dall'italiano si ricompongono dai dati strutturati;
 *  se mancano la clausola si omette (mai il testo italiano dentro un'email in un'altra lingua, mai "non rimborsabile" a caso). */
export function policyTextFor(b: GuestBookingPayload, L: Lang): string {
  return L !== "it" ? (b.refundable !== undefined ? cancelPolicyIn(L, b.refundable, b.cancelDays) : "") : nonEmpty(b.cancelPolicy);
}
export function taxTextFor(b: GuestBookingPayload, L: Lang): string {
  return L !== "it" ? (b.cityTaxRule ? cityTaxRuleIn(L, b.cityTaxRule) : "") : nonEmpty(b.cityTaxRuleText);
}
/** Totali del voucher. Calcolati qui (non fidandosi del chiamante): totale prenotazione = camere + extra + pulizia; la tassa di soggiorno è a parte. */
export function voucherTotals(b: GuestBookingPayload) {
  const extrasTotal = b.extrasTotal ?? (b.extras || []).reduce((s, e) => s + (e.price || 0), 0);
  const cleaning = b.cleaningFee ?? 0;
  const bookingTotal = b.bookingTotal ?? ((b.total ?? 0) + extrasTotal + cleaning);
  const cityTaxAmount = b.cityTaxAmount ?? 0;
  const grandTotal = b.grandTotal ?? (bookingTotal + cityTaxAmount);
  const paid = b.paid ?? 0;
  const due = b.due ?? Math.max(0, grandTotal - paid);
  return { extrasTotal, cleaning, bookingTotal, cityTaxAmount, grandTotal, paid, due };
}
export function voucherEmailHtml(b: GuestBookingPayload, o: { checkinUrl?: string; manageUrl?: string; qrUrl?: string; brand?: Brand }): string {
  const accent = normHex(b.color, "#285f92");
  const aText = accentText(accent);
  const cur = b.currency || "€";
  const L = emailLang(b);
  const T = tFor(L);
  const m = (n?: number) => money(n, cur, L);
  const kind = statusKindOf(b);
  const policyText = policyTextFor(b, L);
  const taxText = taxTextFor(b, L);
  const { extrasTotal, cleaning, bookingTotal, cityTaxAmount, grandTotal, paid, due } = voucherTotals(b);
  const ratePlanName = nonEmpty(b.ratePlanName || b.ratePlan);
  const rooms = (b.rooms || []).filter((r) => roomName(r));
  const isGroup = rooms.length > 1;

  const intro = kind === "tentative"
    ? T("la tua prenotazione presso <b>{structure}</b> è stata registrata ed è in attesa di conferma. Ecco il riepilogo.", { structure: esc(b.structureName) })
    : kind === "cancelled"
      ? T("la tua prenotazione presso <b>{structure}</b> è stata <b>annullata</b>.", { structure: esc(b.structureName) })
      : kind === "no_show"
        ? T("ecco il riepilogo della tua prenotazione presso <b>{structure}</b>.", { structure: esc(b.structureName) })
        : T("la tua prenotazione presso <b>{structure}</b> è confermata. Ecco il riepilogo completo.", { structure: esc(b.structureName) });
  const statusLabel = kind === "tentative" ? T("In attesa di conferma") : kind === "cancelled" ? T("Annullata") : kind === "no_show" ? T("No-show") : T("Confermata");

  const codeBox = cardBox(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle"><div style="font:12px/1.3 Arial,Helvetica,sans-serif;color:#6b7280;">${esc(T("Codice prenotazione"))}</div>
        <div style="font:800 21px/1.3 Consolas,Menlo,monospace;letter-spacing:1px;color:${aText};">${esc(b.code || "")}</div></td>
      <td align="right" valign="middle">${statusBadgeHtml(kind, statusLabel)}</td></tr></table>`, { pad: "14px 16px" });

  const n = b.nights ?? 0;
  const people = peopleLabel(L, b.adults ?? (isGroup ? undefined : 1), b.children);
  const stayLine = [n > 0 ? countLabel(L, "night", n) : "", people].filter(Boolean).join(" · ");
  const when: string[] = [];
  const arrival = fmtDay(b.checkIn, L), departure = fmtDay(b.checkOut, L);
  if (arrival) when.push(kvRow(T("Arrivo"), esc(arrival) + (b.checkInFrom ? ` <span style="color:#6b7280;font-weight:400;">${esc(T("dalle {time}", { time: b.checkInFrom }))}</span>` : "")));
  if (departure) when.push(kvRow(T("Partenza"), esc(departure) + (b.checkOutBy ? ` <span style="color:#6b7280;font-weight:400;">${esc(T("entro {time}", { time: b.checkOutBy }))}</span>` : "")));
  if (stayLine) when.push(kvRow(T("Soggiorno"), esc(stayLine)));
  if (!isGroup && roomName(b)) when.push(kvRow(T("Camera"), esc(roomName(b))));
  if (ratePlanName) when.push(kvRow(T("Tariffa"), esc(ratePlanName)));

  const roomsHtml = isGroup
    ? sectionTitle(T("Camere")) + kvTable(rooms.map((r) => kvRow(roomName(r), esc([peopleLabel(L, r.adults, r.children), (r.total ?? 0) > 0 ? m(r.total) : ""].filter(Boolean).join(" · ")), { bold: false })))
    : "";

  const amountRows: string[] = [];
  if (bookingTotal > 0 || paid > 0) {
    const detailed = extrasTotal > 0 || cleaning > 0;
    if (detailed) amountRows.push(kvRow(T("Totale camere"), esc(m(b.total))));
    if (extrasTotal > 0) amountRows.push(kvRow(T("Totale extra"), esc(m(extrasTotal))));
    if (cleaning > 0) amountRows.push(kvRow(T("Pulizia"), esc(m(cleaning))));
    amountRows.push(kvRow(T("Totale prenotazione"), `<b>${esc(m(bookingTotal))}</b>`));
    if (cityTaxAmount > 0) {
      amountRows.push(kvRow(T("Tassa di soggiorno"), esc(m(cityTaxAmount))));
      amountRows.push(kvRow(T("Totale con tassa di soggiorno"), `<b style="color:${aText};">${esc(m(grandTotal))}</b>`));
    }
    if (paid > 0) amountRows.push(kvRow(T("Totale incassato"), esc(m(paid))));
    if (kind !== "cancelled") amountRows.push(kvRow(T("Totale da incassare"), `<b>${esc(m(due))}</b>`));
  }
  const amountsHtml = amountRows.length ? sectionTitle(T("Riepilogo economico")) + cardBox(kvTable(amountRows)) : "";

  const extrasLines = (b.extras || []).filter((e) => e.name);
  const extrasHtml = extrasLines.length
    ? sectionTitle(T("Servizi extra")) + kvTable(extrasLines.map((e) => kvRow(e.name, e.price ? esc(m(e.price)) : "", { bold: false })))
    : "";

  const reqHtml = nonEmpty(b.guestRequests)
    ? sectionTitle(T("Richieste speciali")) + cardBox(`<div style="white-space:pre-wrap;font:14px/1.5 Arial,Helvetica,sans-serif;color:${INK};">${esc(b.guestRequests)}</div>`, { bg: "#FFF8E1", border: "#F2D98B" })
    : "";

  const termsHtml = (policyText || taxText)
    ? `<div style="margin:20px 0 0;">${cardBox(`<div style="font:700 12px/1.5 Arial,Helvetica,sans-serif;color:${INK};">${esc(T("Termini e condizioni di prenotazione"))}</div><div style="font:12px/1.6 Arial,Helvetica,sans-serif;color:#4b5563;margin-top:4px;">${policyText ? esc(policyText) : ""}${policyText && taxText ? "<br><br>" : ""}${taxText ? esc(taxText) : ""}</div>`)}</div>`
    : "";

  const live = kind !== "cancelled"; // annullata: niente "Gestisci la tua prenotazione", link di gestione e QR (non c'è più nulla da gestire)
  const cta = live && o.checkinUrl
    ? ctaButtonHtml(o.checkinUrl, T("Gestisci la tua prenotazione →"), accent)
      + `<ul style="margin:8px 0 0;padding:0 0 0 18px;font:12px/1.9 Arial,Helvetica,sans-serif;color:#6b7280;">
          <li>${T("Completare i dati mancanti e fare il <b>check-in online</b>")}</li>
          <li>${T("Vedere lo stato del pagamento e <b>saldare</b> l'importo dovuto")}</li>
          <li>${T("Inviare <b>richieste particolari</b> alla struttura")}</li></ul>`
    : "";
  const manage = live && o.manageUrl ? ghostButtonHtml(o.manageUrl, T("Gestisci la prenotazione (modifica o annulla)"), accent) : "";
  const qr = live && o.qrUrl
    ? `<div style="margin:18px 0 0;text-align:center;"><img src="${esc(o.qrUrl)}" width="120" height="120" alt="${esc(T("QR gestione prenotazione"))}" style="display:inline-block;width:120px;height:120px;max-width:120px;border:1px solid #eceef1;border-radius:10px;padding:6px;background:#ffffff;" /><div style="margin-top:6px;font:11px/1.4 Arial,Helvetica,sans-serif;color:#6b7280;">${esc(T("Inquadra per gestire la prenotazione dal telefono"))}</div></div>`
    : "";
  const links = (b.website || b.mapsUrl)
    ? `<div style="margin:16px 0 0;text-align:center;font:12px/1.5 Arial,Helvetica,sans-serif;">${b.website ? `<a href="${esc(/^https?:\/\//i.test(b.website) ? b.website : `https://${b.website}`)}" style="color:${aText};text-decoration:none;font-weight:600;">${esc(T("Visita il nostro sito"))}</a>` : ""}${b.website && b.mapsUrl ? " &nbsp;·&nbsp; " : ""}${b.mapsUrl ? `<a href="${esc(b.mapsUrl)}" style="color:${aText};text-decoration:none;font-weight:600;">${esc(T("Apri in Google Maps"))}</a>` : ""}</div>`
    : "";

  const body = hello(T, b)
    + `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#4b5563;">${intro}</p>`
    + codeBox
    + `<div style="margin-top:10px;">${kvTable(when)}</div>`
    + roomsHtml + amountsHtml + extrasHtml + reqHtml + termsHtml + cta + manage + qr + links;
  const subjectWord = kind === "tentative" || kind === "no_show" ? T("Riepilogo prenotazione") : kind === "cancelled" ? T("Prenotazione annullata") : T("Conferma prenotazione");
  return emailShell({
    lang: L, title: `${subjectWord} ${b.code || ""}`.trim(), accent, brand: o.brand, eyebrow: subjectWord, bodyHtml: body,
    preheader: [subjectWord, b.code, [arrival, departure].filter(Boolean).join(" → ")].filter(Boolean).join(" · "),
  });
}

/** Oggetto del voucher, nella lingua dell'ospite. */
export function voucherSubject(b: GuestBookingPayload): string {
  const L = emailLang(b);
  const kind = statusKindOf(b);
  const word = kind === "tentative" || kind === "no_show" ? et(L, "Riepilogo prenotazione") : kind === "cancelled" ? et(L, "Prenotazione annullata") : et(L, "Conferma prenotazione");
  return `${word} ${b.code || ""} · ${b.structureName || "Xenora"}`.replace(/\s+/g, " ").trim();
}

// ── Annullamento ────────────────────────────────────────────────────────────
export function cancelEmailHtml(b: GuestBookingPayload, o: { brand?: Brand }): string {
  const accent = normHex(b.color, "#b4472e");
  const cur = b.currency || "€";
  const L = emailLang(b);
  const T = tFor(L);
  // Nessun rimborso: nelle lingue diverse dall'italiano la politica si ricompone dai dati strutturati (se mancano si usa la frase generica).
  const policyText = policyTextFor(b, L);
  const refunded = typeof b.refunded === "number" && b.refunded > 0 ? b.refunded : 0;
  const unrefunded = typeof b.unrefunded === "number" && b.unrefunded > 0 ? b.unrefunded : 0;
  const owedLine = (key: string) => `<div style="margin-top:6px;font:700 13px/1.5 Arial,Helvetica,sans-serif;color:${INK};">${esc(T(key, { amount: money(unrefunded, cur, L) }))}</div>`;
  const rows: string[] = [];
  if (b.code) rows.push(kvRow(T("Codice"), `<span style="font-family:Consolas,Menlo,monospace;">${esc(b.code)}</span>`));
  if (roomName(b)) rows.push(kvRow(T("Camera"), esc(roomName(b))));
  const arrival = fmtDay(b.checkIn, L), departure = fmtDay(b.checkOut, L);
  if (arrival) rows.push(kvRow(T("Arrivo"), esc(arrival)));
  if (departure) rows.push(kvRow(T("Partenza"), esc(departure)));
  const refundBox = cardBox(refunded > 0
    ? `<div style="font:700 14px/1.4 Arial,Helvetica,sans-serif;color:#0B6B3F;">${esc(T("Rimborso emesso: {amount}", { amount: money(refunded, cur, L) }))}</div>
       <div style="margin-top:4px;font:12px/1.5 Arial,Helvetica,sans-serif;color:#6b7280;">${esc(T("L'importo tornerà sul metodo di pagamento usato entro 5–10 giorni lavorativi (tempi della banca)."))}</div>${unrefunded > 0 ? owedLine("La struttura ti contatterà per restituirti il residuo di {amount}") : ""}`
    : unrefunded > 0
    ? `<div style="font:700 14px/1.4 Arial,Helvetica,sans-serif;color:${INK};">${esc(T("La struttura ti contatterà per il rimborso di {amount}", { amount: money(unrefunded, cur, L) }))}</div>`
    : `<div style="font:700 14px/1.4 Arial,Helvetica,sans-serif;color:${INK};">${esc(T("Nessun rimborso previsto"))}</div>
       <div style="margin-top:4px;font:12px/1.5 Arial,Helvetica,sans-serif;color:#6b7280;">${esc(policyText || T("Secondo le condizioni della tariffa prenotata."))}</div>`, { pad: "14px 16px" });
  const body = `<div style="margin-bottom:14px;">${eventBadgeHtml("cancel", T("Prenotazione annullata"))}</div>`
    + hello(T, b)
    + `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#4b5563;">${T("la tua prenotazione presso <b>{structure}</b> è stata <b>annullata</b>.", { structure: esc(b.structureName) })}</p>`
    + kvTable(rows) + `<div style="margin-top:16px;">${refundBox}</div>`
    + `<p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#4b5563;">${esc(T("Ci dispiace vederti annullare. Sarai sempre il benvenuto in futuro."))}</p>`;
  return emailShell({ lang: L, title: `${T("Prenotazione annullata")} ${b.code || ""}`.trim(), accent, brand: o.brand, bodyHtml: body, preheader: [T("Prenotazione annullata"), b.code, arrival].filter(Boolean).join(" · ") });
}

// ── Sollecito check-in ──────────────────────────────────────────────────────
export function reminderEmailHtml(b: GuestBookingPayload, o: { checkinUrl: string; brand?: Brand }): string {
  const accent = normHex(b.color, "#0E9F6E");
  const L = emailLang(b);
  const T = tFor(L);
  const rows: string[] = [];
  if (b.code) rows.push(kvRow(T("Codice"), `<span style="font-family:Consolas,Menlo,monospace;">${esc(b.code)}</span>`));
  const arrival = fmtDay(b.checkIn, L);
  if (arrival) rows.push(kvRow(T("Arrivo"), esc(arrival) + (b.checkInFrom ? ` <span style="color:#6b7280;font-weight:400;">${esc(T("dalle {time}", { time: b.checkInFrom }))}</span>` : "")));
  const body = hello(T, b)
    + `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#4b5563;">${T("manca poco al tuo arrivo presso <b>{structure}</b>. Completa il <b>check-in online</b> adesso: è veloce e al tuo arrivo eviti l'attesa.", { structure: esc(b.structureName) })}</p>`
    + kvTable(rows)
    + (o.checkinUrl ? ctaButtonHtml(o.checkinUrl, T("Fai il check-in online →"), accent) : "")
    + `<p style="margin:8px 0 0;font:12px/1.5 Arial,Helvetica,sans-serif;color:#6b7280;text-align:center;">${esc(T("Compila i dati prima dell'arrivo: risparmi tempo al check-in."))}</p>`;
  return emailShell({ lang: L, title: T("Completa il check-in"), accent, brand: o.brand, eyebrow: T("Completa il check-in"), bodyHtml: body, preheader: T("Completa il check-in online") });
}

// ── Messaggio libero all'ospite / preventivo ────────────────────────────────
/** Lingua esplicita del messaggio (`lang`), altrimenti italiano. */
export const explicitLang = (v: unknown): Lang => asGuestLang(v) ?? "it";

export function messageEmailHtml(o: { lang?: Lang; title: string; text: string; accent: string; brand?: Brand; ctaUrl?: string; ctaLabel?: string; note?: string; preheader?: string }): string {
  const accent = normHex(o.accent, "#285f92");
  const body = textBlockHtml(o.text)
    + (o.ctaUrl ? ctaButtonHtml(o.ctaUrl, o.ctaLabel || "→", accent) : "")
    + (o.note ? `<p style="margin:8px 0 0;font:12px/1.5 Arial,Helvetica,sans-serif;color:#6b7280;text-align:center;">${esc(o.note)}</p>` : "");
  return emailShell({ lang: o.lang, title: o.title, accent, brand: o.brand, eyebrow: o.title, bodyHtml: body, preheader: o.preheader || nonEmpty(o.text).slice(0, 110) });
}

// ── Check-in completato (al TITOLARE) ───────────────────────────────────────
export interface CheckinGuest { role?: string; firstName?: string; lastName?: string }
/**
 * Avviso al titolare: solo NOMI, numero di ospiti e link alla scheda. Numeri di documento, luogo e data di nascita NON viaggiano in email:
 * restano nella scheda prenotazione (protetta dal login). Il chiamante può ancora inviarli nel payload: qui si ignorano di proposito.
 */
export function checkinOwnerEmailHtml(b: GuestBookingPayload, guests: CheckinGuest[], o: { brand?: Brand; arrival?: string; ctaUrl?: string; schedina?: string }): string {
  const accent = normHex(b.color, "#0E9F6E");
  const names = guests.map((g) => [g.firstName, g.lastName].filter(Boolean).join(" ").trim()).filter(Boolean);
  const rows: string[] = [];
  if (b.code) rows.push(kvRow("Codice", `<span style="font-family:Consolas,Menlo,monospace;">${esc(b.code)}</span>`));
  if (roomName(b)) rows.push(kvRow("Sistemazione", esc(roomName(b))));
  if (fmtDay(b.checkIn)) rows.push(kvRow("Arrivo", esc(fmtDay(b.checkIn))));
  if (nonEmpty(o.arrival)) rows.push(kvRow("Orario previsto", esc(nonEmpty(o.arrival))));
  rows.push(kvRow("Ospiti registrati", esc(String(guests.length))));
  if (nonEmpty(o.schedina)) rows.push(kvRow("Schedina Alloggiati", esc(nonEmpty(o.schedina))));
  const list = names.length
    ? sectionTitle("Ospiti") + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${names.map((n, i) => `<tr><td style="padding:5px 0;font:14px/1.4 Arial,Helvetica,sans-serif;color:${INK};">${i === 0 ? "<span style=\"color:#6b7280;\">Principale</span> &nbsp;" : ""}${esc(n)}</td></tr>`).join("")}</table>`
    : "";
  const body = `<div style="margin-bottom:12px;">${eventBadgeHtml("newBooking", "Check-in online completato")}</div>`
    + `<div style="margin:0 0 2px;font:800 22px/1.3 Arial,Helvetica,sans-serif;color:${INK};">${esc(nonEmpty(b.guestName) || "Ospite")}</div>`
    + `<div style="margin-top:10px;">${kvTable(rows)}</div>` + list
    + `<p style="margin:16px 0 0;font:12px/1.6 Arial,Helvetica,sans-serif;color:#6b7280;">I documenti e gli altri dati personali non viaggiano in email: apri la scheda prenotazione per consultarli e generare/inviare la schedina Alloggiati Web.</p>`
    + (o.ctaUrl ? ctaButtonHtml(o.ctaUrl, "Apri la scheda prenotazione →", accent) : "");
  return emailShell({ lang: "it", title: `Check-in online ${b.code || ""}`.trim(), accent, brand: o.brand, eyebrow: "Check-in ricevuto", bodyHtml: body, preheader: `Check-in completato · ${nonEmpty(b.guestName)} · ${guests.length} ${guests.length === 1 ? "ospite" : "ospiti"}` });
}

// ── Ricevuta abbonamento Xenora ─────────────────────────────────────────────
export interface SubReceiptPayload { plan?: string | null; planName?: string | null; totalCents?: number; currency?: string; periodStart?: number | null; periodEnd?: number | null; invoiceId?: string }
/** Nome del piano per oggetto e corpo: il nome esteso, altrimenti il codice grezzo ("pro") con la maiuscola iniziale. */
export const subReceiptPlanLabel = (s: SubReceiptPayload): string => s.planName || (s.plan ? s.plan.charAt(0).toUpperCase() + s.plan.slice(1) : "");
export const subReceiptSubject = (s: SubReceiptPayload): string => `Ricevuta abbonamento Xenora${subReceiptPlanLabel(s) ? ` · ${subReceiptPlanLabel(s)}` : ""}`.trim();
export function subReceiptEmailHtml(s: SubReceiptPayload, fmtUnix: (u?: number | null) => string): string {
  const accent = "#285f92";
  const cur = (s.currency || "EUR").toUpperCase() === "EUR" ? "€" : (s.currency || "EUR");
  const amount = typeof s.totalCents === "number" ? money(s.totalCents / 100, cur, "it") : "";
  const plan = subReceiptPlanLabel(s);
  const periodo = s.periodStart && s.periodEnd ? `${fmtUnix(s.periodStart)} → ${fmtUnix(s.periodEnd)}` : "";
  const rows = [
    plan ? kvRow("Piano", esc(plan)) : "",
    periodo ? kvRow("Periodo", esc(periodo)) : "",
    amount ? kvRow("Importo", esc(amount)) : "",
    s.invoiceId ? kvRow("Riferimento", `<span style="font-family:Consolas,Menlo,monospace;">${esc(s.invoiceId)}</span>`) : "",
  ];
  const body = `<p style="margin:0 0 4px;font-size:16px;">Grazie,</p>`
    + `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#4b5563;">abbiamo ricevuto il pagamento del tuo abbonamento <b>Xenora</b>. Ecco il riepilogo.</p>`
    + kvTable(rows)
    + `<div style="margin-top:16px;">${cardBox(`<div style="font:12px/1.5 Arial,Helvetica,sans-serif;color:#4b5563;">Il <b>documento fiscale</b> relativo a questo pagamento ti sarà recapitato a seguire.</div>`)}</div>`
    + `<p style="margin:18px 0 0;font-size:13px;color:#4b5563;">Grazie per aver scelto Xenora.</p>`;
  return emailShell({ lang: "it", title: "Ricevuta abbonamento Xenora", accent, eyebrow: "Ricevuta abbonamento", bodyHtml: body, preheader: "Abbiamo ricevuto il pagamento del tuo abbonamento Xenora" });
}
