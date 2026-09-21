import { NextResponse } from "next/server";

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
}

function shell(title: string, accent: string, inner: string) {
  return `<!doctype html><html lang="it"><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2430;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e8ec;">
      <div style="background:${accent};padding:22px 24px;color:#fff;">
        <div style="font-size:13px;opacity:.85;letter-spacing:.5px;text-transform:uppercase;">${esc(title)}</div>
      </div>
      <div style="padding:24px;">${inner}</div>
    </div>
    <div style="text-align:center;color:#9aa1ac;font-size:11px;margin-top:14px;">Inviato con Xenora · Digital Solution</div>
  </div></body></html>`;
}

function row(label: string, value: string) {
  return `<tr><td style="padding:7px 0;color:#6b7280;font-size:13px;">${esc(label)}</td><td style="padding:7px 0;text-align:right;font-size:14px;font-weight:600;color:#1f2430;">${value}</td></tr>`;
}

function voucherHtml(b: BookingPayload, checkinUrl: string, manageUrl?: string) {
  const accent = b.color || "#285f92";
  const cur = b.currency || "€";
  const people = `${b.adults ?? 1} adulti${b.children ? ` · ${b.children} bambini` : ""}`;
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
      <a href="${esc(checkinUrl)}" style="display:block;text-align:center;background:${accent};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px;border-radius:10px;">Fai il check-in online →</a>
    </div>
    <p style="margin:8px 0 0;font-size:12px;color:#9aa1ac;text-align:center;">Compila i dati prima dell'arrivo: risparmi tempo al tuo check-in.</p>
    ${manageUrl ? `<div style="margin:12px 0 6px;">
      <a href="${esc(manageUrl)}" style="display:block;text-align:center;background:#fff;border:1px solid ${accent};color:${accent};text-decoration:none;font-weight:700;font-size:14px;padding:12px;border-radius:10px;">Gestisci la prenotazione (modifica o annulla)</a>
    </div>` : ""}
    ${b.address ? `<p style="margin:18px 0 0;font-size:13px;color:#4b5563;">📍 ${esc(b.address)}</p>` : ""}
    ${b.phone ? `<p style="margin:4px 0 0;font-size:13px;color:#4b5563;">📞 ${esc(b.phone)}</p>` : ""}
  `;
  return shell(`${b.structureName || "Conferma prenotazione"}`, accent, inner);
}

// Email di annullamento (all'ospite): conferma la cancellazione ed eventuale rimborso.
function cancelHtml(b: BookingPayload) {
  const accent = b.color || "#b4472e";
  const cur = b.currency || "€";
  const refunded = typeof b.refunded === "number" ? b.refunded : 0;
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
  return shell("Prenotazione annullata", accent, inner);
}

interface CheckinGuest { role?: string; firstName?: string; lastName?: string; sex?: string; birthDate?: string; birthPlace?: string; citizenship?: string; docType?: string; docNumber?: string; docPlace?: string }
function checkinHtml(b: BookingPayload, guests: CheckinGuest[], arrival?: string) {
  const accent = b.color || "#0E9F6E";
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
  return shell("Check-in ricevuto", accent, inner);
}

async function send(to: string, subject: string, html: string, replyTo?: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `Xenora <${FROM}>`, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Resend ${res.status}`);
  return data;
}

export async function POST(req: Request) {
  if (!KEY) return NextResponse.json({ ok: false, error: "RESEND_API_KEY non configurata" }, { status: 500 });
  let body: { kind?: string; booking?: BookingPayload; checkinUrl?: string; manageUrl?: string; guests?: CheckinGuest[]; arrival?: string; operatorEmail?: string; to?: string; subject?: string; text?: string; accent?: string; replyTo?: string; ctaUrl?: string; ctaLabel?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "JSON non valido" }, { status: 400 }); }
  const b = body.booking || {};
  try {
    if (body.kind === "voucher") {
      if (!b.guestEmail) return NextResponse.json({ ok: false, error: "Email ospite mancante" }, { status: 400 });
      const subject = `Conferma prenotazione ${b.code || ""} · ${b.structureName || "Xenora"}`.trim();
      const data = await send(b.guestEmail, subject, voucherHtml(b, body.checkinUrl || "", body.manageUrl), b.structureEmail);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "cancel") {
      if (!b.guestEmail) return NextResponse.json({ ok: false, error: "Email ospite mancante" }, { status: 400 });
      const subject = `Prenotazione annullata ${b.code || ""} · ${b.structureName || "Xenora"}`.trim();
      const data = await send(b.guestEmail, subject, cancelHtml(b), b.structureEmail);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "checkin") {
      const to = body.operatorEmail || b.structureEmail;
      if (!to) return NextResponse.json({ ok: false, error: "Email struttura mancante" }, { status: 400 });
      const subject = `Check-in online · ${b.code || ""} · ${b.guestName || ""}`.trim();
      const data = await send(to, subject, checkinHtml(b, body.guests || [], body.arrival), b.guestEmail);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    if (body.kind === "quote") {
      if (!body.to) return NextResponse.json({ ok: false, error: "Email destinatario mancante" }, { status: 400 });
      const subject = body.subject || "Preventivo";
      const accent = body.accent || "#285f92";
      // Pulsante di azione (Conferma e paga): l'URL viaggia dentro il bottone, non come testo lungo.
      const cta = body.ctaUrl
        ? `<div style="margin:22px 0 6px;">
             <a href="${esc(body.ctaUrl)}" style="display:block;text-align:center;background:${accent};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px;border-radius:10px;">${esc(body.ctaLabel || "Conferma e paga online →")}</a>
           </div>
           <p style="margin:8px 0 0;font-size:12px;color:#9aa1ac;text-align:center;">Pagamento sicuro con Stripe · carta, PayPal, Klarna e altri metodi.</p>`
        : "";
      const html = shell(subject, accent, `<div style="white-space:pre-wrap;font-size:14px;line-height:1.6;color:#1f2430;">${esc(body.text || "")}</div>${cta}`);
      const data = await send(body.to, subject, html, body.replyTo);
      return NextResponse.json({ ok: true, id: data?.id });
    }
    return NextResponse.json({ ok: false, error: "kind sconosciuto" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Errore invio" }, { status: 502 });
  }
}
