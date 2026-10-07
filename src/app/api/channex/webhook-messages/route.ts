import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { internalFetch } from "@/lib/server-auth";
import { logInvio } from "@/lib/invii-log";
import { parseChannexMessage, appendOtaMessage, messageHookSecret, type InboundOtaMessage } from "@/lib/channex-messages";
import { AI_CONCIERGE_KEY, parseAiConciergePrefs, otaAutoActive } from "@/lib/aiConcierge";
import { conciergeAnswer, resolveStructureId, type BookingLite } from "@/lib/concierge-engine";
import { loadOrgDatas, mergeOrgData } from "@/lib/concierge-orgdata";
import { logUnanswered } from "@/lib/concierge-unanswered";
import { sendBookingMessage } from "@/lib/channex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // la risposta automatica (AI) gira dopo aver risposto 200 a Channex

// Webhook Channex "message": un ospite ha scritto su Booking.com/Airbnb/Expedia.
// Il messaggio entra nel thread dell'ospite dentro lo stato del proprietario (stessa chiave dei messaggi WhatsApp),
// quindi pallino in sidebar, suono e "da leggere" funzionano senza altro. Poi un'email al proprietario (al massimo una ogni 30 min per prenotazione).
// URL registrato da /api/channex/webhook-setup: https://xenora.it/api/channex/webhook-messages
// Risponde SEMPRE 200: Channex ritenta all'infinito se non lo riceve.
const NOTIFY_EVERY_MS = 30 * 60 * 1000;
const THREADS_KEY = "spigolestay:threads:v1";
const DATA_KEY = "spigolestay:data:v1";

// Risposta automatica del Concierge AI ai messaggi delle OTA: solo se il Concierge è acceso in Impostazioni E la modalità OTA lo prevede
// (mai / solo fuori orario / sempre). Risponde solo se l'AI è sicura (domande di routine); il resto resta a te. Non deve mai far fallire il webhook.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryOtaAutoReply(admin: SupabaseClient<any>, tenantId: string, msg: InboundOtaMessage, info: { blob: Record<string, string>; guestId: string; bookingId: string }) {
  try {
    const prefs = parseAiConciergePrefs(info.blob[AI_CONCIERGE_KEY]);
    if (!otaAutoActive(prefs, new Date())) return;
    let personal: { structures?: unknown; bookings?: unknown; units?: unknown; roomTypes?: unknown; guests?: unknown } = {};
    try { personal = JSON.parse(info.blob[DATA_KEY] || "{}"); } catch { return; }
    const data = mergeOrgData({ structures: personal.structures, bookings: personal.bookings, units: personal.units, roomTypes: personal.roomTypes }, await loadOrgDatas(admin, tenantId));
    const structures = (Array.isArray(data.structures) ? data.structures : []) as { id: string }[];
    const bookings = (Array.isArray(data.bookings) ? data.bookings : []) as BookingLite[];
    const guests = (Array.isArray(personal.guests) ? personal.guests : []) as { id: string; fullName?: string; language?: string }[];
    const guest = guests.find((g) => g.id === info.guestId);
    const structureId = resolveStructureId(structures, bookings, info.guestId, prefs.defaultStructureId);
    if (!structureId) { await logUnanswered(admin, tenantId, { q: msg.text, sid: "", reason: "struttura di riferimento non determinabile", hasBooking: true }); return; }
    let threads: Record<string, { dir: string; text: string }[]> = {};
    try { threads = JSON.parse(info.blob[THREADS_KEY] || "{}"); } catch { threads = {}; }
    const transcript = (threads[info.guestId] ?? []).slice(-5, -1).filter((m) => m.text?.trim()).map((m) => `${m.dir === "out" ? "Struttura" : "Ospite"}: ${m.text.replace(/\s+/g, " ").trim()}`).join("\n") || undefined;
    const result = await conciergeAnswer({
      admin, tenantId, data: { structures: data.structures, bookings: data.bookings, units: data.units, roomTypes: data.roomTypes },
      roomAccessRaw: info.blob["spigolestay:roomaccess"], conciergeFaqRaw: Object.fromEntries(Object.keys(info.blob).filter((k) => k.startsWith("spigolestay:concierge")).map((k) => [k, info.blob[k]])) as Record<string, string>,
      structureId, bookingId: info.bookingId, guest, guestName: guest?.fullName, message: msg.text, transcript, tone: prefs.tone,
    });
    console.log("[channex concierge]", JSON.stringify({ answered: result.answered, reason: result.reason, topic: result.topic, mode: prefs.otaMode, q: msg.text.slice(0, 60) }));
    if (!result.answered || !result.reply) { await logUnanswered(admin, tenantId, { q: msg.text, sid: structureId, reason: result.reason, topic: result.topic, hasBooking: result.hasBooking }); return; }
    const sent = await sendBookingMessage(msg.bookingId, result.reply);
    if (!sent.ok) { console.log("[channex concierge] invio fallito", sent.status); return; }
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row } = await admin.from("app_state").select("data, rev").eq("user_id", tenantId).maybeSingle();
      const blob = ((row?.data ?? {}) as Record<string, string>) || {};
      const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;
      let th: Record<string, unknown[]> = {};
      try { th = JSON.parse(blob[THREADS_KEY] || "{}"); } catch { th = {}; }
      th[info.guestId] = [...(th[info.guestId] ?? []), { id: randomUUID(), dir: "out", text: result.reply, ts: Date.now(), via: "🤖 Concierge AI" }];
      blob[THREADS_KEY] = JSON.stringify(th);
      let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", tenantId);
      if (rev !== null) write = write.eq("rev", rev);
      const { data: updated } = await write.select("rev");
      if (updated && updated.length > 0) return;
    }
  } catch (e) { console.error("[channex concierge]", e); }
}

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

    let added: { guestId: string; bookingId: string; channel: string } | null = null;
    let savedBlob: Record<string, string> = {};
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
      if (updated && updated.length > 0) { added = { guestId: res.guestId, bookingId: res.bookingId, channel: res.channel }; savedBlob = blob; }
    }
    if (!added) { console.log("[channex webhook-messages] conflitto di rev, messaggio non salvato", msg.id); return NextResponse.json({ received: true }); }

    const done = added;
    after(() => tryOtaAutoReply(admin, tenantId, msg, { blob: savedBlob, guestId: done.guestId, bookingId: done.bookingId }));

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
