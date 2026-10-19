import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/server-auth";
import { createClient } from "@supabase/supabase-js";
import { logInvio, giaInviato } from "@/lib/invii-log";
import { DATA_KEY } from "@/lib/manage-booking";
import type { Booking, Structure, Guest } from "@/lib/types";
import { autoMessageCoversToday, dedupeGroups, orgBlobFor } from "@/lib/auto-messages-core";
import { slotDateOf, stepsOfTemplate, type AutoTpl } from "@/lib/auto-schedule";
import { loadUserBlob, ownerOfOrg, recordAutoSent } from "@/lib/auto-trace";
import { todayRome } from "@/lib/dates-rome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // scorre tutti gli account e manda una email per ospite: il tetto di default (10 s) non basta

// ─────────────────────────────────────────────────────────────────────────────
// CRON: sollecito check-in online agli ospiti in arrivo DOMANI.
//
// Vercel Cron chiama questo endpoint una volta al giorno (vedi vercel.json, 07:00 UTC).
// Vercel invia automaticamente l'header `Authorization: Bearer <CRON_SECRET>` se la env
// CRON_SECRET è configurata nel progetto. In alternativa (test manuale) si accetta `?secret=`.
//
// Comportamento graceful: se mancano le env necessarie NON crasha, risponde 200 con lo
// stato "skipped" così il build/deploy e le chiamate non generano errori.
//
// Regole: niente promemoria alle prenotazioni provvisorie (tentative); un solo promemoria per gruppo di camere; se oggi parte già un messaggio automatico
// (modelli & automazioni, con AUTO_MESSAGES_LIVE=1) che contiene lo stesso link di check-in, il promemoria salta (niente doppia email a un'ora di distanza).
// Gli esiti si scrivono nel registro del TITOLARE (anche per le strutture condivise), dove l'app li legge per l'avviso «invio non arrivato».
// ─────────────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const arr = <T = Json>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

// Parsifica il blob JSON dentro la riga di sync (colonna `data`, chiave DATA_KEY).
function parseData(rowData: unknown): Json {
  const blob = ((rowData ?? {}) as Record<string, string>) || {};
  try {
    return JSON.parse(blob[DATA_KEY] || "{}") as Json;
  } catch {
    return {};
  }
}

// Data locale italiana (Europe/Rome) spostata di `days` giorni, in formato YYYY-MM-DD.
function itDatePlus(days: number): string {
  const now = new Date();
  // en-CA formatta come YYYY-MM-DD; il fuso è quello del cantiere/struttura (Italia).
  const todayIt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const d = new Date(todayIt + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Messaggi automatici agli ospiti SPENTI (decisione del titolare, ottobre 2026): i messaggi li manda lui, a mano, dalla scheda della prenotazione.
// Il cron non è più programmato in vercel.json e, se qualcuno lo chiama lo stesso, non invia nulla. Per riaccenderlo: rimettere la riga in vercel.json e questa costante a true.
const GUEST_AUTO_MESSAGES_ENABLED = false;

export async function GET(req: Request) {
  if (!GUEST_AUTO_MESSAGES_ENABLED) return NextResponse.json({ ok: true, skipped: "messaggi_automatici_disattivati" });
  // 1) Autorizzazione: header Bearer (inviato da Vercel Cron) oppure ?secret= (test manuale).
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Nessun segreto configurato: non facciamo nulla, ma non è un errore.
    return NextResponse.json({ ok: false, skipped: "no_secret" });
  }
  const url = new URL(req.url);
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const querySecret = url.searchParams.get("secret") || "";
  if (bearer !== secret && querySecret !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // 2) Client admin service-role (mai esposto al browser). Se mancano le env → skip graceful.
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !service) {
    return NextResponse.json({ ok: false, skipped: "supabase_not_configured" });
  }
  const admin = createClient(supaUrl, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Origin per costruire i link e la chiamata interna a /api/email.
  // Indirizzo FISSO del sito (l'host della richiesta del cron è quello del deployment, protetto da autenticazione).
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || "https://xenora.it").replace(/\/+$/, "");

  const tomorrow = itDatePlus(1);

  let scanned = 0; // prenotazioni con arrivo domani (candidate)
  let sent = 0; // email effettivamente inviate
  const errors: string[] = [];

  let skippedDup = 0; // già sollecitate nelle ultime 20 ore (anti-doppioni)
  let skippedAuto = 0; // coperte da un messaggio automatico con lo stesso link di check-in
  const autoLive = process.env.AUTO_MESSAGES_LIVE === "1";
  const today = todayRome();

  // Elabora una singola riga (blob) di org_state o app_state. `tenantId` = user_id / org_id della riga (serve al registro invii).
  // Titolare dell'organizzazione (per le righe org_state) e suo blob personale: registro e modelli stanno lì.
  async function processBlob(rowTenantId: string, rowData: unknown, orgId?: string) {
    const data = parseData(rowData);
    const bookings = arr<Booking>(data.bookings);
    if (!bookings.length) return;
    let tenantId = rowTenantId; // a chi appartiene il registro invii
    let blob = ((rowData ?? {}) as Record<string, string>) || {};
    if (orgId) {
      const owner = await ownerOfOrg(admin, orgId);
      if (owner) { tenantId = owner; blob = orgBlobFor(blob, await loadUserBlob(admin, owner)); }
    }
    // Modelli automatici attivi con {link_checkin}: se uno parte OGGI per questa prenotazione porta già il link, il promemoria sarebbe un doppione.
    let linkTpls: AutoTpl[] = [];
    if (autoLive) { try { linkTpls = (JSON.parse(blob["spigolestay:msgtemplates"] || "[]") as AutoTpl[]).filter((t) => t && t.active && t.trigger !== "manual" && stepsOfTemplate(t).includes("checkin")); } catch { linkTpls = []; } }
    const rows = bookings.filter((b) => b && String(b.checkIn || "") === tomorrow && b.status !== "cancelled" && b.status !== "no_show" && b.status !== "tentative" && b.channel !== "blocked");
    const grp = dedupeGroups(rows.map((b) => ({ id: String(b.id), groupId: b.groupId ? String(b.groupId) : undefined, checkIn: String(b.checkIn) })));
    const structures = arr<Structure>(data.structures);
    const guests = arr<Guest>(data.guests);
    const structById = new Map(structures.map((s) => [String(s.id), s]));
    const guestById = new Map(guests.map((g) => [String(g.id), g]));

    for (const b of bookings) {
      try {
        if (!b || String(b.checkIn || "") !== tomorrow) continue;
        if (b.status === "cancelled" || b.status === "no_show") continue;
        if (b.status === "tentative") continue; // prenotazione non ancora ferma: nessun promemoria
        if (b.channel === "blocked") continue;
        if (b.webCheckin === true) continue;
        if (grp.skippedIds.has(String(b.id))) continue; // camera di un gruppo: il promemoria parte una volta sola, dalla prima

        const guest = guestById.get(String(b.guestId || "")) || null;
        const guestEmail = guest?.email ? String(guest.email).trim() : "";
        if (!guestEmail) continue; // niente email → non possiamo sollecitare

        scanned++;

        // Un messaggio automatico con {link_checkin} parte oggi per questa prenotazione (e per questa struttura)? Allora porta già il link: niente doppia email.
        // Si salta solo se quel messaggio PARTE davvero (o è già partito oggi): se per la prenotazione e il modello c'è già una riga nel registro di un altro giorno
        // (inviato prima, date spostate) il cron dei messaggi oggi non lo rimanda, e il promemoria resta l'unico invito al check-in.
        let coveredByAuto = false;
        for (const t of linkTpls) {
          if (t.structureIds?.length && !t.structureIds.includes(String(b.structureId))) continue;
          if (slotDateOf(t, String(b.checkIn), String(b.checkOut)) !== today) continue;
          const ids = grp.membersOf.get(String(b.id)) ?? [String(b.id)];
          const q = await admin.from("auto_message_log").select("slot_date").eq("tenant_id", rowTenantId).eq("template_id", t.id).in("booking_id", ids);
          if (q.error) { errors.push(`auto_message_log ${b.id}: ${q.error.message}`); continue; } // registro illeggibile: meglio un doppione che un sollecito mancato
          if (autoMessageCoversToday((q.data ?? []) as { slot_date?: string }[], today)) { coveredByAuto = true; break; }
        }
        if (coveredByAuto) { skippedAuto++; continue; }

        // Anti-doppioni: se per questa prenotazione c'è già un sollecito riuscito nelle ultime 20 ore non si rimanda.
        // Se il registro non si legge si invia comunque (meglio un doppione che un sollecito mancato) e si segnala.
        const dup = tenantId ? await giaInviato(admin, tenantId, "checkin", String(b.id), 20, "email") : { gia: false };
        if (dup.gia) { skippedDup++; continue; }
        if (dup.errore) errors.push(`invii_log (anti-doppioni) ${b.id}: ${dup.errore}`);

        const st = structById.get(String(b.structureId || "")) || null;
        const checkinUrl = `${origin}/checkin?b=${b.id}`;
        const payload = {
          kind: "checkin_reminder",
          checkinUrl,
          booking: {
            code: b.code,
            structureName: st?.name,
            structureEmail: st?.email,
            guestName: guest?.fullName,
            guestEmail,
            guestPhone: guest?.phone ? String(guest.phone) : undefined, guestCountry: guest?.country ? String(guest.country) : undefined, guestLanguage: guest?.language ? String(guest.language) : undefined, // lingua dell'email
            checkIn: b.checkIn,
            checkInFrom: st?.checkInFrom,
            color: st?.photoColor,
            address: [st?.address, st?.streetNumber, st?.city].filter(Boolean).join(" "),
            phone: st?.phone,
            logo: st?.logo,
            website: st?.website,
            cin: st?.cin,
            vat: st?.vat,
          },
        };

        const res = await internalFetch(`${origin}/api/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
          if (j.ok) {
            sent++;
            if (tenantId) {
              await logInvio(admin, tenantId, { job: "checkin", ref: String(b.id), channel: "email", ok: true, detail: `promemoria check-in → ${guestEmail}` });
              // Traccia nella chat dell'ospite (con prenotazione e tipo «checkin»): lo storico dei solleciti e il percorso della prenotazione lo mostrano.
              await recordAutoSent(admin, { ownerId: tenantId, guestId: String(b.guestId || ""), bookingId: String(b.id), text: `Promemoria check-in online: ${checkinUrl}`, via: "Email", rems: ["checkin"], idKey: `checkin-${b.id}-${tomorrow}`, guestName: String(guest?.fullName || ""), tplName: "Promemoria check-in" });
            }
          }
          else { errors.push(`booking ${b.id}: ${j.error || "email_failed"}`); if (tenantId) await logInvio(admin, tenantId, { job: "checkin", ref: String(b.id), channel: "email", ok: false, detail: `promemoria check-in → ${guestEmail}: ${j.error || "email_failed"}` }); }
        } else {
          errors.push(`booking ${b.id}: email HTTP ${res.status}`);
          if (tenantId) await logInvio(admin, tenantId, { job: "checkin", ref: String(b.id), channel: "email", ok: false, detail: `promemoria check-in → ${guestEmail}: errore HTTP ${res.status}` });
        }
      } catch (e) {
        // Un errore su una prenotazione non deve bloccare le altre.
        errors.push(`booking ${b?.id ?? "?"}: ${e instanceof Error ? e.message : "error"}`);
        if (tenantId && b?.id) await logInvio(admin, tenantId, { job: "checkin", ref: String(b.id), channel: "email", ok: false, detail: `promemoria check-in: ${e instanceof Error ? e.message : "errore"}` });
      }
    }
  }

  try {
    // 3) Scansione di TUTTE le strutture condivise (org_state) e personali (app_state).
    const { data: orgRows, error: orgErr } = await admin.from("org_state").select("org_id, data").limit(5000);
    if (orgErr) errors.push(`org_state: ${orgErr.message}`);
    for (const row of arr<{ org_id?: string; data?: unknown }>(orgRows)) {
      await processBlob(String(row.org_id ?? ""), row.data, String(row.org_id ?? ""));
    }

    const { data: appRows, error: appErr } = await admin.from("app_state").select("user_id, data").limit(10000);
    if (appErr) errors.push(`app_state: ${appErr.message}`);
    for (const row of arr<{ user_id?: string; data?: unknown }>(appRows)) {
      await processBlob(String(row.user_id ?? ""), row.data);
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "scan_failed", sent, scanned },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    date: tomorrow,
    scanned,
    sent,
    skippedDup,
    skippedAuto,
    ...(errors.length ? { errors: errors.slice(0, 50) } : {}),
  });
}
