// Email al TITOLARE (nuova prenotazione, modifica, cancellazione, pagamento, messaggio, recensione, avviso).
// Sempre in italiano: il destinatario è chi gestisce la struttura. Puro: lo usa la route /api/email (kind "notify") e i test.
import {
  esc, emailShell, eventBadgeHtml, channelChipHtml, kvRow, kvTable, sectionTitle, cardBox, ctaButtonHtml, textBlockHtml,
  fmtDay, fmtIso, money, countLabel, peopleLabel, accentText, normHex, EVENT_STYLE, INK,
  type Brand, type MailEvent,
} from "./shell";

/** Dati strutturati della prenotazione per l'email al titolare (tutti opzionali: manca = riga omessa). */
export interface NotifyBookingData {
  bookingId?: string; code?: string; status?: string;
  guestName?: string; guestPhone?: string; guestEmail?: string; guestCountry?: string;
  roomLabel?: string;
  checkIn?: string; checkOut?: string; arrivalTime?: string; checkInFrom?: string; checkOutBy?: string;
  nights?: number; adults?: number; children?: number; cribs?: number; parking?: boolean;
  bookedOn?: string; currency?: string;
  /** Importi (€): soggiorno, extra, pulizia, tassa di soggiorno; `total` = soggiorno+extra+pulizia (senza tassa). */
  stay?: number; extras?: number; cleaning?: number; cityTax?: number; total?: number;
  paid?: number; due?: number; payment?: number;
  commission?: number; commissionEstimate?: boolean; net?: number; netEstimate?: boolean;
  guestRequests?: string; note?: string;
}

export interface NotifyEmailInput {
  event?: MailEvent;
  brand?: Brand;
  accent?: string;
  channelLabel?: string;
  structureName?: string;
  booking?: NotifyBookingData;
  /** Testo libero (altri chiamanti, o ripiego quando mancano i dati strutturati). */
  text?: string;
  subject?: string;
  ctaUrl?: string;
  ctaLabel?: string;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
/** Testo libero dell'ospite/note: gli a capo restano (pre-wrap); si compattano solo gli spazi orizzontali ripetuti. */
const multiline = (v: unknown): string => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/** Cifre per il link WhatsApp (wa.me): serve il prefisso internazionale; un cellulare italiano senza prefisso riceve il 39. */
export function waNumber(phone?: string): string {
  const raw = str(phone);
  if (!raw) return "";
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (/^3\d{8,9}$/.test(d)) d = "39" + d;
  else return "";
  return d.length >= 8 && d.length <= 15 ? d : "";
}
/** Numero per tel: (cifre e +). */
const telHref = (phone?: string) => str(phone).replace(/[^\d+]/g, "");

function countryName(code?: string): string {
  const c = str(code);
  if (/^[A-Za-z]{2}$/.test(c)) {
    try { const n = new Intl.DisplayNames(["it"], { type: "region" }).of(c.toUpperCase()); if (n && n !== c.toUpperCase()) return `${n} (${c.toUpperCase()})`; } catch { /* nome non disponibile */ }
  }
  return c;
}

/** Oggetto standard: "Cancellata · Alice Dettoni · Booking.com · 01.01.2027 · Spigole House". */
export function notifySubject(ev: MailEvent | undefined, o: { guestName?: string; channelLabel?: string; checkIn?: string; structureName?: string; amount?: number; currency?: string; kind?: string }): string {
  const head = ev === "newBooking" ? "Nuova prenotazione" : ev === "modified" ? "Modificata" : ev === "cancel" ? "Cancellata" : ev === "payment" ? "Pagamento ricevuto"
    : ev === "message" ? "Nuovo messaggio" : ev === "review" ? "Nuova recensione" : ev === "alert" ? "Avviso" : (o.kind || "Notifica");
  const parts = [head, str(o.guestName), str(o.channelLabel), fmtIso(o.checkIn), ev === "payment" && o.amount ? money(o.amount, o.currency || "€", "it") : "", str(o.structureName)];
  return parts.filter(Boolean).join(" · ");
}

/** Anteprima (preheader) breve e utile. */
function preheaderOf(ev: MailEvent | undefined, b: NotifyBookingData, channel?: string): string {
  const when = b.checkIn && b.checkOut ? `${fmtIso(b.checkIn)} → ${fmtIso(b.checkOut)}` : "";
  const what = ev === "cancel" ? "Cancellata" : ev === "modified" ? "Modificata" : ev === "payment" ? "Pagamento" : ev === "message" ? "Nuovo messaggio"
    : ev === "review" ? "Nuova recensione" : ev === "alert" ? "Avviso" : "Nuova prenotazione";
  return [what + (channel ? ` su ${channel}` : ""), str(b.guestName), when, b.roomLabel].filter(Boolean).join(" · ");
}

function bookingBody(input: NotifyEmailInput, accent: string): string {
  const b = input.booking!;
  const ev = input.event;
  const cur = b.currency || "€";
  const m = (n?: number) => money(n, cur, "it");
  const aText = accentText(accent);

  // 1) Badge evento + chip canale
  const top = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle">${ev ? eventBadgeHtml(ev) : ""}</td>
      <td align="right" valign="middle">${channelChipHtml(input.channelLabel)}</td>
    </tr></table>`;

  // 2) Titolo: ospite
  const title = `<div style="margin:14px 0 2px;font:800 24px/1.25 Arial,Helvetica,sans-serif;color:${INK};">${esc(str(b.guestName) || "Ospite (nome non indicato)")}</div>`;

  // 3) Riepilogo soggiorno
  const n = num(b.nights);
  const people = peopleLabel("it", b.adults, b.children);
  const stayLine = [n !== undefined && n > 0 ? countLabel("it", "night", n) : "", people].filter(Boolean).join(" · ");
  const place = [str(input.structureName), str(b.roomLabel)].filter(Boolean).join(" · ");
  const arrival = fmtDay(b.checkIn, "it");
  const departure = fmtDay(b.checkOut, "it");
  const rows: string[] = [];
  if (place) rows.push(kvRow("Struttura · camera", esc(place)));
  if (arrival) rows.push(kvRow("Arrivo", esc(arrival) + (str(b.arrivalTime) ? ` <span style="color:#6b7280;font-weight:400;">· previsto alle ${esc(str(b.arrivalTime))}</span>` : str(b.checkInFrom) ? ` <span style="color:#6b7280;font-weight:400;">· dalle ${esc(str(b.checkInFrom))}</span>` : "")));
  if (departure) rows.push(kvRow("Partenza", esc(departure) + (str(b.checkOutBy) ? ` <span style="color:#6b7280;font-weight:400;">· entro ${esc(str(b.checkOutBy))}</span>` : "")));
  if (stayLine) rows.push(kvRow("Soggiorno", esc(stayLine)));
  if (str(b.code)) rows.push(kvRow("Codice", `<span style="font-family:Consolas,Menlo,monospace;letter-spacing:.5px;">${esc(str(b.code))}</span>`));
  if (fmtIso(b.bookedOn)) rows.push(kvRow("Prenotata il", esc(fmtIso(b.bookedOn))));
  const extras: string[] = [];
  if (b.parking) extras.push("Parcheggio richiesto");
  if (num(b.cribs)) extras.push(`Culle/lettini: ${num(b.cribs)}`);
  if (extras.length) rows.push(kvRow("Servizi", esc(extras.join(" · "))));
  const summary = rows.length ? `<div style="margin-top:12px;">${kvTable(rows)}</div>` : "";

  // 4) Importi. Sulle cancellazioni NON si mostra "Da incassare" (non c'è più nulla da incassare).
  const amountRows: string[] = [];
  const stay = num(b.stay), extrasN = num(b.extras), cleaning = num(b.cleaning), tax = num(b.cityTax), total = num(b.total), paid = num(b.paid), due = num(b.due), pay = num(b.payment);
  if (ev === "payment" && pay && pay > 0) amountRows.push(kvRow("Incasso registrato", `<span style="color:${EVENT_STYLE.payment.fg};font-size:16px;">${esc(m(pay))}</span>`));
  if (stay !== undefined && (extrasN || cleaning)) amountRows.push(kvRow("Soggiorno", esc(m(stay))));
  if (extrasN && extrasN > 0) amountRows.push(kvRow("Extra", esc(m(extrasN))));
  if (cleaning && cleaning > 0) amountRows.push(kvRow("Pulizia", esc(m(cleaning))));
  const shownTotal = total ?? stay;
  if (shownTotal !== undefined) amountRows.push(kvRow(ev === "cancel" ? "Totale (annullato)" : "Totale", `<span style="font-size:16px;">${esc(m(shownTotal))}</span>`));
  // Sulle cancellazioni tassa di soggiorno, commissione e netto non sono pertinenti (non si incassa nulla): restano solo "Totale (annullato)" e "Già incassato".
  if (ev !== "cancel" && tax && tax > 0) amountRows.push(kvRow("Tassa di soggiorno", esc(m(tax))));
  if (paid && paid > 0) amountRows.push(kvRow(ev === "cancel" ? "Già incassato" : "Incassato", esc(m(paid))));
  if (ev !== "cancel" && due !== undefined && shownTotal !== undefined) amountRows.push(kvRow("Da incassare", `<span style="color:${due > 0 ? "#A31D12" : "#0B6B3F"};">${esc(m(due))}</span>`));
  if (ev !== "cancel" && num(b.commission) !== undefined && (num(b.commission) as number) > 0) {
    amountRows.push(kvRow(`Commissione OTA${b.commissionEstimate ? " (stima)" : ""}`, esc(`− ${m(b.commission)}`)));
    if (num(b.net) !== undefined) amountRows.push(kvRow(`Netto per la struttura${b.netEstimate ?? b.commissionEstimate ? " (stima)" : ""}`, `<b>${esc(m(b.net))}</b>`));
  }
  const amounts = amountRows.length ? sectionTitle("Importi") + cardBox(kvTable(amountRows)) : "";

  // 5) Ospite: contatti cliccabili
  const g: string[] = [];
  const phone = str(b.guestPhone), email = str(b.guestEmail), country = countryName(b.guestCountry);
  if (phone) {
    const wa = waNumber(phone);
    g.push(kvRow("Telefono", `<a href="tel:${esc(telHref(phone))}" style="color:${aText};text-decoration:none;">${esc(phone)}</a>`
      + (wa ? ` &nbsp;<a href="https://wa.me/${esc(wa)}" target="_blank" style="color:#0B6B3F;text-decoration:none;font-weight:700;">WhatsApp</a>` : "")));
  }
  if (email) g.push(kvRow("Email", `<a href="mailto:${esc(email)}" style="color:${aText};text-decoration:none;">${esc(email)}</a>`));
  if (country) g.push(kvRow("Paese", esc(country)));
  const guestBox = g.length ? sectionTitle("Ospite") + kvTable(g) : "";

  // 6) Richieste e note evidenziate
  const req = multiline(b.guestRequests), note = multiline(b.note); // a capo preservati (white-space:pre-wrap)
  const reqBox = (req || note)
    ? sectionTitle("Richieste") + cardBox(
      (req ? `<div style="font:600 13px/1.5 Arial,Helvetica,sans-serif;color:#6b4a00;">Richieste dell'ospite</div><div style="white-space:pre-wrap;font:14px/1.5 Arial,Helvetica,sans-serif;color:${INK};margin-top:2px;">${esc(req)}</div>` : "")
      + (note ? `<div style="font:600 13px/1.5 Arial,Helvetica,sans-serif;color:#6b4a00;${req ? "margin-top:8px;" : ""}">Note</div><div style="white-space:pre-wrap;font:14px/1.5 Arial,Helvetica,sans-serif;color:${INK};margin-top:2px;">${esc(note)}</div>` : ""),
      { bg: "#FFF8E1", border: "#F2D98B" })
    : "";

  // 7) Pulsante: scheda prenotazione
  const cta = input.ctaUrl ? ctaButtonHtml(input.ctaUrl, input.ctaLabel || (b.bookingId ? "Apri la prenotazione →" : "Apri le prenotazioni →"), accent) : "";
  return top + title + summary + amounts + guestBox + reqBox + cta;
}

/** HTML completo dell'email al titolare. Con `booking` usa il layout ricco; con il solo `text` un layout curato ma semplice. */
export function notifyEmailHtml(input: NotifyEmailInput): { html: string; subject: string } {
  const accent = normHex(input.accent || input.brand?.accent, "#4F46E5");
  const hasBooking = !!input.booking && Object.values(input.booking).some((v) => v !== undefined && v !== null && v !== "");
  let body: string;
  if (hasBooking) body = bookingBody(input, accent);
  else {
    const badge = input.event ? `<div style="margin-bottom:14px;">${eventBadgeHtml(input.event)}</div>` : "";
    const chip = input.channelLabel ? `<div style="margin-bottom:12px;">${channelChipHtml(input.channelLabel)}</div>` : "";
    const cta = input.ctaUrl ? ctaButtonHtml(input.ctaUrl, input.ctaLabel || "Apri →", accent) : "";
    body = badge + chip + textBlockHtml(input.text || "") + cta;
  }
  const b = input.booking ?? {};
  const subject = input.subject
    || notifySubject(input.event, { guestName: b.guestName, channelLabel: input.channelLabel, checkIn: b.checkIn, structureName: input.structureName || input.brand?.name, amount: b.payment, currency: b.currency });
  const html = emailShell({
    lang: "it",
    title: subject,
    preheader: hasBooking ? preheaderOf(input.event, b, input.channelLabel) : str(input.text).slice(0, 110),
    accent,
    brand: input.brand,
    bodyHtml: body,
  });
  return { html, subject };
}
