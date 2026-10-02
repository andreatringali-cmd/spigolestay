import { NextResponse, after } from "next/server";
import { fetchWaMedia, transcribeAudio, transcriptionConfigured } from "@/lib/whatsapp-media";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseNotifPrefs } from "@/lib/notifPrefs";
import { AI_CONCIERGE_KEY, parseAiConciergePrefs } from "@/lib/aiConcierge";
import { conciergeAnswer, resolveStructureId, type BookingLite } from "@/lib/concierge-engine";
import { loadOrgDatas, mergeOrgData } from "@/lib/concierge-orgdata";
import { logUnanswered } from "@/lib/concierge-unanswered";
import { sendWhatsapp } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // le risposte AI e i tentativi sugli stati possono richiedere qualche secondo

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
type Msg = { id: string; dir: "in" | "out"; text: string; ts: number; via?: string; wid?: string; st?: MsgSt; media?: { kind: "audio"; id: string; transcribed: boolean } };
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
  type?: string;
  audio?: { id?: string };
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyIncoming(admin: SupabaseClient<any>, tenantId: string, fromDigits: string, text: string, msgId: string, media?: Msg["media"]) {
  // Stesso pattern rev-lock + retry singolo già usato in public-review/public-booking.
  let orgGuestsCache: { id: string; fullName?: string; phone?: string; language?: string }[] | null = null; // letti al massimo una volta
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
    const byPhone = (g: { phone?: string }) => { const d = (g.phone || "").replace(/\D/g, ""); return d.length >= 6 && d.slice(-9) === fromDigits.slice(-9); };
    let guest = guests.find(byPhone);
    if (!guest) {
      // Ospite di una struttura CONDIVISA (es. prenotato dal socio): sta solo in org_state. Sola lettura, mai bloccante.
      if (orgGuestsCache === null) {
        try {
          orgGuestsCache = (await loadOrgDatas(admin, tenantId)).flatMap((od) => (Array.isArray(od.guests) ? od.guests : [])) as { id: string; fullName?: string; phone?: string; language?: string }[];
        } catch { orgGuestsCache = []; }
      }
      guest = orgGuestsCache.find(byPhone);
    }
    const key = guest?.id || `wa:${fromDigits}`;
    const list = threads[key] ?? [];
    if (list.some((m) => m.id === msgId)) return { ok: true, guestName: guest?.fullName }; // già ricevuto (retry di Meta), idempotente
    threads[key] = [...list, { id: msgId, dir: "in", text, ts: Date.now(), ...(media ? { media } : {}) }];
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
        roomAccessRaw: blob["spigolestay:roomaccess"],
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
  roomAccessRaw?: string;
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

    // Il blob personale non contiene le strutture condivise (Structure.orgId, es. Central Perk): sono in org_state.
    // Le leggiamo (sola lettura) e le uniamo ai dati personali come fa il browser con combineData().
    const data = mergeOrgData(
      { structures: info.structures, bookings: info.bookings, units: info.units, roomTypes: info.roomTypes },
      await loadOrgDatas(admin, tenantId),
    );
    const structures = (Array.isArray(data.structures) ? data.structures : []) as { id: string }[];
    const bookingsArr = (Array.isArray(data.bookings) ? data.bookings : []) as BookingLite[];
    // Struttura di riferimento: prenotazione dell'ospite, poi struttura unica, poi quella predefinita in Impostazioni.
    const structureId = resolveStructureId(structures, bookingsArr, info.guest?.id, prefs.defaultStructureId);
    if (!structureId) {
      // Nessun contesto struttura affidabile → nessuna risposta automatica; la domanda va comunque nell'elenco "senza risposta".
      console.log("[concierge]", JSON.stringify({ answered: false, reason: "struttura non determinabile", hasBooking: !!info.guest, q: info.text.slice(0, 60) }));
      await logUnanswered(admin, tenantId, { q: info.text, sid: "", reason: "struttura di riferimento non determinabile", hasBooking: !!info.guest });
      return;
    }

    const transcript = (info.priorMessages || []).slice(-4).filter((m) => m.text?.trim())
      .map((m) => `${m.dir === "out" ? "Struttura" : "Ospite"}: ${m.text.replace(/\s+/g, " ").trim()}`).join("\n") || undefined;

    const result = await conciergeAnswer({
      admin, tenantId,
      data: { structures: data.structures, bookings: data.bookings, units: data.units, roomTypes: data.roomTypes },
      roomAccessRaw: info.roomAccessRaw, conciergeFaqRaw: info.conciergeFaqRaw,
      structureId, guest: info.guest, guestName: info.guestName, message: info.text, transcript, tone: prefs.tone,
    });
    console.log("[concierge]", JSON.stringify({ answered: result.answered, reason: result.reason, topic: result.topic, hasBooking: result.hasBooking, lang: result.lang, tone: prefs.tone, ms: result.ms, q: info.text.slice(0, 60) }));
    if (!result.answered || !result.reply) {
      // Registra la domanda (testo troncato, struttura, motivo, data) per "Domande a cui non ho saputo rispondere".
      await logUnanswered(admin, tenantId, { q: info.text, sid: structureId, reason: result.reason, topic: result.topic, hasBooking: result.hasBooking });
      return;
    }
    const reply = result.reply;

    const sent = await sendWhatsapp(admin, tenantId, { to: info.fromDigits, text: reply });
    if (!sent.ok) return;

    // Stesso pattern rev-lock + retry di applyIncoming, per appendere la risposta AI al thread.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data: row } = await admin.from("app_state").select("data, rev").eq("user_id", tenantId).maybeSingle();
      const blob = ((row?.data ?? {}) as Record<string, string>) || {};
      const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;
      let threads: Record<string, Msg[]> = {};
      try { threads = JSON.parse(blob[THREADS_KEY] || "{}"); } catch { threads = {}; }
      const list = threads[info.threadKey] ?? [];
      threads[info.threadKey] = [...list, { id: randomUUID(), dir: "out", text: reply, ts: Date.now(), via: "🤖 Concierge AI", ...(sent.id ? { wid: sent.id, st: "sent" as const } : {}) }];
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
          let text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "";
          // Vocale: lo trascriviamo (se c'è una chiave) così compare come testo e il Concierge può rispondere.
          let media: Msg["media"] | undefined;
          let voiceNoText = false;
          if (!text && m.type === "audio" && m.audio?.id) {
            let transcribed = false;
            if (transcriptionConfigured()) {
              const file = await fetchWaMedia(admin, tenantId, m.audio.id);
              const tr = file ? await transcribeAudio(file.bytes, file.mime) : null;
              if (tr?.ok && tr.text) { text = tr.text; transcribed = true; }
              else console.log("[whatsapp voice]", JSON.stringify({ file: !!file, error: tr?.error }));
            }
            if (!transcribed) { text = "🎙️ Messaggio vocale (senza trascrizione)"; voiceNoText = true; }
            media = { kind: "audio", id: m.audio.id, transcribed };
          }
          if (!fromDigits || !text || !m.id) continue;
          const res = await applyIncoming(admin, tenantId, fromDigits, text, m.id, media);

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
            if (!voiceNoText) after(() => tryAutoReply(admin, tenantId, {
              aiConciergeRaw: res.aiConciergeRaw as string | undefined,
              conciergeFaqRaw: res.conciergeFaqRaw as Record<string, string> | undefined,
              roomAccessRaw: res.roomAccessRaw as string | undefined,
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
            }).catch((e) => console.error("[whatsapp webhook concierge]", e)));
          }
        }
      }
    }
  } catch (e) { console.error("[whatsapp webhook]", e); }

  return NextResponse.json({ ok: true });
}
