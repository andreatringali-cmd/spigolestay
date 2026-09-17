import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { importBookings } from "@/lib/channex-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Webhook Channex: notifica di nuova prenotazione/modifica/cancellazione dalle OTA.
// URL da registrare su Channex (HTTPS): https://xenora.it/api/channex/webhook
// Alla ricezione leggiamo il FEED delle booking revision non confermate, le
// importiamo nella app_state del proprietario giusto (via channex_map) e facciamo ACK.
// Rispondiamo SEMPRE 200 (Channex ritenta all'infinito se non riceve 200).
export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}));
    const propertyId = String((payload?.property_id as string) || (payload?.data?.property_id as string) || "").trim() || undefined;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && service) {
      const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
      const res = await importBookings(admin, propertyId ? { propertyId } : {});
      console.log("[channex webhook] import", JSON.stringify({ feed: res.feed, imported: res.imported, cancelled: res.cancelled, acked: res.acked, skipped: res.skipped }));
    }
  } catch (e) { console.log("[channex webhook] error", (e as Error)?.message); }
  return NextResponse.json({ received: true }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "channex-webhook", ready: true }, { status: 200 });
}
