import { NextResponse } from "next/server";
import { isInternalRequest, requireUser, isErr, rateLimited, safeHttpUrl, safeColor } from "@/lib/server-auth";
import QRCode from "qrcode";
import { buildVoucherPdf } from "@/lib/voucher-pdf";
import { buildQuotePdf, type QuotePdfRoom, type QuotePdfExtra } from "@/lib/quote-pdf";
import { uploadPublicAsset, dataUrlToBytes } from "@/lib/email-assets";
import { et, emailLang } from "@/lib/email-i18n";
import { fmtDMY } from "@/lib/dates";
import { ymdRome } from "@/lib/dates-rome";
import { asMailEvent, type Brand } from "@/lib/mail/shell";
import {
  brandFrom, cancelEmailHtml, checkinOwnerEmailHtml, explicitLang, messageEmailHtml, policyTextFor, reminderEmailHtml, statusKindOf, subReceiptEmailHtml, subReceiptSubject,
  voucherEmailHtml, voucherSubject, voucherTotals, type CheckinGuest, type GuestBookingPayload, type SubReceiptPayload,
} from "@/lib/mail/guest-emails";
import { notifyEmailHtml, type NotifyBookingData } from "@/lib/mail/notify-email";
import { str, cleanWebsite, validEmail, addressOnly, fromHeader, langFromEmailDomain } from "@/lib/mail/send-utils";

export const runtime = "nodejs";

// Mittente: dominio da verificare su Resend (fino ad allora si invia solo verso la propria email).
const FROM = process.env.RESEND_FROM || "onboarding@resend.dev";
// RESEND_FROM può essere "Nome <indirizzo>": qui serve solo l'indirizzo (il nome visualizzato lo decide fromHeader).
const FROM_ADDR = addressOnly(FROM);
const KEY = process.env.RESEND_API_KEY || "";
const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://xenora.it").replace(/\/+$/, "");

type BookingPayload = GuestBookingPayload;

// Dati in ingresso nominali dal chiamante: brand "grezzo" (logoUrl/color sono alias di logo/accent).
type InBrand = Brand & { logoUrl?: string; color?: string };

// Logo: URL http(s) vero, oppure data: URI png/jpeg (diventa un URL pubblico in resolveLogoUrl). Altro → niente logo.
const cleanLogo = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  if (/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/i.test(s)) return s;
  return safeHttpUrl(s);
};
function normBrand(raw?: InBrand | null): Brand | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Brand = {
    name: str(raw.name, 120) || undefined, logo: cleanLogo(raw.logo ?? raw.logoUrl), address: str(raw.address, 200) || undefined,
    phone: str(raw.phone, 60) || undefined, email: str(raw.email, 160) || undefined, website: cleanWebsite(raw.website),
    accent: safeColor(raw.accent ?? raw.color), cin: str(raw.cin, 60) || undefined, vat: str(raw.vat, 60) || undefined,
  };
  return Object.values(out).some(Boolean) ? out : undefined;
}

class MailInputError extends Error {}

// Carica il logo (data: URI) su storage pubblico e restituisce il brand con l'URL vero, pronto per
// l'HTML dell'email (le email non mostrano immagini data:). Se manca la configurazione Supabase o il
// caricamento fallisce, il logo viene tolto (si vedono le iniziali nel colore struttura) invece di un'immagine rotta.
async function resolveLogoUrl(brand?: Brand): Promise<Brand | undefined> {
  if (!brand?.logo) return brand;
  const parsed = dataUrlToBytes(brand.logo);
  if (!parsed) return brand; // già un URL vero, o formato non gestito: lascialo così com'è
  const url = await uploadPublicAsset(parsed.bytes, parsed.ext, parsed.contentType);
  return { ...brand, logo: url ?? undefined };
}

// fromName: nome visualizzato del mittente (es. "B&b Spigolehouse") — l'indirizzo resta sempre
// quello verificato su Resend, cambia solo il nome che l'ospite vede in casella, come fa Octorate
// (mittente = la struttura, non la piattaforma). "Xenora" resta il default per le email di sistema.
async function send(to: string, subject: string, html: string, replyTo?: string, attachments?: { filename: string; content: string }[], fromName?: string) {
  if (!validEmail(to)) throw new MailInputError("Indirizzo email del destinatario non valido");
  const reply = validEmail(replyTo) ? replyTo.trim() : undefined; // reply_to non valido: si omette (l'email parte comunque)
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromHeader(fromName, FROM_ADDR), to: [to.trim()], subject: String(subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 300), html, ...(reply ? { reply_to: reply } : {}), ...(attachments && attachments.length ? { attachments } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Resend ${res.status}`);
  return data;
}

// Dati strutturati della prenotazione per le notifiche al titolare: si copiano SOLO i campi noti, con tipi controllati.
const NOTIFY_STR = ["bookingId", "code", "status", "guestName", "guestPhone", "guestEmail", "guestCountry", "roomLabel", "checkIn", "checkOut", "arrivalTime", "checkInFrom", "checkOutBy", "bookedOn", "currency", "guestRequests", "note"] as const;
const NOTIFY_NUM = ["nights", "adults", "children", "cribs", "stay", "extras", "cleaning", "cityTax", "total", "paid", "due", "payment", "commission", "net"] as const;
function sanitizeNotifyBooking(raw: unknown): NotifyBookingData | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of NOTIFY_STR) {
    // Richieste e note dell'ospite: solo trim e taglio (gli a capo servono, la mail li mostra con pre-wrap).
    const v = k === "guestRequests" || k === "note" ? (typeof r[k] === "string" ? (r[k] as string).replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500) : "") : str(r[k], 200);
    if (v) out[k] = v;
  }
  for (const k of NOTIFY_NUM) { const v = r[k]; if (typeof v === "number" && Number.isFinite(v)) out[k] = v; }
  for (const k of ["parking", "commissionEstimate", "netEstimate"] as const) if (typeof r[k] === "boolean") out[k] = r[k];
  return Object.keys(out).length ? (out as NotifyBookingData) : undefined;
}

const safeName = (s: unknown, fallback: string) => String(s || fallback).replace(/[^A-Za-z0-9_-]/g, "-") || fallback;

export async function POST(req: Request) {
  if (!KEY) return NextResponse.json({ ok: false, error: "RESEND_API_KEY non configurata" }, { status: 500 });
  // Niente relay aperto: serve un utente loggato e ammesso (browser) oppure la firma interna (webhook, cron, conferme).
  if (!isInternalRequest(req)) {
    const who = await requireUser(req);
    if (isErr(who)) return who;
    if (rateLimited("email:" + who.userId, 60, 60_000)) return NextResponse.json({ ok: false, error: "troppe_richieste" }, { status: 429 });
  }
  let body: {
    kind?: string; booking?: BookingPayload; brand?: InBrand; checkinUrl?: string; manageUrl?: string; guests?: CheckinGuest[]; arrival?: string; operatorEmail?: string; schedina?: string;
    to?: string; subject?: string; text?: string; accent?: string; replyTo?: string; ctaUrl?: string; ctaLabel?: string; subscription?: SubReceiptPayload;
    // Notifica al titolare (kind "notify"): evento, canale e struttura; i dati della prenotazione stanno in `booking` (vedi NotifyBookingData).
    event?: string; channelLabel?: string; structureName?: string; lang?: string;
    // Dati strutturati del preventivo (kind: "quote"), usati per generare il PDF allegato SOLO come
    // fallback (vedi pdfBase64 sotto) quando il chiamante non fornisce già un PDF pronto.
    guestName?: string; checkIn?: string; checkOut?: string; nights?: number; adults?: number; children?: number;
    rooms?: QuotePdfRoom[]; total?: number; deposit?: number; ref?: string; extras?: QuotePdfExtra[];
    // PDF già pronto generato lato browser (kind: "quote") catturando l'anteprima reale (QuoteDoc) con
    // html2canvas+jsPDF: quando presente si usa questo, niente rigenerazione via pdf-lib.
    pdfBase64?: string; pdfFilename?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "JSON non valido" }, { status: 400 }); }
  const b: BookingPayload = body.booking || {};
  // URL e colori finiscono dentro href/src/style: si accettano solo http(s) ed esadecimali (niente javascript:, niente stili iniettati).
  body.ctaUrl = safeHttpUrl(body.ctaUrl); body.checkinUrl = safeHttpUrl(body.checkinUrl) ?? ""; body.manageUrl = safeHttpUrl(body.manageUrl);
  body.accent = safeColor(body.accent);
  b.color = safeColor(b.color); b.mapsUrl = safeHttpUrl(typeof b.mapsUrl === "string" ? b.mapsUrl.trim().replace(/'/g, "%27") : b.mapsUrl); b.website = cleanWebsite(b.website);
  const inBrand = normBrand(body.brand);
  try {
    if (body.kind === "voucher") {
      if (!b.guestEmail) return NextResponse.json({ ok: false, error: "Email ospite mancante" }, { status: 400 });
      const L = emailLang(b);
      const kind = statusKindOf(b);
      const brand = await resolveLogoUrl(brandFrom(b));
      // QR per gestire la prenotazione dal telefono (come su Octorate): inquadrandolo si apre lo
      // stesso link del pulsante "Gestisci". Se generazione/caricamento falliscono l'email parte comunque, solo senza QR.
      let qrUrl: string | undefined;
      const qrTarget = body.manageUrl || body.checkinUrl;
      if (qrTarget && kind !== "cancelled") {
        try {
          const qrBytes = await QRCode.toBuffer(qrTarget, { type: "png", margin: 1, width: 220 });
          qrUrl = (await uploadPublicAsset(qrBytes, "png", "image/png")) ?? undefined;
        } catch { /* niente QR se fallisce: non blocca l'invio */ }
      }
      // Allega il voucher in PDF (carta intestata). Se il chiamante ha già catturato l'anteprima reale (VoucherDoc via html2canvas,
      // vedi BookingDrawer) usa quella — fotocopia esatta di quanto si vede a schermo. Solo se manca (es. invii automatici senza
      // browser) si ripiega sul disegno pdf-lib. Se anche quello fallisce l'email parte comunque senza allegato, ma l'errore
      // viene registrato e segnalato nella risposta (`pdf: "skipped"`), non ingoiato.
      let attachments: { filename: string; content: string }[] | undefined;
      let pdf: "attached" | "fallback" | "skipped" = "skipped";
      try {
        if (body.pdfBase64) {
          attachments = [{ filename: body.pdfFilename || `voucher-${safeName(b.code, "prenotazione")}.pdf`, content: body.pdfBase64 }];
          pdf = "attached";
        } else {
          const totals = voucherTotals(b);
          const bytes = await buildVoucherPdf({ ...b, ...totals, lang: L, statusKey: kind, cancelPolicy: policyTextFor(b, L), manageUrl: body.manageUrl });
          attachments = [{ filename: `voucher-${safeName(b.code, "prenotazione")}.pdf`, content: Buffer.from(bytes).toString("base64") }];
          pdf = "fallback";
        }
      } catch (e) { console.error("email voucher: PDF non generato, invio senza allegato:", e instanceof Error ? e.message : e); attachments = undefined; }
      const html = voucherEmailHtml(b, { checkinUrl: body.checkinUrl || "", manageUrl: body.manageUrl, qrUrl, brand });
      const data = await send(b.guestEmail, voucherSubject(b), html, b.structureEmail, attachments, b.structureName);
      return NextResponse.json({ ok: true, id: data?.id, pdf });
    }
    if (body.kind === "cancel") {
      if (!b.guestEmail) return NextResponse.json({ ok: false, error: "Email ospite mancante" }, { status: 400 });
      const L = emailLang(b);
      const subject = `${et(L, "Prenotazione annullata")} ${b.code || ""} · ${b.structureName || "Xenora"}`.replace(/\s+/g, " ").trim();
      const brand = await resolveLogoUrl(brandFrom(b));
      const data = await send(b.guestEmail, subject, cancelEmailHtml(b, { brand }), b.structureEmail, undefined, b.structureName);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "checkin") {
      // Avviso al titolare: solo nomi, numero di ospiti e link alla scheda. Nessun numero di documento, luogo/data di nascita in email.
      const to = body.operatorEmail || b.structureEmail;
      if (!to) return NextResponse.json({ ok: false, error: "Email struttura mancante" }, { status: 400 });
      const subject = `Check-in online · ${b.code || ""} · ${b.guestName || ""}`.replace(/\s+/g, " ").replace(/[ ·]+$/, "").trim();
      const brand = await resolveLogoUrl(brandFrom(b));
      const ctaUrl = body.ctaUrl || `${SITE_ORIGIN}/prenotazioni${b.bookingId ? `?b=${encodeURIComponent(b.bookingId)}` : ""}`;
      const html = checkinOwnerEmailHtml(b, body.guests || [], { brand, arrival: body.arrival, ctaUrl, schedina: body.schedina });
      const data = await send(to, subject, html, b.guestEmail, undefined, "Xenora");
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "checkin_reminder") {
      if (!b.guestEmail) return NextResponse.json({ ok: false, error: "Email ospite mancante" }, { status: 400 });
      const L = emailLang(b);
      const subject = `${et(L, "Completa il check-in online")} · ${b.structureName || "Xenora"}`.trim();
      const brand = await resolveLogoUrl(brandFrom(b));
      const data = await send(b.guestEmail, subject, reminderEmailHtml(b, { checkinUrl: body.checkinUrl || "", brand }), b.structureEmail, undefined, b.structureName);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "guest_message") {
      // Messaggio libero all'ospite (modelli/automazioni/guida): invio reale via Resend, non una bozza mailto. Niente PDF.
      if (!body.to) return NextResponse.json({ ok: false, error: "Email ospite mancante" }, { status: 400 });
      // Senza `lang` esplicita: dalla scheda ospite/Paese/telefono in `booking` (emailLang); se non c'è nessun dato, ripiego sul dominio del destinatario (.de, .fr…).
      const hasGuestHints = !!(b.lang || b.guestLanguage || b.guestCountry || b.guestPhone);
      const L = body.lang ? explicitLang(body.lang) : (hasGuestHints ? undefined : langFromEmailDomain(body.to)) ?? emailLang(b);
      const structureName = inBrand?.name || b.structureName;
      const subject = body.subject || (structureName ? et(L, "Messaggio da {name}", { name: structureName }) : et(L, "Messaggio"));
      const accent = body.accent || inBrand?.accent || b.color || "#285f92";
      const brand = await resolveLogoUrl(inBrand || (b.structureName ? { ...brandFrom(b), accent } : undefined));
      const html = messageEmailHtml({ lang: L, title: body.subject || et(L, "Messaggio"), text: body.text || "", accent, brand, ctaUrl: body.ctaUrl, ctaLabel: body.ctaLabel });
      const data = await send(body.to, subject, html, body.replyTo || b.structureEmail || brand?.email, undefined, brand?.name || b.structureName);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "quote") {
      if (!body.to) return NextResponse.json({ ok: false, error: "Email destinatario mancante" }, { status: 400 });
      // Lingua del preventivo (quella scelta nella pagina Preventivi): oggetto, pulsante e nota di pagamento seguono la stessa lingua.
      const L = explicitLang(body.lang);
      const subject = body.subject || et(L, "Preventivo");
      const accent = body.accent || inBrand?.accent || "#285f92";
      const brand = inBrand ? { ...inBrand, accent } : (b.structureName ? { ...brandFrom(b), accent } : undefined);
      // Per l'HTML dell'email serve un URL pubblico vero (niente data: URI); il PDF invece usa il
      // logo originale più sotto, incorporandolo direttamente nel file.
      const emailBrand = await resolveLogoUrl(brand);
      // Pulsante di azione (Conferma e paga): "Conferma e paga online →" arriva dal chiamante in italiano → si traduce se è il testo predefinito.
      const DEF_CTA = "Conferma e paga online →";
      const isPayCta = !body.ctaLabel || body.ctaLabel === DEF_CTA;
      const html = messageEmailHtml({
        lang: L, title: subject, text: body.text || "", accent, brand: emailBrand,
        ctaUrl: body.ctaUrl, ctaLabel: isPayCta ? et(L, DEF_CTA) : body.ctaLabel,
        note: body.ctaUrl && isPayCta ? et(L, "Pagamento sicuro con Stripe · carta, PayPal, Klarna e altri metodi.") : undefined,
      });
      // Allega il preventivo in PDF SOLO se c'è davvero un preventivo: il PDF già generato lato browser (anteprima reale QuoteDoc, con logo
      // garantito visibile) oppure dati reali (camere o totale) da cui disegnarlo con buildQuotePdf. Senza né l'uno né l'altro (guida ospiti,
      // conferma da Preventivi, avvisi di annullamento/modifica/pagamento/stripe, "Su misura") l'email parte senza allegato: prima usciva
      // un "preventivo-preventivo.pdf" vuoto.
      const hasQuoteData = (Array.isArray(body.rooms) && body.rooms.length > 0) || (typeof body.total === "number" && body.total > 0);
      let attachments: { filename: string; content: string }[] | undefined;
      let pdf: "attached" | "fallback" | "skipped" | "none" = "none";
      if (body.pdfBase64) {
        attachments = [{ filename: body.pdfFilename || `preventivo-${safeName(body.ref, "preventivo")}.pdf`, content: body.pdfBase64 }];
        pdf = "attached";
      } else if (hasQuoteData) {
        try {
          const bytes = await buildQuotePdf({
            ref: body.ref,
            structureName: brand?.name, structureEmail: brand?.email, phone: brand?.phone, address: brand?.address,
            guestName: body.guestName, guestEmail: body.to,
            checkIn: body.checkIn, checkOut: body.checkOut, nights: body.nights, adults: body.adults, children: body.children,
            rooms: body.rooms, total: body.total, deposit: body.deposit,
            color: accent, logo: brand?.logo, website: brand?.website, cin: brand?.cin, vat: brand?.vat,
            extras: body.extras,
          });
          attachments = [{ filename: `preventivo-${safeName(body.ref, "preventivo")}.pdf`, content: Buffer.from(bytes).toString("base64") }];
          pdf = "fallback";
        } catch (e) { console.error("email quote: PDF non generato, invio senza allegato:", e instanceof Error ? e.message : e); pdf = "skipped"; }
      }
      const data = await send(body.to, subject, html, body.replyTo || brand?.email, attachments, brand?.name);
      return NextResponse.json({ ok: true, id: data?.id, pdf });
    }
    if (body.kind === "notify") {
      // FRENO: massimo 20 notifiche al minuto per destinatario (per istanza; 8 era troppo poco per un primo import OTA con molte prenotazioni). Oltre, si
      // scartano e si risponde {ok:true, skipped:"throttled"} (i chiamanti che registrano l'invio devono controllare `skipped`): un import o una cancellazione
      // di massa non deve mai produrre centinaia di email. Per fermare tutto subito: variabile NOTIFY_EMAILS_PAUSED=1.
      if (process.env.NOTIFY_EMAILS_PAUSED === "1" || notifyThrottled(String(body.to || ""))) return NextResponse.json({ ok: true, skipped: "throttled" });
      // Notifica interna alla struttura (nuova prenotazione/modifica/cancellazione/pagamento/messaggio/recensione/avviso). Contratto retro-compatibile:
      //  - solo `text`/`subject`/`ctaUrl` (altri chiamanti) → stessa shell curata, testo libero;
      //  - in più `event`, `brand` {name, logoUrl, color, address}, `channelLabel`, `structureName`, `booking` → layout ricco (logo, badge evento, chip canale, importi, contatti).
      // Niente PDF/allegati.
      if (!body.to) return NextResponse.json({ ok: false, error: "Email destinatario mancante" }, { status: 400 });
      const brand = await resolveLogoUrl(inBrand ?? (str(body.structureName, 120) ? { name: str(body.structureName, 120) } : undefined));
      const { html, subject } = notifyEmailHtml({
        event: asMailEvent(body.event), brand, accent: body.accent || brand?.accent, channelLabel: str(body.channelLabel, 80) || undefined,
        structureName: str(body.structureName, 120) || brand?.name, booking: sanitizeNotifyBooking(body.booking),
        text: body.text, subject: body.subject ? String(body.subject) : undefined, ctaUrl: body.ctaUrl, ctaLabel: body.ctaLabel ? str(body.ctaLabel, 80) : undefined,
      });
      const data = await send(body.to, subject, html, undefined, undefined, "Xenora");
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "sub_receipt") {
      // Ricevuta pagamento abbonamento all'ABBONATO. Il webbook la invoca SOLO con SUB_INVOICING_LIVE attivo.
      const to = body.to;
      if (!to) return NextResponse.json({ ok: false, error: "Email destinatario mancante" }, { status: 400 });
      const s = body.subscription || {};
      const subject = subReceiptSubject(s);
      const fmt = (u?: number | null) => { if (!u) return ""; try { return fmtDMY(ymdRome(u * 1000)); } catch { return ""; } };
      const data = await send(to, subject, subReceiptEmailHtml(s, fmt), body.replyTo);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    return NextResponse.json({ ok: false, error: "kind sconosciuto" }, { status: 400 });
  } catch (e) {
    if (e instanceof MailInputError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Errore invio" }, { status: 502 });
  }
}


// Contatore in memoria (per istanza serverless): finestra di 60 secondi, massimo 20 notifiche per destinatario.
const NOTIFY_HITS = new Map<string, number[]>();
function notifyThrottled(to: string): boolean {
  const now = Date.now();
  const list = (NOTIFY_HITS.get(to) ?? []).filter((t) => now - t < 60000);
  if (list.length >= 20) { NOTIFY_HITS.set(to, list); return true; }
  list.push(now); NOTIFY_HITS.set(to, list);
  return false;
}
