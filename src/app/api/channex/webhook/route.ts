import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { importBookings, importSingleRevision } from "@/lib/channex-inbound";
import { getBookingRevision } from "@/lib/channex";

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
    const revisionId = String((payload?.payload?.revision_id as string) || (payload?.revision_id as string) || "").trim() || undefined;
    const propertyId = String((payload?.property_id as string) || (payload?.data?.property_id as string) || "").trim() || undefined;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && service) {
      const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
      if (revisionId) {
        // Flusso atteso da Channex in certificazione: il webhook dà solo l'id della revision,
        // la si legge SINGOLARMENTE (non da feed/lista) e si applica/ackka quella sola.
        const got = await getBookingRevision(revisionId);
        if (got.ok && got.revision) {
          const res = await importSingleRevision(admin, got.revision);
          console.log("[channex webhook] import by-id", JSON.stringify({ revisionId, imported: res.imported, cancelled: res.cancelled, acked: res.acked, skipped: res.skipped }));
        } else {
          console.log("[channex webhook] getBookingRevision fallita, fallback a feed", revisionId, got.error);
          const res = await importBookings(admin, propertyId ? { propertyId } : {});
          console.log("[channex webhook] import (fallback feed)", JSON.stringify({ feed: res.feed, imported: res.imported, cancelled: res.cancelled, acked: res.acked, skipped: res.skipped }));
        }
      } else {
        // Payload senza revision_id (es. eventi non-booking): fallback al flusso a feed/lista.
        const res = await importBookings(admin, propertyId ? { propertyId } : {});
        console.log("[channex webhook] import (fallback feed)", JSON.stringify({ feed: res.feed, imported: res.imported, cancelled: res.cancelled, acked: res.acked, skipped: res.skipped }));
      }
    }
  } catch (e) { console.log("[channex webhook] error", (e as Error)?.message); }
  return NextResponse.json({ received: true }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "channex-webhook", ready: true }, { status: 200 });
}
