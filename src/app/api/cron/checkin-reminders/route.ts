import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DATA_KEY } from "@/lib/manage-booking";
import type { Booking, Structure, Guest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// CRON: sollecito check-in online agli ospiti in arrivo DOMANI.
//
// Vercel Cron chiama questo endpoint una volta al giorno (vedi vercel.json, 07:00 UTC).
// Vercel invia automaticamente l'header `Authorization: Bearer <CRON_SECRET>` se la env
// CRON_SECRET è configurata nel progetto. In alternativa (test manuale) si accetta `?secret=`.
//
// Comportamento graceful: se mancano le env necessarie NON crasha, risponde 200 con lo
// stato "skipped" così il build/deploy e le chiamate non generano errori.
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

export async function GET(req: Request) {
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
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || "";
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (host ? `${proto}://${host}` : "https://xenora.it");

  const tomorrow = itDatePlus(1);

  let scanned = 0; // prenotazioni con arrivo domani (candidate)
  let sent = 0; // email effettivamente inviate
  const errors: string[] = [];

  // Elabora una singola riga (blob) di org_state o app_state.
  async function processBlob(rowData: unknown) {
    const data = parseData(rowData);
    const bookings = arr<Booking>(data.bookings);
    if (!bookings.length) return;
    const structures = arr<Structure>(data.structures);
    const guests = arr<Guest>(data.guests);
    const structById = new Map(structures.map((s) => [String(s.id), s]));
    const guestById = new Map(guests.map((g) => [String(g.id), g]));

    for (const b of bookings) {
      try {
        if (!b || String(b.checkIn || "") !== tomorrow) continue;
        if (b.status === "cancelled") continue;
        if (b.channel === "blocked") continue;
        if (b.webCheckin === true) continue;

        const guest = guestById.get(String(b.guestId || "")) || null;
        const guestEmail = guest?.email ? String(guest.email).trim() : "";
        if (!guestEmail) continue; // niente email → non possiamo sollecitare

        scanned++;

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

        const res = await fetch(`${origin}/api/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
          if (j.ok) sent++;
          else errors.push(`booking ${b.id}: ${j.error || "email_failed"}`);
        } else {
          errors.push(`booking ${b.id}: email HTTP ${res.status}`);
        }
      } catch (e) {
        // Un errore su una prenotazione non deve bloccare le altre.
        errors.push(`booking ${b?.id ?? "?"}: ${e instanceof Error ? e.message : "error"}`);
      }
    }
  }

  try {
    // 3) Scansione di TUTTE le strutture condivise (org_state) e personali (app_state).
    const { data: orgRows, error: orgErr } = await admin.from("org_state").select("data").limit(5000);
    if (orgErr) errors.push(`org_state: ${orgErr.message}`);
    for (const row of arr<{ data?: unknown }>(orgRows)) {
      await processBlob((row as { data?: unknown }).data);
    }

    const { data: appRows, error: appErr } = await admin.from("app_state").select("data").limit(10000);
    if (appErr) errors.push(`app_state: ${appErr.message}`);
    for (const row of arr<{ data?: unknown }>(appRows)) {
      await processBlob((row as { data?: unknown }).data);
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
    ...(errors.length ? { errors: errors.slice(0, 50) } : {}),
  });
}
