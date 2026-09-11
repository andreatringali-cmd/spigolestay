import { NextResponse } from "next/server";

// Webhook Channex: qui arrivano le notifiche di nuova prenotazione/modifica/cancellazione dalle OTA.
// URL da registrare su Channex (HTTPS): https://xenora-app.vercel.app/api/channex/webhook
//
// Flusso previsto (fase successiva, quando ci sarà il datastore server):
//   1. Ricevi il webhook (booking revision id).
//   2. Scarica la prenotazione: GET /booking_revisions/{id}
//   3. Salvala nel gestionale.
//   4. Conferma la ricezione: acknowledge booking.
// Per ora: accetta e risponde 200 (Channex richiede sempre 200, anche in caso di errore interno).
export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}));
    // Log leggero (senza dati sensibili) per verificare la ricezione durante i test.
    console.log("[channex webhook]", JSON.stringify(payload).slice(0, 500));
  } catch { /* ignora corpo non valido */ }
  // Sempre 200: evita che Channex reinvii all'infinito il webhook.
  return NextResponse.json({ received: true }, { status: 200 });
}

// GET di cortesia: utile per verificare che l'endpoint sia raggiungibile.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "channex-webhook", ready: true }, { status: 200 });
}
