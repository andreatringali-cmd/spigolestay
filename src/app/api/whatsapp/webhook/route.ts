import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseNotifPrefs } from "@/lib/notifPrefs";

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
type Msg = { id: string; dir: "in" | "out"; text: string; ts: number; via?: string };

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

    const guests = (Array.isArray(data.guests) ? data.guests : []) as { id: string; fullName?: string; phone?: string }[];
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
    if (updated && updated.length > 0) return { ok: true, guestName: guest?.fullName, notifPrefsRaw: blob["spigolestay:notifs"], structures: data.structures };
    // Conflitto di rev: un altro processo ha scritto nel mentre, riprova una volta.
  }
  return { ok: false };
}

export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Risponde sempre 200 anche se non configurato: un errore qui farebbe ritentare Meta all'infinito.
  if (!sbUrl || !service) return NextResponse.json({ ok: true });
  const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const body = await req.json().catch(() => null) as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; messages?: WaMessage[] } }[] }[] } | null;
  console.log("[whatsapp webhook] payload", JSON.stringify(body)); // DEBUG temporaneo, da rimuovere

  try {
    for (const entry of body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        const messages = value?.messages ?? [];
        if (!phoneNumberId || !messages.length) continue;

        const { data: creds } = await admin.from("provider_credentials").select("tenant_id, config").eq("provider", "whatsapp");
        const match = (creds ?? []).find((c) => (c.config as Record<string, unknown> | null)?.phone_id === phoneNumberId);
        if (!match) continue; // numero non collegato a nessun tenant Xenora
        const tenantId = match.tenant_id as string;

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
          }
        }
      }
    }
  } catch (e) { console.error("[whatsapp webhook]", e); }

  return NextResponse.json({ ok: true });
}
