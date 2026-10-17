import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { internalFetch, siteOrigin } from "@/lib/server-auth";
import { logInvio } from "@/lib/invii-log";
import { parseChannexMessage, parseChannexInquiry, inquiryEmailText, echoStoredSince, appendOtaMessage, otaMessageEmailText, pickMessageStore, verifyMessageHook, HOOK_SECRET_HEADER, type InboundOtaMessage } from "@/lib/channex-messages";
import { decideHook } from "@/lib/channex-signature";
import { AI_CONCIERGE_KEY, parseAiConciergePrefs, otaAutoActive } from "@/lib/aiConcierge";
import { conciergeAnswer, resolveStructureId, type BookingLite } from "@/lib/concierge-engine";
import { loadOrgDatas, loadOrgData, mergeOrgData } from "@/lib/concierge-orgdata";
import { logUnanswered } from "@/lib/concierge-unanswered";
import { sendBookingMessage } from "@/lib/channex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // la risposta automatica (AI) gira dopo aver risposto 200 a Channex

// Webhook Channex "message": un ospite ha scritto su Booking.com/Airbnb/Expedia.
// Il messaggio entra nel thread dell'ospite dentro lo stato del proprietario (stessa chiave dei messaggi WhatsApp),
// quindi pallino in sidebar, suono e "da leggere" funzionano senza altro. Poi un'email al proprietario (al massimo una ogni 30 min per prenotazione).
// URL registrato da /api/channex/webhook-setup: https://xenora.it/api/channex/webhook-messages
// Strutture condivise (org): la prenotazione vive in org_state(org_id) e non nel blob personale; la si cerca lì (channex_map.org_id) e poi,
// se serve, in tutte le org di cui il proprietario è membro. Il thread resta nello stato personale di chi ha collegato la property
// (la chiave dei thread non è divisa per organizzazione, vedi splitByOrg in authsync.tsx). Scrittura sempre con lock su rev.
// I messaggi della struttura scritti fuori da Xenora (sender "property") entrano nel thread come "out" ma NON generano email né risposta automatica.
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
    const guests = (Array.isArray(personal.guests) ? personal.guests : []) as { id: string; fullName?: string; language?: string; phone?: string; country?: string }[];
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
    const sendStartedAt = Date.now();
    const sent = await sendBookingMessage(msg.bookingId, result.reply);
    if (!sent.ok) { console.log("[channex concierge] invio fallito", sent.status); return; }
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row } = await admin.from("app_state").select("data, rev").eq("user_id", tenantId).maybeSingle();
      const blob = ((row?.data ?? {}) as Record<string, string>) || {};
      const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;
      let th: Record<string, unknown[]> = {};
      try { th = JSON.parse(blob[THREADS_KEY] || "{}"); } catch { th = {}; }
      // Se l'eco "property" di Channex di QUESTA risposta è già nel thread (arrivato prima di questa scrittura) non si aggiunge una seconda volta.
      // Una risposta uguale ma più vecchia (domanda ripetuta entro 10 minuti) non conta: la risposta è partita davvero e va salvata comunque.
      const cur = (th[info.guestId] ?? []) as { id?: string; dir: string; text: string; ts: number }[];
      if (echoStoredSince(cur, result.reply, sendStartedAt)) return;
      th[info.guestId] = [...cur, { id: randomUUID(), dir: "out", text: result.reply, ts: Date.now(), via: "🤖 Concierge AI" }];
      blob[THREADS_KEY] = JSON.stringify(th);
      let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", tenantId);
      if (rev !== null) write = write.eq("rev", rev);
      const { data: updated } = await write.select("rev");
      if (updated && updated.length > 0) return;
    }
  } catch (e) { console.error("[channex concierge]", e); }
}

/** Carta intestata della struttura della prenotazione per l'avviso (nome, logo, colore): senza prenotazione trovata resta l'avviso senza marchio. */
function notifyBrand(d?: import("@/lib/channex-messages").BookingMailDetails): Record<string, unknown> {
  if (!d?.structureName) return {};
  const logo = d.structureLogo || "";
  return { structureName: d.structureName, accent: d.structureColor || undefined, brand: { name: d.structureName, logoUrl: /^https?:\/\//i.test(logo) ? logo : undefined, color: d.structureColor || undefined } };
}

/** Email al titolare (al massimo una ogni 30 minuti per riferimento): il limite guarda solo gli avvisi RIUSCITI, un invio fallito non zittisce i successivi. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifyOwner(admin: SupabaseClient<any>, tenantId: string, reqUrl: string, o: { ref: string; subject: string; text: string; okDetail: string; channelLabel?: string; details?: import("@/lib/channex-messages").BookingMailDetails }) {
  const since = new Date(Date.now() - NOTIFY_EVERY_MS).toISOString();
  const { data: recent } = await admin.from("invii_log").select("id").eq("tenant_id", tenantId).eq("job", "ota_msg").eq("ref", o.ref).eq("ok", true).gt("at", since).limit(1);
  if (recent?.length) return;
  const { data: u } = await admin.auth.admin.getUserById(tenantId);
  const to = u?.user?.email;
  if (!to) return;
  const r = await internalFetch(`${siteOrigin(new Request(reqUrl))}/api/email`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "notify", to, event: "message", subject: o.subject, text: o.text, ...notifyBrand(o.details), ...(o.channelLabel ? { channelLabel: o.channelLabel } : {}), ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://xenora.it"}/messaggi`, ctaLabel: "Apri i messaggi" }),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: unknown; skipped?: string };
  // "skipped" (freno antiraffica di /api/email) = email NON inviata: non va registrata come riuscita, altrimenti il dedupe di 30 minuti zittirebbe i messaggi successivi.
  const sent = !!(r.ok && j?.ok && !j.skipped);
  await logInvio(admin, tenantId, { job: "ota_msg", ref: o.ref, channel: "email", ok: sent, detail: sent ? `${o.okDetail} → ${to}` : j?.skipped ? `non inviata (${j.skipped})` : `errore ${r.status}: ${typeof j?.error === "string" ? j.error : JSON.stringify(j?.error ?? "")}` });
}

export async function POST(req: Request) {
  try {
    // Fallisce in chiusura: senza segreto configurato (in produzione) o con segreto errato non si elabora nulla, ma si risponde 200 (Channex ritenta all'infinito).
    // Corpo GREZZO: la firma HMAC di Channex si calcola sui byte esatti, prima del JSON.parse.
    const rawBody = await req.text().catch(() => "");
    const verdict = decideHook(req.headers, rawBody, verifyMessageHook(req.headers.get(HOOK_SECRET_HEADER)));
    if (!verdict.accept) {
      console.log("[channex webhook-messages] chiamata rifiutata:", verdict.reason);
      return NextResponse.json({ received: true });
    }
    let body: unknown = {};
    try { body = JSON.parse(rawBody || "{}"); } catch { body = {}; }
    const msg = parseChannexMessage(body);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !service) return NextResponse.json({ received: true });
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    if (!msg) {
      // Messaggio dell'ospite SENZA prenotazione (richiesta di informazioni Airbnb…): niente chat, ma il titolare ne viene avvisato con l'id della conversazione.
      const inq = parseChannexInquiry(body);
      if (inq) {
        try {
          const { data: m } = await admin.from("channex_map").select("tenant_id, org_id").eq("channex_property_id", inq.propertyId).limit(10);
          const st = pickMessageStore(m as { tenant_id?: string | null; org_id?: string | null }[] | null);
          if (st) {
            const preview = inq.text.length > 280 ? inq.text.slice(0, 280) + "…" : inq.text;
            await notifyOwner(admin, st.tenantId, req.url, { ref: `thread:${inq.threadId || inq.id}`, subject: `Nuova richiesta di informazioni su ${inq.channel}`, text: inquiryEmailText(inq.channel, preview, inq.threadId), okDetail: `richiesta senza prenotazione (${inq.channel})`, channelLabel: inq.channel });
            return NextResponse.json({ received: true });
          }
        } catch { /* l'avviso non deve mai far fallire il webhook */ }
      }
      // Evento arrivato ma non trasformabile in messaggio (formato diverso, senza testo, mittente sconosciuto): si conserva la traccia per capirlo.
      try {
        const b = (body ?? {}) as { event?: string; property_id?: string; payload?: Record<string, unknown> };
        const pid = String(b.payload?.property_id ?? b.property_id ?? "");
        if (pid) {
          const { data: m } = await admin.from("channex_map").select("tenant_id").eq("channex_property_id", pid).limit(1);
          const tenant = (m?.[0] as { tenant_id?: string } | undefined)?.tenant_id;
          if (tenant) await logInvio(admin, tenant, { job: "ota_msg_skip", ref: String(b.payload?.booking_id ?? ""), channel: "channex", ok: false, detail: JSON.stringify(body).slice(0, 1500) });
        }
      } catch { /* la traccia non deve mai far fallire il webhook */ }
      return NextResponse.json({ received: true });
    }

    const { data: maps } = await admin.from("channex_map").select("tenant_id, org_id").eq("channex_property_id", msg.propertyId).limit(10);
    const store = pickMessageStore(maps as { tenant_id?: string | null; org_id?: string | null }[] | null);
    if (!store) { console.log("[channex webhook-messages] property non collegata", msg.propertyId); return NextResponse.json({ received: true }); }
    const tenantId = store.tenantId;
    // Dati dell'org della property (se condivisa); se la prenotazione non c'è si riprova una volta con tutte le org del tenant.
    let orgDatas: Record<string, unknown>[] = [];
    if (store.orgId) { const d = await loadOrgData(admin, store.orgId); if (d) orgDatas = [d]; }
    let triedAllOrgs = false;

    let added: { guestId: string; bookingId: string; channel: string; details: import("@/lib/channex-messages").BookingMailDetails } | null = null;
    let savedBlob: Record<string, string> = {};
    for (let attempt = 0; attempt < 3 && !added; attempt++) {
      const { data: row } = await admin.from("app_state").select("data, rev").eq("user_id", tenantId).maybeSingle();
      const blob = ((row?.data ?? {}) as Record<string, string>) || {};
      const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;
      const res = appendOtaMessage(blob, msg, Date.now(), orgDatas);
      if (res.status === "duplicate") return NextResponse.json({ received: true });
      if (res.status === "no_booking" && !triedAllOrgs) { triedAllOrgs = true; orgDatas = await loadOrgDatas(admin, tenantId); attempt--; continue; }
      if (res.status === "no_booking") {
        console.log("[channex webhook-messages] prenotazione non trovata", msg.bookingId);
        // Un messaggio dell'ospite per una prenotazione non (ancora) in Xenora non si perde: avviso al titolare.
        if (msg.sender === "guest") {
          const preview = msg.text.length > 280 ? msg.text.slice(0, 280) + "…" : msg.text;
          await notifyOwner(admin, tenantId, req.url, { ref: msg.bookingId, subject: "Nuovo messaggio da un ospite (prenotazione non trovata)", text: inquiryEmailText("Booking.com / Airbnb / Expedia", preview, "", msg.bookingId), okDetail: "messaggio senza prenotazione in Xenora" }).catch(() => {});
        }
        return NextResponse.json({ received: true });
      }
      let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", tenantId);
      if (rev !== null) write = write.eq("rev", rev);
      const { data: updated } = await write.select("rev");
      if (updated && updated.length > 0) { added = { guestId: res.guestId, bookingId: res.bookingId, channel: res.channel, details: res.details }; savedBlob = blob; }
    }
    if (!added) { console.log("[channex webhook-messages] conflitto di rev, messaggio non salvato", msg.id); return NextResponse.json({ received: true }); }

    // Messaggio scritto dalla struttura fuori da Xenora: solo thread, niente email al proprietario né risposta automatica.
    if (msg.sender === "property") return NextResponse.json({ received: true });

    const done = added;
    after(() => tryOtaAutoReply(admin, tenantId, msg, { blob: savedBlob, guestId: done.guestId, bookingId: done.bookingId }));

    // Email al proprietario, senza martellarlo: una per prenotazione ogni 30 minuti.
    const since = new Date(Date.now() - NOTIFY_EVERY_MS).toISOString();
    // Conta solo gli avvisi andati a buon fine (ok=true): un invio fallito non deve zittire i messaggi dei 30 minuti successivi.
    const { data: recent } = await admin.from("invii_log").select("id").eq("tenant_id", tenantId).eq("job", "ota_msg").eq("ref", msg.bookingId).eq("ok", true).gt("at", since).limit(1);
    if (!recent?.length) {
      const { data: u } = await admin.auth.admin.getUserById(tenantId);
      const to = u?.user?.email;
      if (to) {
        const origin = process.env.NEXT_PUBLIC_APP_URL || "https://xenora.it";
        const preview = msg.text.length > 280 ? msg.text.slice(0, 280) + "…" : msg.text;
        const r = await internalFetch(`${siteOrigin(req)}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "notify", to, event: "message", channelLabel: added.channel, ...notifyBrand(added.details),
            subject: `Nuovo messaggio su ${added.channel}${added.details.guestName ? ` · ${added.details.guestName}` : ""}`, text: otaMessageEmailText(added.channel, preview, added.details, `${origin}/messaggi`),
            ctaUrl: `${origin}/messaggi`, ctaLabel: "Rispondi da Xenora",
          }),
        });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: unknown; skipped?: string };
        const sent = !!(r.ok && j?.ok && !j.skipped); // "skipped" (freno antiraffica) = non inviata: niente ok=true nel registro, altrimenti il dedupe di 30 minuti perde i messaggi successivi
        await logInvio(admin, tenantId, { job: "ota_msg", ref: msg.bookingId, channel: "email", ok: sent, detail: sent ? `${added.channel} → ${to}` : j?.skipped ? `non inviata (${j.skipped})` : `errore ${r.status}: ${typeof j?.error === "string" ? j.error : JSON.stringify(j?.error ?? "")}` });
      }
    }
  } catch (e) { console.log("[channex webhook-messages] errore", (e as Error)?.message); }
  return NextResponse.json({ received: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "channex-webhook-messages", ready: true });
}
