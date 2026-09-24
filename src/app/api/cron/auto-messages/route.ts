import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// CRON: messaggi automatici agli ospiti (Fase 2 — invio dal SERVER, senza click).
//
// Per ogni account (app_state/org_state) legge i "modelli & automazioni"
// (localStorage key `spigolestay:msgtemplates`) e le prenotazioni; per ogni modello
// automatico attivo calcola la data/orario previsti rispetto a check-in/check-out e,
// quando è il momento, invia l'email all'ospite (via /api/email kind guest_message).
// Anti-duplicati: tabella `auto_message_log` (unico per tenant+booking+template+giorno).
//
// SICUREZZA: l'invio REALE avviene solo se AUTO_MESSAGES_LIVE=1 (interruttore lato
// server). Senza, il cron gira in "dry-run": calcola quanti messaggi partirebbero
// ma NON invia nulla. Così niente email agli ospiti finché non lo attivi tu.
//
// Auth: Bearer <CRON_SECRET> (Vercel Cron) oppure ?secret= per test.
// ─────────────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const DATA_KEY = "spigolestay:data:v1";
const TPL_KEY = "spigolestay:msgtemplates";
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);

type Trigger = "manual" | "before_arrival" | "on_arrival" | "after_arrival" | "on_checkout" | "after_checkout";
interface Tpl { id: string; name: string; texts: Record<string, string>; trigger: Trigger; days: number; time: string; active: boolean }

// Data (Y-M-D) e minuti-del-giorno "adesso" nel fuso Europe/Rome.
function romeNow(): { ymd: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const ymd = `${g("year")}-${g("month")}-${g("day")}`;
  const minutes = (parseInt(g("hour"), 10) || 0) * 60 + (parseInt(g("minute"), 10) || 0);
  return { ymd, minutes };
}
const addDaysISO = (iso: string, d: number) => { const dt = new Date(iso + "T00:00:00"); dt.setDate(dt.getDate() + d); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`; };
const nights = (ci?: string, co?: string) => { if (!ci || !co) return 0; return Math.max(0, Math.round((Date.parse(co) - Date.parse(ci)) / 86400000)); };
const fmtIT = (iso?: string) => { try { return new Date(iso + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }); } catch { return iso ?? ""; } };

// Data-slot prevista per un modello rispetto alla prenotazione.
function slotDate(tpl: Tpl, checkIn: string, checkOut: string): string | null {
  switch (tpl.trigger) {
    case "before_arrival": return addDaysISO(checkIn, -Math.abs(tpl.days || 0));
    case "on_arrival": return checkIn;
    case "after_arrival": return addDaysISO(checkIn, Math.abs(tpl.days || 0));
    case "on_checkout": return checkOut;
    case "after_checkout": return addDaysISO(checkOut, Math.abs(tpl.days || 0));
    default: return null; // manual
  }
}
const tplMinutes = (time: string) => { const [h, m] = (time || "10:00").split(":"); return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0); };

// Sostituzione segnaposto {ospite} {struttura} {camera} {checkin} {checkout} {notti} {saldo} {codice_accesso} {link_checkin} {link_guida}.
function fillTokens(text: string, ctx: Record<string, string>): string {
  return text.replace(/\{([a-z_]+)\}/gi, (m, k: string) => (k in ctx ? ctx[k] : m));
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

  const live = process.env.AUTO_MESSAGES_LIVE === "1";
  const origin = url.origin;
  const { ymd: todayRome, minutes: nowMin } = romeNow();

  let accounts = 0, candidates = 0, sent = 0;
  const errors: string[] = [];
  const CAP = 300; // tetto di sicurezza per esecuzione

  const processRow = async (tenantId: string, blob: Record<string, string>) => {
    let data: Json = {}; let tpls: Tpl[] = [];
    try { data = JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { return; }
    try { tpls = (JSON.parse(blob[TPL_KEY] || "[]") as Tpl[]).filter((tp) => tp && tp.trigger !== "manual" && tp.active); } catch { tpls = []; }
    if (!tpls.length) return;
    accounts++;
    const bookings = arr(data.bookings);
    const guests = new Map(arr(data.guests).map((g) => [s((g as Json).id), g as Json]));
    const structures = new Map(arr(data.structures).map((x) => [s((x as Json).id), x as Json]));
    const units = new Map(arr(data.units).map((u) => [s((u as Json).id), u as Json]));
    const roomTypes = new Map(arr(data.roomTypes).map((r) => [s((r as Json).id), r as Json]));

    for (const bk of bookings) {
      const b = bk as Json;
      const status = s(b.status), channel = s(b.channel);
      if (status === "cancelled" || status === "no_show" || channel === "blocked") continue;
      const checkIn = s(b.checkIn), checkOut = s(b.checkOut);
      if (!checkIn || !checkOut) continue;
      const g = guests.get(s(b.guestId)) || (b.primaryGuest as Json) || {};
      const email = s(g.email);
      if (!email) continue;
      const st = structures.get(s(b.structureId)) || {};
      const unit = units.get(s(b.unitId)) || {};
      const rt = roomTypes.get(s(b.roomTypeId)) || {};
      const lang = (s(g.lang) || s(g.language) || "it").slice(0, 2);
      const nn = nights(checkIn, checkOut);
      const balance = Math.max(0, num(b.total) + num(b.cleaningFee) - num(b.paid));
      const ctx: Record<string, string> = {
        ospite: s(g.firstName) || s(g.fullName).split(" ")[0] || "ospite",
        struttura: s(st.name),
        camera: s(unit.name) || s(rt.name),
        checkin: fmtIT(checkIn), checkout: fmtIT(checkOut),
        notti: String(nn),
        codice_accesso: s(unit.accessInfo) || s(st.accessInfo),
        saldo: balance > 0 ? `€ ${balance.toLocaleString("it-IT")}` : "€ 0",
        link_checkin: `${origin}/checkin?b=${s(b.id)}`,
        link_guida: s(st.guideUrl) || s(st.website) || "",
      };

      for (const tp of tpls) {
        const slot = slotDate(tp, checkIn, checkOut);
        if (!slot || slot !== todayRome) continue;
        if (nowMin < tplMinutes(tp.time)) continue; // non ancora l'orario previsto (oggi)
        candidates++;
        if (!live) continue; // dry-run: non inviare
        if (sent >= CAP) { errors.push("cap_reached"); return; }
        // Claim anti-duplicato: inserisce la riga; se già presente (conflict) salta.
        const claim = await admin.from("auto_message_log")
          .upsert({ tenant_id: tenantId, booking_id: s(b.id), template_id: tp.id, slot_date: slot }, { onConflict: "tenant_id,booking_id,template_id,slot_date", ignoreDuplicates: true })
          .select("id");
        if (claim.error) { errors.push(`claim: ${claim.error.message}`); continue; }
        if (!claim.data || claim.data.length === 0) continue; // già inviato in precedenza
        const text = fillTokens(tp.texts?.[lang] || tp.texts?.it || "", ctx).trim();
        if (!text) { continue; }
        try {
          const r = await fetch(`${origin}/api/email`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind: "guest_message", to: email, subject: tp.name || s(st.name) || "Messaggio", text, booking: { structureName: s(st.name), structureEmail: s(st.email), color: s(st.photoColor) }, replyTo: s(st.email) || undefined }),
          });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j?.ok) { sent++; }
          else { errors.push(`send ${s(b.id)}/${tp.id}: ${j?.error || r.status}`); await admin.from("auto_message_log").delete().eq("tenant_id", tenantId).eq("booking_id", s(b.id)).eq("template_id", tp.id).eq("slot_date", slot); }
        } catch (e) { errors.push(`send ${s(b.id)}: ${e instanceof Error ? e.message : "err"}`); await admin.from("auto_message_log").delete().eq("tenant_id", tenantId).eq("booking_id", s(b.id)).eq("template_id", tp.id).eq("slot_date", slot); }
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
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "scan_failed", accounts, candidates, sent }, { status: 500 });
  }

  return NextResponse.json({ ok: true, live, today: todayRome, accounts, candidates, sent, ...(errors.length ? { errors: errors.slice(0, 50) } : {}) });
}
