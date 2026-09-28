import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Richiesta demo dal sito vetrina (xenoradigitalsolutions.it/.com) → email a info@xenora.it via Resend.
// Pubblica e cross-origin (la vetrina è su un altro dominio): abilita CORS per i domini vetrina.
const FROM = process.env.RESEND_FROM || "prenotazioni@xenora.it";
const KEY = process.env.RESEND_API_KEY || "";
const TO = process.env.DEMO_REQUEST_TO || "info@xenora.it";

const ALLOWED_ORIGINS = [
  "https://xenoradigitalsolutions.it",
  "https://www.xenoradigitalsolutions.it",
  "https://xenoradigitalsolutions.com",
  "https://www.xenoradigitalsolutions.com",
];
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get("origin"));
  try {
    const b = await req.json().catch(() => ({})) as Record<string, string>;
    // Honeypot anti-spam: se compilato, fingi successo e non inviare.
    if (String(b.website || b.company_url || "").trim()) return NextResponse.json({ ok: true }, { headers: cors });

    const name = String(b.name || "").trim().slice(0, 120);
    const email = String(b.email || "").trim().slice(0, 160);
    const phone = String(b.phone || "").trim().slice(0, 60);
    const structure = String(b.structure || "").trim().slice(0, 160);
    const message = String(b.message || "").trim().slice(0, 2000);

    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: "Nome ed email validi sono obbligatori." }, { status: 400, headers: cors });
    }
    if (!KEY) return NextResponse.json({ ok: false, error: "Invio email non configurato." }, { status: 500, headers: cors });

    const html = `
      <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1f2430">
        <h2 style="margin:0 0 12px">Nuova richiesta demo · Xenora</h2>
        <table style="border-collapse:collapse">
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Nome</td><td style="padding:4px 0"><b>${esc(name)}</b></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Email</td><td style="padding:4px 0">${esc(email)}</td></tr>
          ${phone ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Telefono</td><td style="padding:4px 0">${esc(phone)}</td></tr>` : ""}
          ${structure ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Struttura</td><td style="padding:4px 0">${esc(structure)}</td></tr>` : ""}
        </table>
        ${message ? `<p style="margin:14px 0 0;color:#6b7280">Messaggio</p><p style="margin:4px 0;white-space:pre-wrap">${esc(message)}</p>` : ""}
        <hr style="margin:18px 0;border:none;border-top:1px solid #e5e7eb">
        <p style="color:#9aa3b2;font-size:12px;margin:0">Inviata dal form "Richiedi una demo" della vetrina.</p>
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Xenora <${FROM}>`, to: [TO], subject: `Richiesta demo — ${name}`, html, reply_to: email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ ok: false, error: data?.message || `Invio fallito (${res.status})` }, { status: 502, headers: cors });

    return NextResponse.json({ ok: true }, { headers: cors });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error)?.message ?? "errore" }, { status: 500, headers: cors });
  }
}
