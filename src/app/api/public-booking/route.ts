import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Intake prenotazioni dal sito PUBBLICO (Xenosite, xenora.it/<slug>).
// Il visitatore anonimo conferma una prenotazione: questa route (service role)
//  1) risolve lo slug → proprietario + struttura dalla tabella public_sites;
//  2) scrive una prenotazione confermata nella app_state del proprietario, così
//     compare nel suo calendario alla prima sincronizzazione.
// Idempotente su un token client (extId) per evitare doppioni da doppio invio.

const DATA_KEY = "spigolestay:data:v1";

type Json = Record<string, unknown>;
type Booking = Json & { id: string; structureId: string; roomTypeId: string; unitId: string | null; checkIn: string; checkOut: string; status: string; extId?: string };
type Unit = { id: string; roomTypeId: string; structureId?: string; outOfService?: boolean };

const overlaps = (b: { checkIn: string; checkOut: string }, ci: string, co: string) => b.checkIn < co && b.checkOut > ci;
const isISO = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim();
    const rt = String(body?.rt || "").trim();       // roomTypeId
    const ci = String(body?.ci || "").trim();
    const co = String(body?.co || "").trim();
    const adults = Math.max(1, parseInt(String(body?.adults ?? "1"), 10) || 1);
    const children = Math.max(0, parseInt(String(body?.children ?? "0"), 10) || 0);
    const childAges = Array.isArray(body?.childAges) ? (body.childAges as unknown[]).map((x) => Number(x)).filter((x) => !isNaN(x)) : [];
    const total = Math.round(Number(body?.total) || 0) || undefined;
    const deposit = Math.round(Number(body?.deposit) || 0) || 0;
    const note = String(body?.note || "").slice(0, 500);
    const token = String(body?.token || "").trim().slice(0, 80);
    // Politica di cancellazione + riferimenti pagamento Stripe (per rimborso self-service)
    const planName = String(body?.planName || "").slice(0, 60);
    const refundable = body?.refundable === true;
    const cancelDays = Math.max(0, parseInt(String(body?.cancelDays ?? "0"), 10) || 0);
    const stripePaymentIntent = String(body?.stripePaymentIntent || "").slice(0, 120);
    const stripeSessionId = String(body?.stripeSessionId || "").slice(0, 120);
    const stripeAccountId = String(body?.stripeAccountId || "").slice(0, 120);
    const g = (body?.guest ?? {}) as Record<string, string>;
    const gFirst = String(g.firstName || "").trim();
    const gLast = String(g.lastName || "").trim();
    const gEmail = String(g.email || "").trim();
    const gPhone = String(g.phone || "").trim();
    const gCountry = String(g.country || "").trim();

    if (!slug || !rt || !isISO(ci) || !isISO(co) || co <= ci) return NextResponse.json({ error: "bad_request" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

    // 1) slug → proprietario + struttura
    const { data: site, error: siteErr } = await admin.from("public_sites").select("user_id, structure_id").eq("slug", slug).maybeSingle();
    if (siteErr) return NextResponse.json({ error: "read_error" }, { status: 500 });
    if (!site?.user_id) return NextResponse.json({ error: "site_not_found" }, { status: 404 });
    const ownerId = site.user_id as string;
    const sid = (site.structure_id as string) || "";
    if (!sid) return NextResponse.json({ error: "site_not_found" }, { status: 404 });

    const extId = token ? `site:${slug}:${token}` : `site:${slug}:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;

    // 2) leggi app_state del proprietario
    const { data: row, error: readErr } = await admin.from("app_state").select("data, rev").eq("user_id", ownerId).maybeSingle();
    if (readErr) return NextResponse.json({ error: "read_error" }, { status: 500 });
    const blob = ((row?.data ?? {}) as Record<string, string>) || {};
    const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;

    let data: Json = {};
    try { data = JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { data = {}; }
    const bookings = (Array.isArray(data.bookings) ? data.bookings : []) as Booking[];
    const guests = (Array.isArray(data.guests) ? data.guests : []) as (Json & { id: string; email?: string; fullName?: string; phone?: string })[];
    const units = (Array.isArray(data.units) ? data.units : []) as Unit[];

    // Idempotenza
    if (bookings.some((b) => b.extId === extId)) return NextResponse.json({ ok: true, already: true });

    // Ospite: riusa per email, altrimenti crea
    let guestId = "";
    if (gEmail) { const found = guests.find((x) => (x.email || "").toLowerCase() === gEmail.toLowerCase()); if (found) guestId = found.id; }
    if (!guestId) {
      guestId = (globalThis.crypto?.randomUUID?.() ?? `g_${Date.now()}`);
      const fullName = `${gFirst} ${gLast}`.trim() || gEmail || "Ospite";
      guests.push({ id: guestId, firstName: gFirst || undefined, lastName: gLast || undefined, fullName, email: gEmail || undefined, phone: gPhone || undefined, country: gCountry || undefined } as Json & { id: string });
      data.guests = guests;
    }

    // Camera: prima unità libera della tipologia, altrimenti la prima della tipologia
    const ofType = units.filter((u) => u.roomTypeId === rt && !u.outOfService);
    const free = ofType.find((u) => !bookings.some((b) => b.unitId === u.id && b.status !== "cancelled" && overlaps(b, ci, co)));
    const unitId = (free ?? ofType[0])?.id ?? null;

    const groupId = (globalThis.crypto?.randomUUID?.() ?? `grp_${Date.now()}`);
    const booking: Booking = {
      id: (globalThis.crypto?.randomUUID?.() ?? `b_${Date.now()}`),
      groupId,
      structureId: sid,
      roomTypeId: rt,
      unitId,
      guestId,
      channel: "direct",
      status: "confirmed",
      checkIn: ci,
      checkOut: co,
      bookedOn: new Date().toISOString().slice(0, 10),
      adults,
      children,
      childAges: childAges.length ? childAges : undefined,
      total,
      cleaningFee: 0,
      paid: deposit,
      cityTaxPaid: false,
      extId,
      code: String((body as { code?: string })?.code || "").trim().slice(0, 40) || undefined,
      note: note || "Prenotazione dal sito",
      ratePlanName: planName || undefined,
      refundable: refundable || undefined,
      cancelDays: cancelDays || undefined,
      stripePaymentIntent: stripePaymentIntent || undefined,
      stripeSessionId: stripeSessionId || undefined,
      stripeAccountId: stripeAccountId || undefined,
    };
    bookings.push(booking);
    data.bookings = bookings;
    blob[DATA_KEY] = JSON.stringify(data);

    // 3) scrittura con lock su rev; retry una volta in caso di conflitto
    let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", ownerId);
    if (rev !== null) write = write.eq("rev", rev);
    const { data: updated, error: wErr } = await write.select("rev");
    if (wErr) return NextResponse.json({ error: "write_error", message: wErr.message }, { status: 500 });
    if (!updated || updated.length === 0) {
      const { data: row2 } = await admin.from("app_state").select("data").eq("user_id", ownerId).maybeSingle();
      const blob2 = ((row2?.data ?? {}) as Record<string, string>) || {};
      let d2: Json = {}; try { d2 = JSON.parse(blob2[DATA_KEY] || "{}") as Json; } catch { d2 = {}; }
      const bk2 = (Array.isArray(d2.bookings) ? d2.bookings : []) as Booking[];
      if (bk2.some((b) => b.extId === extId)) return NextResponse.json({ ok: true, already: true });
      const gs2 = (Array.isArray(d2.guests) ? d2.guests : []) as (Json & { id: string })[];
      if (!gs2.some((x) => x.id === guestId)) { gs2.push({ id: guestId, fullName: `${gFirst} ${gLast}`.trim() || gEmail || "Ospite", email: gEmail || undefined } as Json & { id: string }); d2.guests = gs2; }
      bk2.push(booking); d2.bookings = bk2; blob2[DATA_KEY] = JSON.stringify(d2);
      const { error: wErr2 } = await admin.from("app_state").update({ data: blob2, updated_at: new Date().toISOString() }).eq("user_id", ownerId);
      if (wErr2) return NextResponse.json({ error: "write_error", message: wErr2.message }, { status: 500 });
    }

    // 4) Email di conferma AUTOMATICA all'ospite (best-effort: non blocca la prenotazione).
    try {
      // La struttura può essere PERSONALE (app_state del proprietario) oppure CONDIVISA
      // (org_state di un'organizzazione di cui il proprietario è membro). Cerchiamo in
      // entrambi: senza questo, per una struttura in società "st" resta undefined e
      // l'email non parte mai.
      let st = (Array.isArray(data.structures) ? data.structures : []).find((s) => (s as { id?: string }).id === sid) as (Record<string, unknown>) | undefined;
      let rtObj = (Array.isArray(data.roomTypes) ? data.roomTypes : []).find((r) => (r as { id?: string }).id === rt) as (Record<string, unknown>) | undefined;
      if (!st) {
        const { data: ms } = await admin.from("memberships").select("org_id").eq("user_id", ownerId);
        for (const m of (Array.isArray(ms) ? ms : [])) {
          const { data: os } = await admin.from("org_state").select("data").eq("org_id", (m as { org_id?: string }).org_id as string).maybeSingle();
          const oblob = (((os as { data?: unknown } | null)?.data ?? {}) as Record<string, string>) || {};
          let od: Json = {}; try { od = JSON.parse(oblob[DATA_KEY] || "{}") as Json; } catch { od = {}; }
          const found = (Array.isArray(od.structures) ? od.structures : []).find((s) => (s as { id?: string }).id === sid) as (Record<string, unknown>) | undefined;
          if (found) {
            st = found;
            rtObj = rtObj || ((Array.isArray(od.roomTypes) ? od.roomTypes : []).find((r) => (r as { id?: string }).id === rt) as (Record<string, unknown>) | undefined);
            break;
          }
        }
      }
      if (gEmail && st) {
        const origin = req.headers.get("origin") || new URL(req.url).origin;
        const nN = Math.max(1, Math.round((Date.parse(co) - Date.parse(ci)) / 86400000));
        const g = (k: string) => (st[k] as string) || undefined;
        // Testo della politica di cancellazione (per email + pagina di gestione).
        const cancelPolicy = refundable
          ? (cancelDays > 0 ? `Cancellazione gratuita fino a ${cancelDays} giorni prima dell'arrivo.` : "Cancellazione gratuita.")
          : "Tariffa non rimborsabile.";
        await fetch(`${origin}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "voucher",
            checkinUrl: `${origin}/checkin?site=${encodeURIComponent(slug)}&b=${encodeURIComponent(booking.id)}`,
            manageUrl: `${origin}/gestisci?site=${encodeURIComponent(slug)}&b=${encodeURIComponent(booking.id)}`,
            booking: {
              code: (booking.code as string) || booking.id.slice(0, 8).toUpperCase(),
              structureName: g("name"), structureEmail: g("email"), color: g("photoColor"),
              guestName: `${gFirst} ${gLast}`.trim() || gEmail, guestEmail: gEmail,
              roomType: (rtObj?.name as string) || undefined, checkIn: ci, checkOut: co, nights: nN,
              adults, children, total, currency: g("currency") || "€",
              checkInFrom: g("checkInFrom"), checkOutBy: g("checkOutBy"),
              address: [g("address"), g("streetNumber"), g("city")].filter(Boolean).join(" "), phone: g("phone"),
              ratePlan: planName || undefined, cancelPolicy,
            },
          }),
        });
      }
    } catch { /* email non critica */ }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
