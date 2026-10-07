import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyApprovalToken, notifyAccessApproved } from "@/lib/allowlist-approve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Click dal pulsante "✅ Approva accesso" nell'email di richiesta demo. Link firmato (vedi
// src/lib/allowlist-approve.ts): niente login richiesto, la sicurezza è nella firma HMAC che solo
// il server conosce. Aggiunge l'email in access_allowlist e mostra una paginetta di conferma.
function page(title: string, message: string, ok: boolean) {
  const color = ok ? "#0E9F6E" : "#D64545";
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title></head>
  <body style="font-family:system-ui,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f7f7f5;margin:0">
    <div style="max-width:420px;padding:32px;text-align:center">
      <div style="font-size:40px">${ok ? "✅" : "⚠️"}</div>
      <h1 style="font-size:18px;color:${color};margin:12px 0 8px">${title}</h1>
      <p style="color:#555;font-size:14px;line-height:1.5">${message}</p>
    </div>
  </body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = (url.searchParams.get("e") || "").trim().toLowerCase();
  const ts = url.searchParams.get("t") || "";
  const sig = url.searchParams.get("s") || "";

  const verified = verifyApprovalToken(email, ts, sig);
  if (!verified) return page("Link non valido", "Il link è scaduto o non valido. Approva l'accesso manualmente da Accessi nell'app.", false);

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !service) return page("Configurazione mancante", "Il server non è configurato per approvare automaticamente. Approva da Accessi nell'app.", false);

  const admin = createClient(supaUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.from("access_allowlist").upsert(
    { email: verified, note: "richiesta demo (approvata via email)", added_by: "email-link" },
    { onConflict: "email" }
  );
  if (error) return page("Errore", `Non sono riuscito ad approvare ${verified}: ${error.message}`, false);

  const notified = await notifyAccessApproved(verified);
  return page(
    "Accesso approvato",
    `${verified} può ora accedere a Xenora con il login Google.` + (notified ? " Gli abbiamo inviato un'email per avvisarlo." : " Non sono riuscito ad avvisarlo via email: avvisalo tu direttamente."),
    true
  );
}
