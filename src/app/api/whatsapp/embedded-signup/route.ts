// WhatsApp Embedded Signup (Meta) — collegamento automatico del numero WhatsApp
// Business del cliente, senza passare manualmente da Meta Business Settings.
//
// Riceve dal client: { code, wabaId, phoneNumberId } ottenuti dal popup di Meta
// (FB.login con config_id dedicato + postMessage "WA_EMBEDDED_SIGNUP"), e fa
// lato server tutto ciò che finora si è fatto a mano in Graph API Explorer:
//   1) scambia il `code` per un access token (oauth/access_token)
//   2) POST {phone_number_id}/register con un PIN a 6 cifre (sblocca il numero,
//      altrimenti resta "In sospeso" e non manda/riceve nulla)
//   3) POST {waba_id}/subscribed_apps (nessun body) — senza questa chiamata il
//      webhook (route separata, già pronta) non riceve MAI i messaggi in arrivo
// Infine salva token + phone_id cifrati per il tenant con saveWhatsappCfg
// (stesso storage già usato dal collegamento manuale in src/lib/whatsapp.ts).
//
// ── PASSAGGI MANUALI richiesti su Meta prima che questo possa funzionare ───
// (da fare una sola volta, nell'app Meta di Xenora, su developers.facebook.com)
//  1. Aggiungere il prodotto "Facebook Login for Business" all'app.
//  2. In "Facebook Login for Business" → creare una Configuration per
//     l'Embedded Signup di WhatsApp (tipo "WhatsApp Business"); annotare il
//     "Configuration ID" → va in env NEXT_PUBLIC_META_WA_CONFIG_ID.
//  3. In "Facebook Login for Business" → Impostazioni: aggiungere "xenora.it"
//     (e l'eventuale dominio di anteprima) agli "Allowed Domains" per il JS SDK.
//  4. In App Dashboard → Impostazioni → Basic: prendere "App ID" e "App Secret"
//     → env META_APP_ID (server) = NEXT_PUBLIC_META_APP_ID (client, stesso
//     valore, l'App ID non è segreto) e META_APP_SECRET (SOLO server, mai
//     esposto col prefisso NEXT_PUBLIC_).
//  5. Verificare che il prodotto WhatsApp sia collegato all'app e che l'app
//     abbia i permessi whatsapp_business_management / whatsapp_business_messaging
//     (in modalità sviluppo funziona solo con utenti test; per clienti reali
//     serve l'App Review / Advanced Access, oppure l'app deve essere di un
//     Meta Tech Provider abilitato).
//  6. Il webhook resta quello unico già configurato (route
//     /api/whatsapp/webhook, invariata): non serve rifarlo per ogni cliente.
import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { saveWhatsappCfg } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v21.0";
const randomPin = () => String(Math.floor(100000 + Math.random() * 900000));

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json({ ok: false, error: "meta_not_configured", message: "Collegamento automatico non ancora configurato: usa il collegamento manuale." }, { status: 503 });
  }

  const b = await req.json().catch(() => ({}));
  const code = String(b?.code || "").trim();
  const wabaId = String(b?.wabaId || "").trim();
  const phoneNumberId = String(b?.phoneNumberId || "").trim();
  if (!code || !wabaId || !phoneNumberId) {
    return NextResponse.json({ ok: false, error: "missing_params", message: "Dati mancanti dal popup Meta (code/waba/phone)." }, { status: 400 });
  }

  try {
    // 1) Scambia il code per un access token (lato server: client_secret non esposto al browser).
    const tokUrl = `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`;
    const tokRes = await fetch(tokUrl);
    const tokJson = await tokRes.json().catch(() => ({}));
    const accessToken: string = tokJson?.access_token || "";
    if (!tokRes.ok || !accessToken) {
      return NextResponse.json({ ok: false, error: "token_exchange_failed", message: tokJson?.error?.message || `Scambio token fallito (HTTP ${tokRes.status}).` }, { status: 502 });
    }

    // 2) Registra il numero (altrimenti resta "In sospeso" e non manda/riceve nulla).
    const regRes = await fetch(`${GRAPH}/${phoneNumberId}/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin: randomPin() }),
    });
    const regJson = await regRes.json().catch(() => ({}));
    if (!regRes.ok) {
      return NextResponse.json({ ok: false, error: "register_failed", message: regJson?.error?.message || `Registrazione numero fallita (HTTP ${regRes.status}).` }, { status: 502 });
    }

    // 3) Iscrive la nostra app al WABA: senza questo il webhook non riceve mai i messaggi in arrivo.
    const subRes = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const subJson = await subRes.json().catch(() => ({}));
    if (!subRes.ok) {
      return NextResponse.json({ ok: false, error: "subscribe_failed", message: subJson?.error?.message || `Iscrizione webhook al WABA fallita (HTTP ${subRes.status}).` }, { status: 502 });
    }

    // 4) Salva token + phone_id cifrati per il tenant (stesso storage del collegamento manuale).
    const saved = await saveWhatsappCfg(auth.admin, auth.tenantId, { token: accessToken, phoneId: phoneNumberId });
    if (!saved.ok) return NextResponse.json({ ok: false, error: "save_failed", message: saved.message }, { status: 500 });

    return NextResponse.json({ ok: true, message: "WhatsApp collegato automaticamente ✓" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server_error", message: (e as Error)?.message ?? "Errore imprevisto." }, { status: 500 });
  }
}
