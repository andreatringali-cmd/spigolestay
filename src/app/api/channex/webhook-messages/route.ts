import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { internalFetch } from "@/lib/server-auth";
import { logInvio } from "@/lib/invii-log";
import { parseChannexMessage, appendOtaMessage, messageHookSecret } from "@/lib/channex-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Webhook Channex "message": un ospite ha scritto su Booking.com/Airbnb/Expedia.
// Il messaggio entra nel thread dell'ospite dentro lo stato del proprietario (stessa chiave dei messaggi WhatsApp),
// quindi pallino in sidebar, suono e "da leggere" funzionano senza altro. Poi un'email al proprietario (al massimo una ogni 30 min per prenotazione).
// URL registrato da /api/channex/webhook-setup: https://xenora.it/api/channex/webhook-messages
// Risponde SEMPRE 200: Channex ritenta all'infinito se non lo riceve.
const NOTIFY_EVERY_MS = 30 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const secret = messageHookSecret();
    if (secret && req.headers.get("x-xenora-secret") !== secret) {
      console.log("[channex webhook-messages] segreto non valido");
      return NextResponse.json({ received: true });
    }
    const msg = parseChannexMessage(await req.json().catch(() => ({})));
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!msg || !url || !service) return NextResponse.json({ received: true });
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: maps } = await admin.from("channex_map").select("tenant_id").eq("channex_property_id", msg.propertyId).limit(1);
    const tenantId = (maps?.[0] as { tenant_id?: string } | undefined)?.tenant_id;
    if (!tenantId) { console.log("[channex webhook-messages] property non collegata", msg.propertyId); return NextResponse.json({ received: true }); }

    let added: { guestId: string; channel: string } | null = null;
    for (let attempt = 0; attempt < 3 && !added; attempt++) {
      const { data: row } = await admin.from("app_state").select("data, rev").eq("user_id", tenantId).maybeSingle();
      const blob = ((row?.data ?? {}) as Record<string, string>) || {};
      const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;
      const res = appendOtaMessage(blob, msg, Date.now());
      if (res.status === "duplicate") return NextResponse.json({ received: true });
      if (res.status === "no_booking") { console.log("[channex webhook-messages] prenotazione non trovata", msg.bookingId); return NextResponse.json({ received: true }); }
      let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", tenantId);
      if (rev !== null) write = write.eq("rev", rev);
      const { data: updated } = await write.select("rev");
      if (updated && updated.length > 0) added = { guestId: res.guestId, channel: res.channel };
    }
    if (!added) { console.log("[channex webhook-messages] conflitto di rev, messaggio non salvato", msg.id); return NextResponse.json({ received: true }); }

    // Email al proprietario, senza martellarlo: una per prenotazione ogni 30 minuti.
    const since = new Date(Date.now() - NOTIFY_EVERY_MS).toISOString();
    const { data: recent } = await admin.from("invii_log").select("id").eq("tenant_id", tenantId).eq("job", "ota_msg").eq("ref", msg.bookingId).gt("at", since).limit(1);
    if (!recent?.length) {
      const { data: u } = await admin.auth.admin.getUserById(tenantId);
      const to = u?.user?.email;
      if (to) {
        const origin = process.env.NEXT_PUBLIC_APP_URL || "https://xenora.it";
        const preview = msg.text.length > 280 ? msg.text.slice(0, 280) + "…" : msg.text;
        const r = await internalFetch(`${new URL(req.url).origin}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "guest_message", to, subject: `Nuovo messaggio su ${added.channel}`, text: `Un ospite ti ha scritto su ${added.channel}:\n\n«${preview}»\n\nRispondi da ${origin}/messaggi`, booking: { structureName: "Xenora" } }),
        });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: unknown };
        await logInvio(admin, tenantId, { job: "ota_msg", ref: msg.bookingId, channel: "email", ok: !!(r.ok && j?.ok), detail: r.ok && j?.ok ? `${added.channel} → ${to}` : `errore ${r.status}: ${typeof j?.error === "string" ? j.error : JSON.stringify(j?.error ?? "")}` });
      }
    }
  } catch (e) { console.log("[channex webhook-messages] errore", (e as Error)?.message); }
  return NextResponse.json({ received: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "channex-webhook-messages", ready: true });
}
