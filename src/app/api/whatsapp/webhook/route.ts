import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseNotifPrefs } from "@/lib/notifPrefs";
import { AI_CONCIERGE_KEY, parseAiConciergePrefs } from "@/lib/aiConcierge";
import { getConciergeReply } from "@/lib/ai/guest-concierge";
import { sendWhatsapp } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Webhook WhatsApp Cloud API (Meta) — riceve i messaggi IN ARRIVO dagli ospiti.
// Un solo endpoint condiviso per tutti i tenant (si registra UNA VOLTA nell'app Meta di Xenora):
// Meta manda il phone_number_id del numero che ha ricevuto il messaggio, da cui risaliamo al
// tenant proprietario (provider_credentials, provider="whatsapp", config.phone_id — salvato in
// chiaro da saveWhatsappCfg, solo il token è cifrato). Il messaggio viene appeso allo stesso
// "spigolestay:threads:v1" che la pagina Messaggi legge già (stessa chiave, sync generico per
// prefisso in authsync.tsx): nessuna modifica lato client necessaria.
//
// Setup richiesto UNA VOLTA su developers.facebook.com (app Meta di Xenora) → WhatsApp →
// Configuration → Webhook: Callback URL = https://xenora.it/api/whatsapp/webhook,
// Verify token = lo stesso valore di WHATSAPP_WEBHOOK_VERIFY_TOKEN su Vercel; poi sottoscrivi
// il campo "messages".

const DATA_KEY = "spigolestay:data:v1";
const THREADS_KEY = "spigolestay:threads:v1";
type MsgSt = "sent" | "delivered" | "read" | "failed";
type Msg = { id: string; dir: "in" | "out"; text: string; ts: number; via?: string; wid?: string; st?: MsgSt };
interface WaStatus { id?: string; status?: string }
const ST_RANK: Record<string, number> = { sent: 1, failed: 1.5, delivered: 2, read: 3 };

// Handshake di verifica richiesto da Meta alla configurazione del webhook.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (expected && mode === "subscribe" && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

interface WaMessage {
  id?: string;
  from?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyIncoming(admin: SupabaseClient<any>, tenantId: string, fromDigits: string, text: string, msgId: string) {
  // Stesso pattern rev-lock + retry singolo già usato in public-review/public-booking.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: row } = await admin.from("app_state").select("data, rev").eq("user_id", tenantId).maybeSingle();
    const blob = ((row?.data ?? {}) as Record<string, string>) || {};
    const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;

    let data: Record<string, unknown> = {};
    try { data = JSON.parse(blob[DATA_KEY] || "{}"); } catch { data = {}; }
    let threads: Record<string, Msg[]> = {};
    try { threads = JSON.parse(blob[THREADS_KEY] || "{}"); } catch { threads = {}; }

    const guests = (Array.isArray(data.guests) ? data.guests : []) as { id: string; fullName?: string; phone?: string; language?: string }[];
    // Confronto sulle ultime 9 cifre: i numeri salvati a mano spesso hanno/non hanno prefisso internazionale.
    const guest = guests.find((g) => { const d = (g.phone || "").replace(/\D/g, ""); return d.length >= 6 && d.slice(-9) === fromDigits.slice(-9); });
    const key = guest?.id || `wa:${fromDigits}`;
    const list = threads[key] ?? [];
    if (list.some((m) => m.id === msgId)) return { ok: true, guestName: guest?.fullName }; // già ricevuto (retry di Meta), idempotente
    threads[key] = [...list, { id: msgId, dir: "in", text, ts: Date.now() }];
    blob[THREADS_KEY] = JSON.stringify(threads);

    let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", tenantId);
    if (rev !== null) write = write.eq("rev", rev);
    const { data: updated } = await write.select("rev");
    if (updated && updated.length > 0) {
      return {
        ok: true,
        guestName: guest?.fullName,
        notifPrefsRaw: blob["spigolestay:notifs"],
        aiConciergeRaw: blob[AI_CONCIERGE_KEY],
        conciergeFaqRaw: Object.fromEntries(Object.keys(blob).filter((k) => k.startsWith("spigolestay:concierge")).map((k) => [k, blob[k]])) as Record<string, string>,
        structures: data.structures,
        bookings: data.bookings,
        units: data.units,
        roomTypes: data.roomTypes,
        guest,
        threadKey: key,
        priorMessages: list,
      };
    }
    // Conflitto di rev: un altro processo ha scritto nel mentre, riprova una volta.
  }
  return { ok: false };
}

// Spunte di consegna: Meta manda gli aggiornamenti di stato (sent/delivered/read/failed) dei messaggi
// inviati da noi, con lo stesso id (wamid) restituito all'invio. Lo salviamo sul messaggio nel thread;
// lo stato non torna mai indietro (letto > consegnato > inviato). Stesso rev-lock + retry di applyIncoming.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyStatuses(admin: SupabaseClient<any>, tenantId: string, statuses: WaStatus[]) {
  const wanted = new Map<string, MsgSt>();
  for (const s of statuses) if (s.id && s.status && ST_RANK[s.status] !== undefined) wanted.set(s.id, s.status as MsgSt);
  if (!wanted.size) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row } = await admin.from("app_state").select("data, rev").eq("user_id", tenantId).maybeSingle();
    const blob = ((row?.data ?? {}) as Record<string, string>) || {};
    const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;
    let threads: Record<string, Msg[]> = {};
    try { threads = JSON.parse(blob[THREADS_KEY] || "{}"); } catch { return; }
    let changed = false, matched = false;
    for (const list of Object.values(threads)) {
      for (const m of list) {
        const next = m.wid ? wanted.get(m.wid) : undefined;
        if (!next) continue;
        matched = true;
        if ((ST_RANK[next] ?? 0) > (ST_RANK[m.st ?? ""] ?? 0)) { m.st = next; changed = true; }
      }
    }
    // Il messaggio può non avere ancora l'id WhatsApp sul server (il browser lo sincronizza entro ~4s):
    // se non lo troviamo, aspettiamo un attimo e riproviamo invece di perdere lo stato.
    if (!matched) { if (attempt < 2) { await new Promise((r) => setTimeout(r, 3500)); continue; } return; }
    if (!changed) return;
    blob[THREADS_KEY] = JSON.stringify(threads);
    let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", tenantId);
    if (rev !== null) write = write.eq("rev", rev);
    const { data: updated } = await write.select("rev");
    if (updated && updated.length > 0) return;
  }
}

interface StLite { id: string; name?: string; address?: string; checkInFrom?: string; checkInTo?: string; checkOutBy?: string; accessInfo?: string; services?: string[] }
interface UnitLite { id: string; structureId: string; roomTypeId: string; accessInfo?: string }
interface RoomTypeLite { id: string; amenities?: string[] }
interface BookingLite { id: string; structureId: string; unitId: string | null; roomTypeId: string; guestId: string; checkIn: string; checkOut: string; status?: string; channel?: string }

// Concierge AI — risposta AUTOMATICA via WhatsApp a domande di routine semplicissime (orario
// check-in/check-out, wifi, parcheggio, indicazioni stradali), SOLO se l'host ha attivato il
// toggle "Concierge AI" in Impostazioni (src/lib/aiConcierge.ts, default SPENTO) e l'AI è sicura
// della risposta (src/lib/ai/guest-concierge.ts). Fire-and-forget: non deve MAI ritardare né far
// fallire il salvataggio del messaggio dell'ospite in applyIncoming(), che è già completato quando
// questa funzione viene chiamata. Chiamata solo per messaggi NUOVI (vedi guardia su notifPrefsRaw
// nel POST qui sotto), quindi un retry di Meta sullo stesso messaggio non genera una doppia risposta.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryAutoReply(admin: SupabaseClient<any>, tenantId: string, info: {
  aiConciergeRaw?: string;
  conciergeFaqRaw?: Record<string, string>;
  fromDigits: string;
  text: string;
  guestName?: string;
  guest?: { id: string; fullName?: string; language?: string };
  structures?: unknown;
  bookings?: unknown;
  units?: unknown;
  roomTypes?: unknown;
  threadKey: string;
  priorMessages: Msg[];
}) {
  try {
    const prefs = parseAiConciergePrefs(info.aiConciergeRaw);
    if (!prefs.enabled) return; // interruttore spento (default): nessuna risposta automatica

    const structures = (Array.isArray(info.structures) ? info.structures : []) as StLite[];
    const bookingsArr = (Array.isArray(info.bookings) ? info.bookings : []) as BookingLite[];
    const units = (Array.isArray(info.units) ? info.units : []) as UnitLite[];
    const roomTypes = (Array.isArray(info.roomTypes) ? info.roomTypes : []) as RoomTypeLite[];

    // Risale alla struttura: prenotazione più recente dell'ospite (se esiste), altrimenti — solo
    // se il gestore ha UNA sola struttura — quella, per non rischiare di citare dati sbagliati.
    let st: StLite | undefined;
    let unit: UnitLite | undefined;
    let roomType: RoomTypeLite | undefined;
    if (info.guest?.id) {
      const myBookings = bookingsArr.filter((b) => b.guestId === info.guest!.id && b.status !== "cancelled").sort((a, b) => (a.checkIn < b.checkIn ? 1 : -1));
      const b = myBookings[0];
      if (b) {
        st = structures.find((s) => s.id === b.structureId);
        unit = units.find((u) => u.id === b.unitId) || undefined;
        roomType = roomTypes.find((r) => r.id === b.roomTypeId) || undefined;
      }
    }
    if (!st && structures.length === 1) st = structures[0];
    if (!st && prefs.defaultStructureId) st = structures.find((s) => s.id === prefs.defaultStructureId);
    if (!st) return; // nessun contesto struttura affidabile → nessuna risposta automatica

    const accessInfo = [unit?.accessInfo, st.accessInfo].filter(Boolean).join(" · ") || undefined;
    const hasParking = (st.services ?? []).some((s) => /parcheggi/i.test(s)) || (roomType?.amenities ?? []).some((a) => /parcheggi/i.test(a)) || undefined;
    const transcript = (info.priorMessages || []).slice(-8).filter((m) => m.text?.trim())
      .map((m) => `${m.dir === "out" ? "Struttura" : "Ospite"}: ${m.text.replace(/\s+/g, " ").trim()}`).join("\n") || undefined;

    // Risposte scritte dal gestore (Messaggi → Concierge), per struttura; si ignorano i segnaposto
    // "chiedi al gestore" dei testi di partenza, che non sono informazioni vere.
    let faq: { topic: string; answer: string }[] = [];
    try {
      const raw = info.conciergeFaqRaw?.["spigolestay:concierge:" + st.id] ?? info.conciergeFaqRaw?.["spigolestay:concierge"];
      const list = raw ? (JSON.parse(raw) as { topic?: string; answer?: string }[]) : [];
      faq = list
        .filter((f) => f?.topic && f?.answer && !/chiedi (pure )?al gestore|da concordare con il gestore|modificabile qui|giro la tua domanda/i.test(f.answer))
        .map((f) => ({ topic: String(f.topic).slice(0, 80), answer: String(f.answer).slice(0, 600) }))
        .slice(0, 40);
    } catch { faq = []; }

    const outcome = await getConciergeReply({
      faq,
      guestName: info.guestName,
      lang: info.guest?.language,
      structureName: st.name,
      address: st.address,
      checkInFrom: st.checkInFrom,
      checkInTo: st.checkInTo,
      checkOutBy: st.checkOutBy,
      accessInfo,
      hasParking,
      transcript,
      lastGuestMessage: info.text,
    });
    if (!outcome.ok || !outcome.result.canAnswer || !outcome.result.reply) return;

    const sent = await sendWhatsapp(admin, tenantId, { to: info.fromDigits, text: outcome.result.reply });
    if (!sent.ok) return;

    // Stesso pattern rev-lock + retry di applyIncoming, per appendere la risposta AI al thread.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data: row } = await admin.from("app_state").select("data, rev").eq("user_id", tenantId).maybeSingle();
      const blob = ((row?.data ?? {}) as Record<string, string>) || {};
      const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;
      let threads: Record<string, Msg[]> = {};
      try { threads = JSON.parse(blob[THREADS_KEY] || "{}"); } catch { threads = {}; }
      const list = threads[info.threadKey] ?? [];
      threads[info.threadKey] = [...list, { id: randomUUID(), dir: "out", text: outcome.result.reply, ts: Date.now(), via: "🤖 Concierge AI", ...(sent.id ? { wid: sent.id, st: "sent" as const } : {}) }];
      blob[THREADS_KEY] = JSON.stringify(threads);

      let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", tenantId);
      if (rev !== null) write = write.eq("rev", rev);
      const { data: updated } = await write.select("rev");
      if (updated && updated.length > 0) return;
      // Conflitto di rev: un altro processo (es. l'host che risponde nel mentre) ha scritto, riprova una volta.
    }
  } catch (e) { console.error("[whatsapp webhook concierge]", e); }
}

export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Risponde sempre 200 anche se non configurato: un errore qui farebbe ritentare Meta all'infinito.
  if (!sbUrl || !service) return NextResponse.json({ ok: true });
  const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const body = await req.json().catch(() => null) as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; messages?: WaMessage[]; statuses?: WaStatus[] } }[] }[] } | null;

  try {
    for (const entry of body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        const messages = value?.messages ?? [];
        const statuses = value?.statuses ?? [];
        if (!phoneNumberId || (!messages.length && !statuses.length)) continue;

        const { data: creds } = await admin.from("provider_credentials").select("tenant_id, config").eq("provider", "whatsapp");
        const match = (creds ?? []).find((c) => (c.config as Record<string, unknown> | null)?.phone_id === phoneNumberId);
        if (!match) continue; // numero non collegato a nessun tenant Xenora
        const tenantId = match.tenant_id as string;

        if (statuses.length) await applyStatuses(admin, tenantId, statuses); // spunte di consegna/lettura

        for (const m of messages) {
          const fromDigits = (m.from || "").replace(/\D/g, "");
          const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "";
          if (!fromDigits || !text || !m.id) continue;
          const res = await applyIncoming(admin, tenantId, fromDigits, text, m.id);

          // Notifica email al gestore (interruttore "Messaggi degli ospiti") — fire-and-forget.
          if (res.ok && res.notifPrefsRaw !== undefined) {
            try {
              const notifs = parseNotifPrefs(res.notifPrefsRaw as string | undefined);
              if (notifs.message) {
                const structures = (Array.isArray(res.structures) ? res.structures : []) as { email?: string; photoColor?: string }[];
                const st = structures.find((s) => s.email) ?? structures[0];
                if (st?.email) {
                  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://xenora.it";
                  fetch(`${origin}/api/email`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ kind: "notify", to: st.email, accent: st.photoColor, subject: `Nuovo messaggio WhatsApp${res.guestName ? ` · ${res.guestName}` : ""}`, text }),
                  }).catch(() => {});
                }
              }
            } catch {}

            // Concierge AI — SOLO per messaggi davvero nuovi (notifPrefsRaw è assente sui retry di
            // Meta/duplicati, vedi applyIncoming). Fire-and-forget: non blocca la risposta 200 al webhook.
            tryAutoReply(admin, tenantId, {
              aiConciergeRaw: res.aiConciergeRaw as string | undefined,
              conciergeFaqRaw: res.conciergeFaqRaw as Record<string, string> | undefined,
              fromDigits,
              text,
              guestName: res.guestName,
              guest: res.guest as { id: string; fullName?: string; language?: string } | undefined,
              structures: res.structures,
              bookings: res.bookings,
              units: res.units,
              roomTypes: res.roomTypes,
              threadKey: res.threadKey as string,
              priorMessages: (res.priorMessages as Msg[]) || [],
            }).catch(() => {});
          }
        }
      }
    }
  } catch (e) { console.error("[whatsapp webhook]", e); }

  return NextResponse.json({ ok: true });
}
