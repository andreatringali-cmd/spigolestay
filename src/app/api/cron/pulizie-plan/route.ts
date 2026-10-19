import { NextResponse } from "next/server";
import { siteOrigin } from "@/lib/server-auth";
import { createClient } from "@supabase/supabase-js";
import { deliverPuliziePlan, romeNowSlot } from "@/lib/pulizie-send";
import { loadOrgDatas, mergeOrgData } from "@/lib/concierge-orgdata";
import type { Booking, Unit, RoomType, Structure, Guest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// CRON: invio automatico giornaliero del Planning pulizie (email/WhatsApp), a un
// orario scelto dall'utente in Pulizie → Condividi → "Invio automatico".
//
// Una configurazione per struttura (destinatari/orario propri, es. persone diverse che puliscono
// strutture diverse): chiave `spigolestay:pulizie:autoshare:{structureId}`, sincronizzata come le
// altre chiavi "piatte" dentro app_state/org_state (vedi authsync.tsx). Per non rileggere ogni 10 minuti i dati pesanti
// degli utenti, ogni salvataggio scrive anche una riga nella tabella piccola `pulizie_schedule` (tenant, struttura, orario, email): il cron legge
// SOLO quella e carica i dati completi soltanto di chi ha un invio in scadenza e non ancora fatto oggi. Gira ogni 10 minuti (vercel.json): l'invio parte
// al primo giro dopo l'orario scelto (entro 10 minuti). Anti-duplicati: tabella `pulizie_share_log` (unico per tenant+struttura+
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

interface AutoShareCfg { enabled: boolean; time: string; email: boolean; emailTo: string; whatsapp: boolean; whatsappTo: string; intro?: string; outro?: string; subject?: string }

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

  // Indirizzo FISSO del sito: l'origine della richiesta del cron è quella del deployment (…vercel.app), protetta da autenticazione → "Protected deployment 401".
  const origin = siteOrigin(req);
  const { ymd: todayRome, hm: nowSlot } = romeNowSlot();

  let configured = 0, matched = 0, sent = 0, waSent = 0;
  const errors: string[] = [];

  const processRow = async (tenantId: string, blob: Record<string, string>, allowed: Set<string>) => {
    let data: Json = {};
    try { data = JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { return; }
    try { data = mergeOrgData(data, await loadOrgDatas(admin, tenantId)); } catch { /* restano i dati personali */ } // le strutture in società vivono solo nell'org
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
      if (!structureId || !allowed.has(`${tenantId}|${structureId}`)) continue; // solo gli invii in scadenza (e non doppioni)
      let cfg: AutoShareCfg;
      try { cfg = { enabled: false, time: "08:00", email: false, emailTo: "", whatsapp: false, whatsappTo: "", ...(JSON.parse(blob[CFG_PREFIX + structureId] || "{}") as Partial<AutoShareCfg>) }; } catch { continue; }
      cfg.whatsapp = false; // il planning parte solo per email
      if (!cfg.enabled || !cfg.email) continue;
      configured++;
      const toMin = (hm: string) => { const [h, m] = hm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
      if (toMin(nowSlot) < toMin(cfg.time || "08:00")) continue; // non prima dell'orario scelto
      matched++;

      // Claim anti-duplicato: una sola riga per tenant+struttura+giorno; se già presente, salta.
      const claim = await admin.from("pulizie_share_log").upsert({ tenant_id: tenantId, structure_id: structureId, slot_date: todayRome }, { onConflict: "tenant_id,structure_id,slot_date", ignoreDuplicates: true }).select("id");
      if (claim.error) { errors.push(`claim ${tenantId.slice(0, 8)}/${structureId.slice(0, 8)}: ${claim.error.message}`); continue; }
      if (!claim.data || claim.data.length === 0) continue; // già inviato oggi per questa struttura

      const claimId = s(claim.data[0]?.id);
      const results = await deliverPuliziePlan({ admin, tenantId, origin, structure: st, cfg, date: todayRome, units, roomTypes, bookings, guests, notes });
      let okNow = 0;
      for (const r of results) {
        if (r.ok) { okNow++; if (r.channel === "email") sent++; else waSent++; }
        else errors.push(`${r.channel === "email" ? "mail" : "wa"} ${tenantId.slice(0, 8)}/${structureId.slice(0, 8)}: ${r.detail}`);
      }
      // Se NESSUN canale ha inviato (es. errore di Meta o dell'email) si libera il segno "già inviato oggi": alla prossima esecuzione si riprova, invece di saltare la giornata.
      if (okNow === 0 && claimId) { try { await admin.from("pulizie_share_log").delete().eq("id", claimId); } catch { /* il prossimo giro lo ritenterà comunque domani */ } }
    }
  };

  try {
    // 1) Righe in scadenza: invio attivo con email, orario già passato, non ancora inviato oggi (tabella piccola, nessun dato pesante).
    const { data: sched, error: schedErr } = await admin.from("pulizie_schedule").select("tenant_id, structure_id, send_time, email_to").eq("enabled", true).eq("email", true);
    if (schedErr) throw new Error(`pulizie_schedule: ${schedErr.message}`);
    type Sch = { tenant_id: string; structure_id: string; send_time: string; email_to: string };
    const minOf = (hm: string) => { const [h, m] = (hm || "08:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
    const nowMin = minOf(nowSlot);
    const all = (sched ?? []) as Sch[];
    // Più utenti possono avere lo stesso invio (stessa struttura, stessa email): parte una volta sola al giorno.
    const dest = (r: Sch) => `${r.structure_id}|${(r.email_to || "").trim().toLowerCase()}`;
    const { data: done } = await admin.from("pulizie_share_log").select("tenant_id, structure_id").eq("slot_date", todayRome);
    const doneSet = new Set(((done ?? []) as { tenant_id: string; structure_id: string }[]).map((r) => `${r.tenant_id}|${r.structure_id}`));
    const sentDest = new Set(all.filter((r) => doneSet.has(`${r.tenant_id}|${r.structure_id}`)).map(dest)); // destinazioni già servite oggi (da chiunque)
    const takenDest = new Set<string>();
    const duePre = all.filter((r) => {
      if (minOf(r.send_time) > nowMin || doneSet.has(`${r.tenant_id}|${r.structure_id}`) || sentDest.has(dest(r)) || takenDest.has(dest(r))) return false;
      takenDest.add(dest(r));
      return true;
    });
    const dueTenants = Array.from(new Set(duePre.map((r) => r.tenant_id)));
    // 2) Solo per chi ha qualcosa da inviare si leggono i dati completi.
    for (const tenantId of dueTenants) {
      const { data: row } = await admin.from("app_state").select("data").eq("user_id", tenantId).maybeSingle();
      const blob = ((row?.data ?? {}) as Record<string, string>) || {};
      try { await processRow(tenantId, blob, new Set(duePre.map((r) => `${r.tenant_id}|${r.structure_id}`))); } catch (e) { errors.push(`row ${tenantId.slice(0, 8)}: ${e instanceof Error ? e.message : "err"}`); }
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "scan_failed", configured, matched, sent }, { status: 500 });
  }

  return NextResponse.json({ ok: true, now: `${todayRome} ${nowSlot}`, configured, matched, sent, waSent, ...(errors.length ? { errors: errors.slice(0, 50) } : {}) });
}
