import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scrittura di RITORNO dopo il pagamento di un preventivo.
// L'ospite paga sul link pubblico /preventivo; al rientro (?paid=1&session_id=…) questa route:
//  1) verifica su Stripe che la sessione sia davvero PAGATA (con l'account Connect della struttura);
//  2) legge dai metadata della sessione (fidati: impostati lato server al momento del pagamento)
//     i dati della prenotazione + l'id utente del proprietario;
//  3) scrive nella riga app_state del proprietario (service role) una PRENOTAZIONE confermata
//     e segna il preventivo come confermato — in modo IDEMPOTENTE (dedup sulla sessione Stripe).
// Il client del proprietario, alla prima sincronizzazione, vede la nuova prenotazione (la fusione
// per id aggiunge sempre le prenotazioni nuove) e quindi compare in calendario.

const DATA_KEY = "spigolestay:data:v1";
const PREV_KEY = "spigolestay:preventivi";

type Json = Record<string, unknown>;
type Booking = Json & { id: string; structureId: string; roomTypeId: string; unitId: string | null; checkIn: string; checkOut: string; status: string; extId?: string };
type Unit = { id: string; roomTypeId: string; outOfService?: boolean };

const overlaps = (b: { checkIn: string; checkOut: string }, ci: string, co: string) => b.checkIn < co && b.checkOut > ci;

export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  if (!sbUrl || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = String(body?.session_id || "").trim();
    const acct = typeof body?.acct === "string" && body.acct.trim() ? body.acct.trim() : "";
    if (!sessionId) return NextResponse.json({ error: "missing_session" }, { status: 400 });

    // 1) Verifica pagamento su Stripe. Con i destination charge la sessione è sull'account
    //    PIATTAFORMA, quindi si recupera sempre senza stripeAccount header.
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") return NextResponse.json({ error: "not_paid", status: session.payment_status }, { status: 402 });

    const m = (session.metadata ?? {}) as Record<string, string>;
    const amountPaid = Math.round((session.amount_total ?? 0) / 100); // in euro
    const uid = (m.uid || "").trim();
    const ownerEmail = (m.oe || "").trim().toLowerCase();
    const sid = (m.sid || "").trim();      // structureId
    const rt = (m.rt || "").trim();        // roomTypeId
    const ci = (m.ci || "").trim();
    const co = (m.co || "").trim();
    const adults = Math.max(1, parseInt(m.ad || "1", 10) || 1);
    const children = Math.max(0, parseInt(m.ch || "0", 10) || 0);
    const total = Math.round(Number(m.tot) || 0) || undefined;
    const gn = (m.gn || "").trim();        // nome ospite
    const ge = (m.ge || "").trim();        // email ospite
    const ref = (m.ref || "").trim();      // codice preventivo "n/anno"
    // Servizi extra scelti dall'ospite sulla pagina pubblica: formato compatto "Nome:12.5|Nome2:8"
    // (evita di sprecare il limite di 480 caratteri per valore dei metadata Stripe con JSON verboso).
    const extras: { name: string; price: number }[] = (m.ext || "").split("|").map((seg) => seg.trim()).filter(Boolean).map((seg) => {
      const idx = seg.lastIndexOf(":");
      if (idx < 0) return null;
      const price = Number(seg.slice(idx + 1));
      const name = seg.slice(0, idx).trim();
      return name && Number.isFinite(price) ? { name, price } : null;
    }).filter((x): x is { name: string; price: number } => !!x);
    if (!sid || !ci || !co) return NextResponse.json({ error: "missing_metadata" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

    // 2) Trova la riga app_state del proprietario (per user_id o, in mancanza, per email).
    let ownerId = uid;
    if (!ownerId && ownerEmail) {
      const { data: prof } = await admin.from("profiles").select("user_id, email").eq("email", ownerEmail).maybeSingle();
      ownerId = (prof?.user_id as string) || "";
    }
    if (!ownerId) return NextResponse.json({ error: "owner_not_found" }, { status: 404 });

    const { data: row, error: readErr } = await admin.from("app_state").select("data, rev").eq("user_id", ownerId).maybeSingle();
    if (readErr) return NextResponse.json({ error: "read_error" }, { status: 500 });
    const blob = ((row?.data ?? {}) as Record<string, string>) || {};
    const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;

    let data: Json = {};
    try { data = JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { data = {}; }
    const bookings = (Array.isArray(data.bookings) ? data.bookings : []) as Booking[];
    const guests = (Array.isArray(data.guests) ? data.guests : []) as (Json & { id: string; email?: string; name?: string })[];
    const units = (Array.isArray(data.units) ? data.units : []) as Unit[];

    const extId = `stripe:${sessionId}`;
    // 3) Idempotenza: se esiste già una prenotazione per questa sessione, non ricreare.
    if (bookings.some((b) => b.extId === extId)) return NextResponse.json({ ok: true, already: true });

    // Ospite: riusa quello con la stessa email, altrimenti creane uno.
    let guestId = "";
    if (ge) { const g = guests.find((x) => (x.email || "").toLowerCase() === ge.toLowerCase()); if (g) guestId = g.id; }
    if (!guestId) {
      guestId = (globalThis.crypto?.randomUUID?.() ?? `g_${Date.now()}`);
      guests.push({ id: guestId, name: gn || ge || "Ospite", email: ge || undefined });
      data.guests = guests;
    }

    // Camera: scegli una unità libera della tipologia; se nessuna libera, la prima della tipologia.
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
      total,
      paid: amountPaid,
      depositPaid: amountPaid > 0,
      extId,
      extras: extras.length ? extras : undefined,
      note: ref ? `Da preventivo n. ${ref} · pagato online` : "Pagato online",
    };
    bookings.push(booking);
    data.bookings = bookings;
    blob[DATA_KEY] = JSON.stringify(data);

    // Segna il preventivo come confermato nella copia sul server (best-effort).
    try {
      const prev = JSON.parse(blob[PREV_KEY] || "[]") as (Json & { number?: number; createdAt?: string; status?: string })[];
      if (Array.isArray(prev) && ref) {
        const [num] = ref.split("/");
        const target = prev.find((p) => String(p.number) === num);
        if (target) { target.status = "confermato"; blob[PREV_KEY] = JSON.stringify(prev); }
      }
    } catch { /* niente */ }

    // 4) Scrittura con service role (bypassa RLS). Il trigger DB incrementa rev e blocca gli svuotamenti.
    let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", ownerId);
    if (rev !== null) write = write.eq("rev", rev);
    const { data: updated, error: wErr } = await write.select("rev");
    if (wErr) return NextResponse.json({ error: "write_error", message: wErr.message }, { status: 500 });
    if (!updated || updated.length === 0) {
      // Conflitto di versione (il proprietario ha salvato nel frattempo): riprova una volta senza lock.
      const { data: row2 } = await admin.from("app_state").select("data").eq("user_id", ownerId).maybeSingle();
      const blob2 = ((row2?.data ?? {}) as Record<string, string>) || {};
      let d2: Json = {}; try { d2 = JSON.parse(blob2[DATA_KEY] || "{}") as Json; } catch { d2 = {}; }
      const bk2 = (Array.isArray(d2.bookings) ? d2.bookings : []) as Booking[];
      if (bk2.some((b) => b.extId === extId)) return NextResponse.json({ ok: true, already: true });
      const gs2 = (Array.isArray(d2.guests) ? d2.guests : []) as (Json & { id: string })[];
      if (!gs2.some((g) => g.id === guestId)) { gs2.push({ id: guestId, name: gn || ge || "Ospite", email: ge || undefined } as Json & { id: string }); d2.guests = gs2; }
      bk2.push(booking); d2.bookings = bk2; blob2[DATA_KEY] = JSON.stringify(d2);
      const { error: wErr2 } = await admin.from("app_state").update({ data: blob2, updated_at: new Date().toISOString() }).eq("user_id", ownerId);
      if (wErr2) return NextResponse.json({ error: "write_error", message: wErr2.message }, { status: 500 });
    }

    // Fee di piattaforma: se la sessione portava una fee (source='direct' con application_fee),
    // registra la riga nel ledger. Idempotente per payment_intent (unique index).
    try {
      const feeTotal = parseInt((m.fee_total || "0"), 10) || 0;
      if (feeTotal > 0 && (m.source || "direct") === "direct") {
        const pi = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
        await admin.from("platform_fees").upsert({
          tenant_id: ownerId, org_id: null, structure_id: sid, booking_id: booking.id, source: "direct",
          currency: "EUR", gross_amount_cents: (session.amount_total ?? amountPaid * 100),
          fee_base_cents: parseInt((m.fee_base || "0"), 10) || 0,
          fee_vat_cents: parseInt((m.fee_vat || "0"), 10) || 0,
          fee_total_cents: feeTotal,
          stripe_account_id: acct || null, stripe_payment_intent_id: pi,
          status: "collected", collected_at: new Date().toISOString(),
        }, { onConflict: "stripe_payment_intent_id" });
      }
    } catch { /* il ledger fee non deve mai bloccare la conferma prenotazione */ }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
