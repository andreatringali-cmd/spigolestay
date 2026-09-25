import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { buildVoucherPdf } from "@/lib/voucher-pdf";
import { buildQuotePdf, type QuotePdfRoom, type QuotePdfExtra } from "@/lib/quote-pdf";
import { uploadPublicAsset, dataUrlToBytes } from "@/lib/email-assets";

export const runtime = "nodejs";

// Mittente: dominio da verificare su Resend (fino ad allora si invia solo verso la propria email).
const FROM = process.env.RESEND_FROM || "onboarding@resend.dev";
const KEY = process.env.RESEND_API_KEY || "";

const esc = (s: unknown) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c));
const fmtDate = (iso?: string) => {
  if (!iso) return "";
  try { return new Date(iso + "T00:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }); } catch { return iso; }
};

interface BookingPayload {
  code?: string; structureName?: string; structureEmail?: string; guestName?: string; guestEmail?: string;
  roomType?: string; unitName?: string; checkIn?: string; checkOut?: string; nights?: number;
  adults?: number; children?: number; total?: number; currency?: string;
  checkInFrom?: string; checkOutBy?: string; address?: string; phone?: string; color?: string;
  ratePlan?: string; cancelPolicy?: string; refunded?: number;
  logo?: string; website?: string; cin?: string; vat?: string;
}

// Identità della struttura da mostrare come carta intestata (header + footer).
interface Brand { name?: string; logo?: string; address?: string; phone?: string; email?: string; website?: string; accent?: string; cin?: string; vat?: string }
function brandFrom(b: BookingPayload): Brand {
  return { name: b.structureName, logo: b.logo, address: b.address, phone: b.phone, email: b.structureEmail, website: b.website, accent: b.color, cin: b.cin, vat: b.vat };
}

// Blocco logo (immagine se presente, altrimenti pastiglia con l'iniziale nel colore struttura).
// A questo punto brand.logo, se presente, è già un URL http(s) vero (vedi resolveLogoUrl): le
// email non mostrano immagini incorporate come data: URI, quindi qui non se ne tenta mai il render.
function logoBlock(brand: Brand, accent: string) {
  if (brand.logo && /^https?:\/\//i.test(brand.logo)) {
    return `<img src="${esc(brand.logo)}" alt="${esc(brand.name || "")}" width="52" height="52" style="display:block;width:52px;height:52px;border-radius:12px;object-fit:contain;background:#fff;border:1px solid #eceef1;" />`;
  }
  const initials = esc((brand.name || "XN").replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "XN");
  return `<div style="width:52px;height:52px;border-radius:12px;background:${accent};color:#fff;text-align:center;line-height:52px;font-weight:800;font-size:20px;font-family:Arial,sans-serif;">${initials}</div>`;
}

// Carica il logo (data: URI) su storage pubblico e restituisce il brand con l'URL vero, pronto per
// l'HTML dell'email. Se manca la configurazione Supabase o il caricamento fallisce, il logo viene
// tolto (si vede comunque la pastiglia con le iniziali) invece di lasciare un'immagine rotta.
async function resolveLogoUrl(brand?: Brand): Promise<Brand | undefined> {
  if (!brand?.logo) return brand;
  const parsed = dataUrlToBytes(brand.logo);
  if (!parsed) return brand; // già un URL vero, o formato non gestito: lascialo così com'è
  const url = await uploadPublicAsset(parsed.bytes, parsed.ext, parsed.contentType);
  return { ...brand, logo: url ?? undefined };
}

// Carta intestata: barra colore struttura + header con logo/nome/contatti + corpo + footer con recapiti.
function shell(title: string, accent: string, inner: string, brand?: Brand) {
  const bd = brand || {};
  const name = esc(bd.name || "");
  const contacts = [bd.phone, bd.email, bd.website].filter(Boolean).map(esc).join(" · ");
  const legal = [bd.cin ? `CIN ${esc(bd.cin)}` : "", bd.vat ? `P.IVA ${esc(bd.vat)}` : ""].filter(Boolean).join(" · ");
  const header = bd.name
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td width="52" valign="top" style="padding-right:14px;">${logoBlock(bd, accent)}</td>
          <td valign="middle">
            <div style="font-size:19px;font-weight:800;color:#1f2430;letter-spacing:-.2px;">${name}</div>
            ${bd.address ? `<div style="font-size:12px;color:#8a919c;margin-top:2px;">${esc(bd.address)}</div>` : ""}
            <div style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:${accent};font-weight:700;margin-top:4px;">${esc(title)}</div>
          </td>
        </tr>
      </table>`
    : `<div style="font-size:13px;letter-spacing:.5px;text-transform:uppercase;color:${accent};font-weight:700;">${esc(title)}</div>`;
  const footer = bd.name
    ? `<div style="margin-top:14px;background:#fff;border:1px solid #e6e8ec;border-radius:14px;padding:16px 20px;color:#8a919c;font-size:11px;line-height:1.6;">
         <div style="font-weight:700;color:#5b616c;">${name}</div>
         ${bd.address ? `<div>${esc(bd.address)}</div>` : ""}
         ${contacts ? `<div>${contacts}</div>` : ""}
         ${legal ? `<div>${legal}</div>` : ""}
       </div>
       <div style="text-align:center;color:#b9bfc9;font-size:10px;margin-top:8px;">Inviato con Xenora</div>`
    : `<div style="text-align:center;color:#9aa1ac;font-size:11px;margin-top:14px;">Inviato con Xenora · Digital Solution</div>`;
  return `<!doctype html><html lang="it"><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2430;">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e8ec;">
      <div style="height:5px;background:${accent};"></div>
      <div style="padding:22px 24px 18px;border-bottom:1px solid #f0f1f4;">${header}</div>
      <div style="padding:22px 24px 26px;">${inner}</div>
    </div>
    ${footer}
  </div></body></html>`;
}

function row(label: string, value: string) {
  return `<tr><td style="padding:7px 0;color:#6b7280;font-size:13px;">${esc(label)}</td><td style="padding:7px 0;text-align:right;font-size:14px;font-weight:600;color:#1f2430;">${value}</td></tr>`;
}

async function voucherHtml(b: BookingPayload, checkinUrl: string, manageUrl?: string) {
  const accent = b.color || "#285f92";
  const cur = b.currency || "€";
  const people = `${b.adults ?? 1} adulti${b.children ? ` · ${b.children} bambini` : ""}`;
  const brand = await resolveLogoUrl(brandFrom(b));
  // QR per gestire la prenotazione dal telefono (come su Octorate): inquadrandolo si apre lo
  // stesso link del pulsante "Gestisci". Se generazione/caricamento falliscono l'email parte
  // comunque, solo senza QR.
  let qrHtml = "";
  const qrTarget = manageUrl || checkinUrl;
  if (qrTarget) {
    try {
      const qrBytes = await QRCode.toBuffer(qrTarget, { type: "png", margin: 1, width: 220 });
      const qrUrl = await uploadPublicAsset(qrBytes, "png", "image/png");
      if (qrUrl) {
        qrHtml = `<div style="margin:18px 0 0;text-align:center;">
          <img src="${esc(qrUrl)}" width="120" height="120" alt="QR gestione prenotazione" style="display:inline-block;border:1px solid #eceef1;border-radius:10px;padding:6px;background:#fff;" />
          <div style="margin-top:6px;font-size:11px;color:#9aa1ac;">Inquadra per gestire la prenotazione dal telefono</div>
        </div>`;
      }
    } catch { /* niente QR se fallisce: non blocca l'invio */ }
  }
  const inner = `
    <p style="margin:0 0 4px;font-size:16px;">Ciao <b>${esc((b.guestName || "").split(" ")[0] || "ospite")}</b>,</p>
    <p style="margin:0 0 18px;font-size:14px;color:#4b5563;">la tua prenotazione presso <b>${esc(b.structureName)}</b> è confermata. Ecco il riepilogo.</p>
    <div style="background:#f8f9fb;border:1px solid #eceef1;border-radius:12px;padding:14px 16px;margin-bottom:18px;">
      <div style="font-size:12px;color:#9aa1ac;">Codice prenotazione</div>
      <div style="font-size:20px;font-weight:800;letter-spacing:1px;color:${accent};font-family:monospace;">${esc(b.code || "")}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      ${row("Struttura", esc(b.structureName))}
      ${row("Sistemazione", esc([b.roomType, b.unitName].filter(Boolean).join(" · ")))}
      ${row("Check-in", esc(fmtDate(b.checkIn)) + (b.checkInFrom ? ` <span style="color:#9aa1ac;font-weight:400;">dalle ${esc(b.checkInFrom)}</span>` : ""))}
      ${row("Check-out", esc(fmtDate(b.checkOut)) + (b.checkOutBy ? ` <span style="color:#9aa1ac;font-weight:400;">entro ${esc(b.checkOutBy)}</span>` : ""))}
      ${row("Ospiti", esc(people))}
      ${b.ratePlan ? row("Tariffa", esc(b.ratePlan)) : ""}
      ${typeof b.total === "number" && b.total > 0 ? row("Totale soggiorno", `${cur} ${b.total.toLocaleString("it-IT")}`) : ""}
    </table>
    ${b.cancelPolicy ? `<div style="margin:14px 0 0;background:#f8f9fb;border:1px solid #eceef1;border-radius:10px;padding:12px 14px;font-size:12px;color:#4b5563;"><b style="color:#1f2430;">Condizioni di cancellazione</b><br>${esc(b.cancelPolicy)}</div>` : ""}
    <div style="margin:22px 0 6px;">
      <a href="${esc(checkinUrl)}" style="display:block;text-align:center;background:${accent};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px;border-radius:10px;">Gestisci la tua prenotazione →</a>
    </div>
    <p style="margin:8px 0 0;font-size:12px;color:#9aa1ac;text-align:center;">Completa i dati mancanti, fai il <b>check-in online</b>, <b>paga</b> il saldo e invia le tue <b>richieste</b> — tutto da qui.</p>
    ${manageUrl ? `<div style="margin:12px 0 6px;">
      <a href="${esc(manageUrl)}" style="display:block;text-align:center;background:#fff;border:1px solid ${accent};color:${accent};text-decoration:none;font-weight:700;font-size:14px;padding:12px;border-radius:10px;">Gestisci la prenotazione (modifica o annulla)</a>
    </div>` : ""}
    ${qrHtml}
  `;
  return shell("Conferma prenotazione", accent, inner, brand);
}

// Email di annullamento (all'ospite): conferma la cancellazione ed eventuale rimborso.
async function cancelHtml(b: BookingPayload) {
  const accent = b.color || "#b4472e";
  const cur = b.currency || "€";
  const refunded = typeof b.refunded === "number" ? b.refunded : 0;
  const brand = await resolveLogoUrl(brandFrom(b));
  const inner = `
    <p style="margin:0 0 4px;font-size:16px;">Ciao <b>${esc((b.guestName || "").split(" ")[0] || "ospite")}</b>,</p>
    <p style="margin:0 0 18px;font-size:14px;color:#4b5563;">la tua prenotazione presso <b>${esc(b.structureName)}</b> è stata <b>annullata</b>.</p>
    <table style="width:100%;border-collapse:collapse;">
      ${row("Codice", `<span style="font-family:monospace;">${esc(b.code || "")}</span>`)}
      ${row("Struttura", esc(b.structureName))}
      ${row("Periodo", esc(fmtDate(b.checkIn)) + " → " + esc(fmtDate(b.checkOut)))}
    </table>
    <div style="margin:16px 0 0;background:#f8f9fb;border:1px solid #eceef1;border-radius:10px;padding:14px 16px;">
      ${refunded > 0
        ? `<div style="font-size:14px;color:#0E7C4A;font-weight:700;">Rimborso emesso: ${cur} ${refunded.toLocaleString("it-IT")}</div>
           <div style="margin-top:4px;font-size:12px;color:#6b7280;">L'importo tornerà sul metodo di pagamento usato entro 5–10 giorni lavorativi (tempi della banca).</div>`
        : `<div style="font-size:14px;color:#1f2430;font-weight:700;">Nessun rimborso previsto</div>
           <div style="margin-top:4px;font-size:12px;color:#6b7280;">${esc(b.cancelPolicy || "Secondo le condizioni della tariffa prenotata.")}</div>`}
    </div>
    <p style="margin:18px 0 0;font-size:13px;color:#4b5563;">Ci dispiace vederti annullare. Sarai sempre il benvenuto in futuro.</p>
  `;
  return shell("Prenotazione annullata", accent, inner, brand);
}

interface CheckinGuest { role?: string; firstName?: string; lastName?: string; sex?: string; birthDate?: string; birthPlace?: string; citizenship?: string; docType?: string; docNumber?: string; docPlace?: string }
async function checkinHtml(b: BookingPayload, guests: CheckinGuest[], arrival?: string) {
  const accent = b.color || "#0E9F6E";
  const brand = await resolveLogoUrl(brandFrom(b));
  const list = guests.map((g, i) => `
    <div style="border:1px solid #eceef1;border-radius:10px;padding:12px 14px;margin-bottom:10px;">
      <div style="font-size:12px;color:#9aa1ac;margin-bottom:6px;">${i === 0 ? "Ospite principale" : `Ospite ${i + 1}`}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        ${row("Nome", esc([g.firstName, g.lastName].filter(Boolean).join(" ")))}
        ${g.sex ? row("Sesso", esc(g.sex)) : ""}
        ${g.birthDate ? row("Nascita", esc(g.birthDate) + (g.birthPlace ? ` · ${esc(g.birthPlace)}` : "")) : ""}
        ${g.citizenship ? row("Cittadinanza", esc(g.citizenship)) : ""}
        ${g.docNumber ? row("Documento", esc([g.docType, g.docNumber].filter(Boolean).join(" · ")) + (g.docPlace ? ` · ${esc(g.docPlace)}` : "")) : ""}
      </table>
    </div>`).join("");
  const inner = `
    <p style="margin:0 0 14px;font-size:15px;">Nuovo <b>check-in online</b> completato per la prenotazione <b style="font-family:monospace;">${esc(b.code || "")}</b>.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
      ${row("Struttura", esc(b.structureName))}
      ${row("Sistemazione", esc([b.roomType, b.unitName].filter(Boolean).join(" · ")))}
      ${row("Arrivo", esc(fmtDate(b.checkIn)))}
      ${arrival ? row("Orario previsto", esc(arrival)) : ""}
    </table>
    <div style="font-size:12px;color:#9aa1ac;margin-bottom:8px;">Dati ospiti raccolti (${guests.length})</div>
    ${list}
    <p style="margin:14px 0 0;font-size:12px;color:#9aa1ac;">Apri il gestionale → Alloggiati Web per generare il tracciato e inviarlo alla Questura.</p>
  `;
  return shell("Check-in ricevuto", accent, inner, brand);
}

// Sollecito check-in all'OSPITE: email diretta con il link per compilare il check-in online.
async function reminderHtml(b: BookingPayload, checkinUrl: string) {
  const accent = b.color || "#0E9F6E";
  const brand = await resolveLogoUrl(brandFrom(b));
  const inner = `
    <p style="margin:0 0 4px;font-size:16px;">Ciao <b>${esc((b.guestName || "").split(" ")[0] || "ospite")}</b>,</p>
    <p style="margin:0 0 18px;font-size:14px;color:#4b5563;">manca poco al tuo arrivo presso <b>${esc(b.structureName)}</b>. Completa il <b>check-in online</b> adesso: è veloce e al tuo arrivo eviti l'attesa.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
      ${b.code ? row("Codice", `<span style="font-family:monospace;">${esc(b.code)}</span>`) : ""}
      ${b.checkIn ? row("Arrivo", esc(fmtDate(b.checkIn)) + (b.checkInFrom ? ` <span style="color:#9aa1ac;font-weight:400;">dalle ${esc(b.checkInFrom)}</span>` : "")) : ""}
    </table>
    <div style="margin:20px 0 6px;">
      <a href="${esc(checkinUrl)}" style="display:block;text-align:center;background:${accent};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px;border-radius:10px;">Fai il check-in online →</a>
    </div>
    <p style="margin:8px 0 0;font-size:12px;color:#9aa1ac;text-align:center;">Compila i dati prima dell'arrivo: risparmi tempo al check-in.</p>
  `;
  return shell("Completa il check-in", accent, inner, brand);
}

// Ricevuta di pagamento dell'ABBONAMENTO Xenora (email sobria all'abbonato).
interface SubReceiptPayload { plan?: string | null; planName?: string | null; totalCents?: number; currency?: string; periodStart?: number | null; periodEnd?: number | null; invoiceId?: string }
function subReceiptHtml(s: SubReceiptPayload) {
  const accent = "#285f92";
  const cur = (s.currency || "EUR").toUpperCase() === "EUR" ? "€" : (s.currency || "EUR");
  const amount = typeof s.totalCents === "number" ? `${cur} ${(s.totalCents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2 })}` : "";
  const plan = s.planName || (s.plan ? s.plan.charAt(0).toUpperCase() + s.plan.slice(1) : "");
  const fmt = (u?: number | null) => { if (!u) return ""; try { return new Date(u * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }); } catch { return ""; } };
  const periodo = s.periodStart && s.periodEnd ? `${fmt(s.periodStart)} → ${fmt(s.periodEnd)}` : "";
  const inner = `
    <p style="margin:0 0 4px;font-size:16px;">Grazie,</p>
    <p style="margin:0 0 18px;font-size:14px;color:#4b5563;">abbiamo ricevuto il pagamento del tuo abbonamento <b>Xenora</b>. Ecco il riepilogo.</p>
    <table style="width:100%;border-collapse:collapse;">
      ${plan ? row("Piano", esc(plan)) : ""}
      ${periodo ? row("Periodo", esc(periodo)) : ""}
      ${amount ? row("Importo", esc(amount)) : ""}
      ${s.invoiceId ? row("Riferimento", `<span style="font-family:monospace;">${esc(s.invoiceId)}</span>`) : ""}
    </table>
    <div style="margin:18px 0 0;background:#f8f9fb;border:1px solid #eceef1;border-radius:10px;padding:12px 14px;font-size:12px;color:#4b5563;">
      Il <b>documento fiscale</b> relativo a questo pagamento ti sarà recapitato a seguire.
    </div>
    <p style="margin:18px 0 0;font-size:13px;color:#4b5563;">Grazie per aver scelto Xenora.</p>
  `;
  return shell("Ricevuta abbonamento", accent, inner);
}

async function send(to: string, subject: string, html: string, replyTo?: string, attachments?: { filename: string; content: string }[]) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `Xenora <${FROM}>`, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}), ...(attachments && attachments.length ? { attachments } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Resend ${res.status}`);
  return data;
}

export async function POST(req: Request) {
  if (!KEY) return NextResponse.json({ ok: false, error: "RESEND_API_KEY non configurata" }, { status: 500 });
  let body: {
    kind?: string; booking?: BookingPayload; brand?: Brand; checkinUrl?: string; manageUrl?: string; guests?: CheckinGuest[]; arrival?: string; operatorEmail?: string;
    to?: string; subject?: string; text?: string; accent?: string; replyTo?: string; ctaUrl?: string; ctaLabel?: string; subscription?: SubReceiptPayload;
    // Dati strutturati del preventivo (kind: "quote"), usati per generare il PDF allegato.
    guestName?: string; checkIn?: string; checkOut?: string; nights?: number; adults?: number; children?: number;
    rooms?: QuotePdfRoom[]; total?: number; deposit?: number; ref?: string; extras?: QuotePdfExtra[];
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "JSON non valido" }, { status: 400 }); }
  const b = body.booking || {};
  try {
    if (body.kind === "voucher") {
      if (!b.guestEmail) return NextResponse.json({ ok: false, error: "Email ospite mancante" }, { status: 400 });
      const subject = `Conferma prenotazione ${b.code || ""} · ${b.structureName || "Xenora"}`.trim();
      // Allega il voucher in PDF (carta intestata). Se la generazione fallisce, invia comunque l'email.
      let attachments: { filename: string; content: string }[] | undefined;
      try {
        const pdf = await buildVoucherPdf({ ...b, manageUrl: body.manageUrl });
        attachments = [{ filename: `voucher-${(b.code || "prenotazione").replace(/[^A-Za-z0-9_-]/g, "")}.pdf`, content: Buffer.from(pdf).toString("base64") }];
      } catch { attachments = undefined; }
      const data = await send(b.guestEmail, subject, await voucherHtml(b, body.checkinUrl || "", body.manageUrl), b.structureEmail, attachments);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "cancel") {
      if (!b.guestEmail) return NextResponse.json({ ok: false, error: "Email ospite mancante" }, { status: 400 });
      const subject = `Prenotazione annullata ${b.code || ""} · ${b.structureName || "Xenora"}`.trim();
      const data = await send(b.guestEmail, subject, await cancelHtml(b), b.structureEmail);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "checkin") {
      const to = body.operatorEmail || b.structureEmail;
      if (!to) return NextResponse.json({ ok: false, error: "Email struttura mancante" }, { status: 400 });
      const subject = `Check-in online · ${b.code || ""} · ${b.guestName || ""}`.trim();
      const data = await send(to, subject, await checkinHtml(b, body.guests || [], body.arrival), b.guestEmail);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "checkin_reminder") {
      if (!b.guestEmail) return NextResponse.json({ ok: false, error: "Email ospite mancante" }, { status: 400 });
      const subject = `Completa il check-in online · ${b.structureName || "Xenora"}`.trim();
      const data = await send(b.guestEmail, subject, await reminderHtml(b, body.checkinUrl || ""), b.structureEmail);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "guest_message") {
      // Messaggio libero all'ospite (modelli/automazioni): invio reale via Resend, non una bozza mailto.
      if (!body.to) return NextResponse.json({ ok: false, error: "Email ospite mancante" }, { status: 400 });
      const subject = body.subject || (b.structureName ? `Messaggio da ${b.structureName}` : "Messaggio");
      const accent = body.accent || b.color || "#285f92";
      const brand = await resolveLogoUrl(body.brand || (b.structureName ? { ...brandFrom(b), accent } : undefined));
      const title = body.subject || "Messaggio";
      const html = shell(title, accent, `<div style="white-space:pre-wrap;font-size:14px;line-height:1.6;color:#1f2430;">${esc(body.text || "")}</div>`, brand);
      const data = await send(body.to, subject, html, body.replyTo || b.structureEmail);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "quote") {
      if (!body.to) return NextResponse.json({ ok: false, error: "Email destinatario mancante" }, { status: 400 });
      const subject = body.subject || "Preventivo";
      const accent = body.accent || body.brand?.accent || "#285f92";
      const brand = body.brand ? { ...body.brand, accent } : (b.structureName ? { ...brandFrom(b), accent } : undefined);
      // Per l'HTML dell'email serve un URL pubblico vero (niente data: URI); il PDF invece usa il
      // logo originale più sotto, incorporandolo direttamente nel file.
      const emailBrand = await resolveLogoUrl(brand);
      // Pulsante di azione (Conferma e paga): l'URL viaggia dentro il bottone, non come testo lungo.
      const cta = body.ctaUrl
        ? `<div style="margin:22px 0 6px;">
             <a href="${esc(body.ctaUrl)}" style="display:block;text-align:center;background:${accent};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px;border-radius:10px;">${esc(body.ctaLabel || "Conferma e paga online →")}</a>
           </div>
           <p style="margin:8px 0 0;font-size:12px;color:#9aa1ac;text-align:center;">Pagamento sicuro con Stripe · carta, PayPal, Klarna e altri metodi.</p>`
        : "";
      const html = shell(subject, accent, `<div style="white-space:pre-wrap;font-size:14px;line-height:1.6;color:#1f2430;">${esc(body.text || "")}</div>${cta}`, emailBrand);
      // Allega il preventivo in PDF (carta intestata). Se la generazione fallisce, invia comunque l'email.
      let attachments: { filename: string; content: string }[] | undefined;
      try {
        const pdf = await buildQuotePdf({
          ref: body.ref,
          structureName: brand?.name, structureEmail: brand?.email, phone: brand?.phone, address: brand?.address,
          guestName: body.guestName, guestEmail: body.to,
          checkIn: body.checkIn, checkOut: body.checkOut, nights: body.nights, adults: body.adults, children: body.children,
          rooms: body.rooms, total: body.total, deposit: body.deposit,
          color: accent, logo: brand?.logo, website: brand?.website, cin: brand?.cin, vat: brand?.vat,
          extras: body.extras,
        });
        attachments = [{ filename: `preventivo-${(body.ref || "preventivo").replace(/[^A-Za-z0-9_-]/g, "-")}.pdf`, content: Buffer.from(pdf).toString("base64") }];
      } catch { attachments = undefined; }
      const data = await send(body.to, subject, html, body.replyTo, attachments);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "sub_receipt") {
      // Ricevuta pagamento abbonamento all'ABBONATO. Il webbook la invoca SOLO con SUB_INVOICING_LIVE attivo.
      const to = body.to;
      if (!to) return NextResponse.json({ ok: false, error: "Email destinatario mancante" }, { status: 400 });
      const s = body.subscription || {};
      const subject = `Ricevuta abbonamento Xenora${s.planName || s.plan ? ` · ${s.planName || s.plan}` : ""}`.trim();
      const data = await send(to, subject, subReceiptHtml(s), body.replyTo);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    return NextResponse.json({ ok: false, error: "kind sconosciuto" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Errore invio" }, { status: 502 });
  }
}
