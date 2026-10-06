import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/server-auth";
import { createClient } from "@supabase/supabase-js";
import { sendWhatsapp } from "@/lib/whatsapp";
import { logInvio } from "@/lib/invii-log";
import { computePuliziePlan, buildPuliziePlanText } from "@/lib/puliziePlan";
import type { Booking, Unit, RoomType, Structure, Guest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// CRON: invio automatico giornaliero del Planning pulizie (email/WhatsApp), a un
// orario scelto dall'utente in Pulizie → Condividi → "Invio automatico".
//
// Una configurazione per struttura (destinatari/orario propri, es. persone diverse che puliscono
// strutture diverse): chiave `spigolestay:pulizie:autoshare:{structureId}`, sincronizzata come le
// altre chiavi "piatte" dentro app_state/org_state (vedi authsync.tsx). Su piano Vercel Hobby i
// cron possono girare al massimo una volta al giorno (vedi stesso limite in auto-messages):
// questo cron ha UN solo orario fisso (vercel.json) e invia se quell'orario è >= all'orario
// scelto dall'utente — l'orario configurato è quindi una soglia minima ("non prima di ___"), non
// un istante esatto. Anti-duplicati: tabella `pulizie_share_log` (unico per tenant+struttura+
// giorno), così ogni struttura riceve al massimo un invio al giorno.
//
// Auth: Bearer <CRON_SECRET> (Vercel Cron) oppure ?secret= per test manuale.
// ─────────────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const DATA_KEY = "spigolestay:data:v1";
const NOTES_KEY = "spigolestay:pulizie:notes";
const CFG_PREFIX = "spigolestay:pulizie:autoshare:";
const s = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);

interface AutoShareCfg { enabled: boolean; time: string; email: boolean; emailTo: string; whatsapp: boolean; whatsappTo: string }

// Data (Y-M-D) e "HH:MM" adesso nel fuso Europe/Rome.
function romeNowSlot(): { ymd: string; hm: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const ymd = `${g("year")}-${g("month")}-${g("day")}`;
  const hm = `${g("hour")}:${g("minute")}`;
  return { ymd, hm };
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, skipped: "no_secret" });
  const url = new URL(req.url);
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (bearer !== secret && (url.searchParams.get("secret") || "") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !service) return NextResponse.json({ ok: false, skipped: "supabase_not_configured" });
  const admin = createClient(supaUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const origin = url.origin;
  const { ymd: todayRome, hm: nowSlot } = romeNowSlot();

  let configured = 0, matched = 0, sent = 0, waSent = 0;
  const errors: string[] = [];

  const processRow = async (tenantId: string, blob: Record<string, string>) => {
    let data: Json = {};
    try { data = JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { return; }
    const structures = arr(data.structures) as unknown as Structure[];
    if (!structures.length) return;
    let notes: Record<string, string> = {};
    try { notes = JSON.parse(blob[NOTES_KEY] || "{}") as Record<string, string>; } catch { notes = {}; }
    const units = arr(data.units) as unknown as Unit[];
    const roomTypes = arr(data.roomTypes) as unknown as RoomType[];
    const bookings = arr(data.bookings) as unknown as Booking[];
    const guests = arr(data.guests) as unknown as Guest[];

    for (const st of structures) {
      const structureId = s((st as unknown as Json).id);
      if (!structureId) continue;
      let cfg: AutoShareCfg;
      try { cfg = { enabled: false, time: "08:00", email: false, emailTo: "", whatsapp: false, whatsappTo: "", ...(JSON.parse(blob[CFG_PREFIX + structureId] || "{}") as Partial<AutoShareCfg>) }; } catch { continue; }
      if (!cfg.enabled || (!cfg.email && !cfg.whatsapp)) continue;
      configured++;
      // Il cron gira UNA volta al giorno (piano Hobby, precisione oraria): tolleranza di 60 minuti, così
      // un orario scelto alle 08:00 parte anche se Vercel lo esegue alle 07:xx (ora solare) e non salta mai la giornata.
      const toMin = (hm: string) => { const [h, m] = hm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
      if (toMin(nowSlot) < toMin(cfg.time || "08:00") - 60) continue; // troppo presto rispetto all'orario scelto
      matched++;

      // Claim anti-duplicato: una sola riga per tenant+struttura+giorno; se già presente, salta.
      const claim = await admin.from("pulizie_share_log").upsert({ tenant_id: tenantId, structure_id: structureId, slot_date: todayRome }, { onConflict: "tenant_id,structure_id,slot_date", ignoreDuplicates: true }).select("id");
      if (claim.error) { errors.push(`claim ${tenantId.slice(0, 8)}/${structureId.slice(0, 8)}: ${claim.error.message}`); continue; }
      if (!claim.data || claim.data.length === 0) continue; // già inviato oggi per questa struttura

      const { rooms } = computePuliziePlan({ date: todayRome, structures: [st], units, roomTypes, bookings });
      const text = buildPuliziePlanText({ date: todayRome, scopedStructures: [st], rooms, guests, notes });
      const subject = `Planning pulizie · ${s((st as unknown as Json).name)} · ${todayRome}`;

      if (cfg.email && cfg.emailTo) {
        try {
          const r = await internalFetch(`${origin}/api/email`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind: "guest_message", to: cfg.emailTo, subject, text, booking: { structureName: s((st as unknown as Json)?.name), color: s((st as unknown as Json)?.photoColor), logo: s((st as unknown as Json)?.logo) } }),
          });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j?.ok) { sent++; await logInvio(admin, tenantId, { job: "pulizie", ref: structureId, channel: "email", ok: true, detail: cfg.emailTo }); }
          else { errors.push(`mail ${tenantId.slice(0, 8)}/${structureId.slice(0, 8)}: ${j?.error || r.status}`); await logInvio(admin, tenantId, { job: "pulizie", ref: structureId, channel: "email", ok: false, detail: String(j?.error || r.status) }); }
        } catch (e) { errors.push(`mail ${tenantId.slice(0, 8)}/${structureId.slice(0, 8)}: ${e instanceof Error ? e.message : "err"}`); await logInvio(admin, tenantId, { job: "pulizie", ref: structureId, channel: "email", ok: false, detail: e instanceof Error ? e.message : "errore" }); }
      }
      if (cfg.whatsapp && cfg.whatsappTo) {
        try {
          let w = await sendWhatsapp(admin, tenantId, { to: cfg.whatsappTo, text });
          const firstErr = w.ok ? "" : w.message;
          // Fuori dalla finestra di 24h il testo libero viene rifiutato da Meta: ripiego sul modello approvato
          // (corpo con 3 variabili: {{1}} struttura, {{2}} data, {{3}} planning in una riga).
          if (!w.ok) w = await sendWhatsapp(admin, tenantId, { to: cfg.whatsappTo, templateName: process.env.WHATSAPP_PULIZIE_TEMPLATE || "planning_pulizie", lang: "it", params: [s((st as unknown as Json).name), todayRome, text] });
          if (w.ok) { waSent++; await logInvio(admin, tenantId, { job: "pulizie", ref: structureId, channel: "whatsapp", ok: true, wamid: w.id, detail: firstErr ? `con il modello (il testo libero era stato rifiutato: ${firstErr})` : cfg.whatsappTo }); }
          else { errors.push(`wa ${tenantId.slice(0, 8)}/${structureId.slice(0, 8)}: ${w.message}`); await logInvio(admin, tenantId, { job: "pulizie", ref: structureId, channel: "whatsapp", ok: false, detail: `testo libero: ${firstErr} · modello: ${w.message}` }); }
        } catch (e) { errors.push(`wa ${tenantId.slice(0, 8)}/${structureId.slice(0, 8)}: ${e instanceof Error ? e.message : "err"}`); await logInvio(admin, tenantId, { job: "pulizie", ref: structureId, channel: "whatsapp", ok: false, detail: e instanceof Error ? e.message : "errore" }); }
      }
    }
  };

  try {
    const scan = async (table: "app_state" | "org_state", keyCol: "user_id" | "org_id") => {
      const { data: rows } = await admin.from(table).select(`${keyCol}, data`).limit(5000);
      for (const row of (rows ?? []) as Json[]) {
        const tenantId = s(row[keyCol]);
        const blob = ((row.data ?? {}) as Record<string, string>) || {};
        if (!tenantId) continue;
        try { await processRow(tenantId, blob); } catch (e) { errors.push(`row ${tenantId.slice(0, 8)}: ${e instanceof Error ? e.message : "err"}`); }
      }
    };
    await scan("app_state", "user_id");
    await scan("org_state", "org_id");
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "scan_failed", configured, matched, sent }, { status: 500 });
  }

  return NextResponse.json({ ok: true, now: `${todayRome} ${nowSlot}`, configured, matched, sent, waSent, ...(errors.length ? { errors: errors.slice(0, 50) } : {}) });
}
