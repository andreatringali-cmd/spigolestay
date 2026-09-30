import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { channexEnabled, listBookingRevisions, listProperties, listRoomTypesFor, listRatePlansForRoomType } from "@/lib/channex";
import { runCertScenario, setupTestProperty, resolveCertContext, SCENARIO_IDS, type ScenarioId } from "@/lib/channex-cert";
import { importBookings } from "@/lib/channex-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Esegue UNO scenario di certificazione Channex (1..10) e restituisce i task_id + esito.
// SOLO-ADMIN: accesso riservato alle email in ADMIN_EMAILS (stesso pattern del back-office).
// POST /api/channex/cert/run  body: { scenario: "1".."10" }
// → { ok, scenario, label, calls: [{ endpoint, taskId, status, ok, sent, error?, raw? }], error? }

const OWNER_EMAILS = (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com,andreatringali.spi@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error } = await admin.auth.getUser(token);
  const caller = who?.user;
  if (error || !caller?.email || !OWNER_EMAILS.includes(caller.email.toLowerCase())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });

  const body = await req.json().catch(() => null) as { scenario?: string; action?: string } | null;

  // Azione: crea (o riusa) la property di test dedicata alla certificazione e restituisce tutti gli ID.
  if (body?.action === "setup-test-property") {
    const setup = await setupTestProperty();
    return NextResponse.json({ ok: setup.ok, setup }, { status: 200 });
  }

  // Azione: mostra gli ID REALI su cui gireranno gli scenari (property + tipologie + piani
  // tariffari, con id e titolo). Read-only: non crea né modifica nulla su Channex. Serve a
  // compilare il form di certificazione con gli ID veri (property di test se esiste, altrimenti
  // la struttura reale collegata) e a diagnosticare cosa "vede" davvero Xenora su Channex.
  if (body?.action === "context") {
    const ctx = await resolveCertContext(admin, caller.id);
    if ("error" in ctx) return NextResponse.json({ ok: false, error: ctx.error }, { status: 200 });
    return NextResponse.json({
      ok: true,
      context: {
        propertyId: ctx.propertyId,
        roomTypes: ctx.roomTypes,
        combos: ctx.combos,
      },
    }, { status: 200 });
  }

  // Azione: legge (sola lettura, NESSUN ack) le revision delle prenotazioni su Channex per la
  // property di certificazione. Serve al Test #11: raccogliere booking_id + revision id (nuova/
  // modificata/cancellata). Le raggruppa per prenotazione.
  if (body?.action === "booking-revisions") {
    const ctx = await resolveCertContext(admin, caller.id);
    const propertyId = "error" in ctx ? undefined : ctx.propertyId;
    const res = await listBookingRevisions({ propertyId, limit: 60 });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error || `Errore ${res.status}` }, { status: 200 });
    // Raggruppa per booking_id e ordina le revision per numero progressivo.
    const groups: Record<string, typeof res.rows> = {};
    for (const r of res.rows) {
      const k = r.booking_id || r.id;
      (groups[k] ||= []).push(r);
    }
    // Ordine cronologico: per numero revision se presente, altrimenti per data di inserimento
    // (così l'ordine è sempre Nuova → Modificata → Cancellata).
    const ord = (r: { revision?: number; inserted_at?: string }) => r.revision ?? 0;
    const bookings = Object.entries(groups).map(([bookingId, rows]) => ({
      bookingId,
      revisions: [...rows].sort((a, b) => ord(a) - ord(b) || String(a.inserted_at ?? "").localeCompare(String(b.inserted_at ?? ""))),
    }));
    return NextResponse.json({ ok: true, propertyId: propertyId ?? null, bookings }, { status: 200 });
  }

  // Azione: esegue l'import/ACK dal FLUSSO DI INTEGRAZIONE (lo stesso di cron e "Controlla
  // prenotazioni ora"), che ora ACKa anche le revision della property di test. È questo il flusso
  // che Channex riconosce come integrazione — l'ACK deve arrivare da qui, non da chiamate manuali.
  if (body?.action === "ack-bookings") {
    const r = await importBookings(admin);
    return NextResponse.json({ ok: r.ok, acked: r.acked, feed: r.feed, error: r.errors?.[0] }, { status: 200 });
  }

  // Azione DIAGNOSTICA (sola lettura): elenca TUTTE le property su Channex il cui titolo contiene
  // "Test Property" o "Xenora", con tutte le tipologie/piani tariffari di ciascuna — serve a scoprire
  // eventuali DOPPIONI della property di certificazione (stesso titolo, ID diversi) che spiegherebbero
  // un mismatch tra la property su cui girano gli scenari e quella controllata da Channex.
  if (body?.action === "list-test-properties") {
    const listed = await listProperties();
    if (!listed.ok) return NextResponse.json({ ok: false, error: listed.error || `Errore ${listed.status}` }, { status: 200 });
    const rows = (listed.data?.data ?? []) as { id: string; attributes?: { title?: string } }[];
    const candidates = rows.filter((p) => /test property|xenora/i.test(String(p.attributes?.title ?? "")));
    const out = [];
    for (const p of candidates) {
      const propertyId = String(p.id);
      const title = String(p.attributes?.title ?? "");
      const rtRes = await listRoomTypesFor(propertyId);
      const roomRows = (rtRes.ok ? (rtRes.data?.data ?? []) : []) as { id: string; attributes?: { title?: string } }[];
      const roomTypes = [];
      for (const rt of roomRows) {
        const rpRes = await listRatePlansForRoomType(String(rt.id));
        const rpRows = (rpRes.ok ? (rpRes.data?.data ?? []) : []) as { id: string; attributes?: { title?: string } }[];
        roomTypes.push({
          roomTypeId: String(rt.id),
          roomTitle: String(rt.attributes?.title ?? ""),
          ratePlans: rpRows.map((rp) => ({ ratePlanId: String(rp.id), ratePlanTitle: String(rp.attributes?.title ?? "") })),
        });
      }
      out.push({ propertyId, title, roomTypes });
    }
    return NextResponse.json({ ok: true, allProperties: rows.map((p) => ({ id: String(p.id), title: String(p.attributes?.title ?? "") })), candidates: out }, { status: 200 });
  }

  const scenario = String(body?.scenario || "") as ScenarioId;
  if (!SCENARIO_IDS.includes(scenario)) return NextResponse.json({ ok: false, error: "scenario non valido" }, { status: 400 });

  const res = await runCertScenario(admin, caller.id, scenario);
  return NextResponse.json(res, { status: 200 });
}
