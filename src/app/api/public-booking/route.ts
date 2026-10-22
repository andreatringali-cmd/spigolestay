import { schedulePoolPush } from "@/lib/pool-push";
import { POOL_KEY, parsePool, inPool, poolOccupancy } from "@/lib/inventory-pool";
import { NextResponse } from "next/server";
import { stayFloor, clientIp, loadOrgDataParts, mergeOwnerData, isRealIsoDate, loadOwnerRatePlans, type OwnerStructureData } from "@/lib/server-booking-guard";
import { rootRoomTypeId, loadOwnerPromos, resolveBookPromo, floorWithPromo, priceBookExtras } from "@/lib/book-order";
import { resolvePlanPolicy } from "@/lib/plan-policy";
import { cityTaxOfBookingRaw } from "@/lib/booking";
import { parseNotifPrefs } from "@/lib/notifPrefs";
import { notifyBookingLines } from "@/lib/booking-notify";
import { addDaysYmd } from "@/lib/dates-rome";
import type { Structure } from "@/lib/types";
import { isInternalRequest, rateLimited } from "@/lib/server-auth";
import { siteOrigin } from "@/lib/server-auth";
import { internalFetch } from "@/lib/server-auth";
import { createClient } from "@supabase/supabase-js";
import { ymdRome } from "@/lib/dates-rome";
import { plural } from "@/lib/plural";
import { declaredTooLarge, slugKey, SLUG_WINDOW_MS, LIMITS } from "@/lib/public-guard";

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
const isEmail = (s: string) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(s) && s.length <= 120;
// Solo l'avviso di camera da assegnare (la nota dell'ospite viaggia a parte, come "richieste").
const overbookedNote = (b: Booking) => (String(b.note || "").includes("nessuna camera libera") ? "⚠ nessuna camera libera in quelle date: da assegnare a mano" : undefined);
const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  // Chiamate interne (webhook Stripe / conferma pagamento, firmate): sono le uniche di cui ci si fida per incassi e riferimenti Stripe.
  // Chiamate anonime (il browser dell'ospite): niente "pagato", niente riferimenti Stripe, niente rimborsi, con limite di frequenza.
  const internal = isInternalRequest(req);
  if (!internal && rateLimited("pb:" + clientIp(req), 10, 60_000)) return NextResponse.json({ error: "troppe_richieste" }, { status: 429 });
  if (!internal && declaredTooLarge(req, LIMITS.publicBookingBody)) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });

  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim();
    // Oltre all IP: tetto per sito (un attaccante che cambia IP non puo riempire il calendario ne far partire centinaia di email di voucher).
    if (!internal && slug && rateLimited(slugKey("pb", slug), LIMITS.publicBookingPerSlug, SLUG_WINDOW_MS)) return NextResponse.json({ error: "troppe_richieste" }, { status: 429 });
    const rt = String(body?.rt || "").trim();       // roomTypeId
    const ci = String(body?.ci || "").trim();
    const co = String(body?.co || "").trim();
    const adults = Math.max(1, parseInt(String(body?.adults ?? "1"), 10) || 1);
    const children = Math.max(0, parseInt(String(body?.children ?? "0"), 10) || 0);
    const childAges = Array.isArray(body?.childAges) ? (body.childAges as unknown[]).map((x) => Number(x)).filter((x) => !isNaN(x)) : [];
    // Importi ai CENTESIMI (Stripe incassa ai centesimi: arrotondare all'euro falsava paid/total).
    const total = Math.min(1_000_000, Math.max(0, Math.round((Number(body?.total) || 0) * 100) / 100)) || undefined;
    const deposit = internal ? Math.max(0, Math.round((Number(body?.deposit) || 0) * 100) / 100) || 0 : 0;
    // Richieste scritte dall'ospite: limite ampio, così non si taglia in coda quello che ha scritto.
    const note = String(body?.note || "").trim().slice(0, 1500);
    const token = String(body?.token || "").trim().slice(0, 80);
    // Politica di cancellazione + riferimenti pagamento Stripe (per rimborso self-service)
    const planName = String(body?.planName || "").slice(0, 60);
    // Politica di cancellazione: dalle chiamate interne (webhook/conferma, già calcolata dal server) arriva nel corpo; per l'anonimo si ricava
    // dai piani del proprietario (più sotto), non da quello che dichiara il browser.
    let refundable = internal && body?.refundable === true;
    let cancelDays = internal ? Math.max(0, parseInt(String(body?.cancelDays ?? "0"), 10) || 0) : 0;
    const stripePaymentIntent = internal ? String(body?.stripePaymentIntent || "").slice(0, 120) : "";
    const stripeSessionId = internal ? String(body?.stripeSessionId || "").slice(0, 120) : "";
    const stripeAccountId = internal ? String(body?.stripeAccountId || "").slice(0, 120) : "";
    const g = (body?.guest ?? {}) as Record<string, string>;
    const gFirst = clip(g.firstName, 80);
    const gLast = clip(g.lastName, 80);
    let gEmail = clip(g.email, 120);
    // Lingua della pagina dell'ospite (it/en/fr/de/es): per l'email voucher e la scheda ospite.
    const langRaw = String(body?.lang || g.language || "").slice(0, 2).toLowerCase();
    const guestLanguage = ["it", "en", "fr", "de", "es"].includes(langRaw) ? langRaw : "";
    const promoCode = String(body?.promoCode || "").trim().slice(0, 40);
    const gPhone = clip(g.phone, 30);
    const gCountry = clip(g.country, 60);

    // Date reali (rifiuta 2026-02-30: il solo formato non basta).
    if (!slug || !rt || !isRealIsoDate(ci) || !isRealIsoDate(co) || co <= ci) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    // Email non valida: dal browser anonimo si rifiuta (l'ospite la corregge); da una chiamata INTERNA (pagamento gia' incassato, /api/stripe/book accetta ogni indirizzo con "@")
    // NON si rifiuta, altrimenti l'incasso resterebbe non registrato: la prenotazione si salva senza email e l'indirizzo scritto finisce in nota.
    let badEmailNote = "";
    if (gEmail && !isEmail(gEmail)) {
      if (!internal) return NextResponse.json({ error: "bad_email" }, { status: 400 });
      badEmailNote = gEmail; gEmail = "";
    }
    // Date ragionevoli: soggiorno fino a 60 notti, non nel passato (ieri è tollerato per i fusi), non oltre 2 anni. Giorni di calendario italiani.
    const nNights = Math.round((Date.parse(co) - Date.parse(ci)) / 86400000);
    const todayIt = ymdRome(Date.now());
    const yesterdayIt = addDaysYmd(todayIt, -1);
    const limitIt = addDaysYmd(todayIt, 730);
    if (!internal && (nNights > 60 || ci < yesterdayIt || ci > limitIt)) return NextResponse.json({ error: "bad_dates" }, { status: 400 });

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

    // Le strutture condivise (organizzazioni) stanno solo in org_state: camere e prenotazioni per i controlli vanno uniti a quelli personali
    // (pool incluso, che attraversa più organizzazioni). La prenotazione si scrive comunque nello stato personale: il sync la smista nell'organizzazione.
    const orgParts = await loadOrgDataParts(admin, ownerId);
    const merged = mergeOwnerData([data, ...orgParts]);
    const mRoomTypes = merged.roomTypes;
    const mUnits = merged.units as unknown as Unit[];
    const mBookings = merged.bookings as unknown as Booking[];

    // Idempotenza (anche sulle prenotazioni già smistate nelle organizzazioni)
    if (mBookings.some((b) => b.extId === extId)) return NextResponse.json({ ok: true, already: true });

    // Politica di cancellazione per l'anonimo: dal piano scelto (per nome) tra quelli del proprietario o predefiniti. Piano sconosciuto = non rimborsabile.
    if (!internal) {
      // Stessa fonte di /api/stripe/book (stato personale, poi organizzazioni): un piano che sta solo nell'organizzazione non deve diventare "non rimborsabile" nel voucher.
      const stPolicy = (merged.structures as unknown as { id?: string; cancelPolicy?: string }[]).find((s) => s.id === sid)?.cancelPolicy; // la cancellazione la decide la scheda struttura
      const pol = resolvePlanPolicy(await loadOwnerRatePlans(admin, ownerId), planName, { roomTypeId: rt, checkIn: ci, nights: nNights, structureId: sid, cancelPolicy: stPolicy });
      refundable = pol.refundable; cancelDays = pol.cancelDays;
    }

    // Ospite: riusa per email, altrimenti crea
    let guestId = "";
    if (gEmail) { const found = guests.find((x) => (x.email || "").toLowerCase() === gEmail.toLowerCase()); if (found) guestId = found.id; }
    if (!guestId) {
      guestId = (globalThis.crypto?.randomUUID?.() ?? `g_${Date.now()}`);
      const fullName = `${gFirst} ${gLast}`.trim() || gEmail || "Ospite";
      guests.push({ id: guestId, firstName: gFirst || undefined, lastName: gLast || undefined, fullName, email: gEmail || undefined, phone: gPhone || undefined, country: gCountry || undefined, language: guestLanguage || undefined } as Json & { id: string });
      data.guests = guests;
    }

    // Camera: prima unità libera della tipologia. Se non ce ne sono: dal sito anonimo si rifiuta (409); se invece il pagamento
    // è già avvenuto (chiamata interna) si registra comunque, senza camera e con un avviso, invece di sovrapporla a un'altra prenotazione.
    // La tipologia deve esistere ed essere di QUESTA struttura (dal sito anonimo): una inventata non deve passare.
    if (!internal && !mRoomTypes.some((x) => (x as { id?: string; structureId?: string }).id === rt && (x as { structureId?: string }).structureId === sid)) {
      return NextResponse.json({ error: "room_type_not_found" }, { status: 400 });
    }
    // Tariffe derivate (deriveFrom): le camere fisiche sono della tipologia madre, come nella pagina /prenota. Prezzo e prenotazione restano della tipologia scelta.
    const rootRt = rootRoomTypeId(mRoomTypes, rt);
    const ofType = mUnits.filter((u) => u.roomTypeId === rootRt && !u.outOfService);
    // Strutture che mostrano le stesse camere fisiche: la tipologia deve avere camere libere anche nel gruppo (le camere uguali si dividono le stesse camere fisiche).
    const pool = parsePool(blob[POOL_KEY]);
    const poolOcc = inPool(pool, sid) ? poolOccupancy(pool, mRoomTypes as never, mUnits, mBookings) : null;
    const poolBlocks = poolOcc ? !poolOcc.canSell(rootRt, ci, co) : false;
    const free = poolBlocks ? undefined : ofType.find((u) => !mBookings.some((b) => b.unitId === u.id && b.status !== "cancelled" && overlaps(b, ci, co)));
    let overbooked = false;
    let unitId: string | null = free?.id ?? null;
    if (!free && !internal) return NextResponse.json({ error: "no_availability" }, { status: 409 }); // anche se tutte le camere della tipologia sono fuori servizio
    if (!free) { overbooked = true; unitId = null; } // avviso anche quando i dati non mostrano camere: il gestore deve assegnarla a mano
    // Codice promo ed extra scelti dall'ospite: validati sui dati del proprietario (prezzi e sconti non arrivano mai dal browser).
    const stOwn = merged.structures.find((x) => (x as { id?: string }).id === sid) as Json | undefined;
    const promoValid = promoCode ? resolveBookPromo(await loadOwnerPromos(admin, ownerId), promoCode, { structureId: sid, checkIn: ci, today: ymdRome(Date.now()) }) : null;
    const chosenExtras = priceBookExtras(body?.extras, stOwn, { checkIn: ci, checkOut: co, adults });
    // Prezzo minimo (metà del listino): impedisce soggiorni "regalati" scrivendo un totale basso nella richiesta.
    if (!internal && total !== undefined) {
      const od: OwnerStructureData | null = merged.structures.some((x) => (x as { id?: string }).id === sid)
        ? { roomTypes: mRoomTypes as never, units: mUnits as never, bookings: mBookings as never, rateOverrides: merged.rateOverrides }
        : null;
      const floor = od ? stayFloor(od, rt, ci, co) : null;
      // total e' gia' al netto del codice promo: la soglia scende solo per una promo VALIDATA sulle promo del proprietario (e al massimo del 50%).
      if (floor !== null && total < floorWithPromo(floor, promoValid?.pct ?? 0)) return NextResponse.json({ error: "price_mismatch" }, { status: 400 });
    }
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
      bookedOn: ymdRome(Date.now()),
      adults,
      children,
      childAges: childAges.length ? childAges : undefined,
      total,
      cleaningFee: 0,
      paid: deposit,
      // Pagato online al momento della prenotazione (Stripe): l'incasso in Cassa è di questo giorno (fuso Roma), non dell'arrivo.
      ...(stripePaymentIntent && deposit > 0 ? { paidOnline: deposit, paidAt: ymdRome(Date.now()) } : {}),
      cityTaxPaid: false,
      updatedAt: Date.now(),
      extId,
      source: "sito", // origine: sito ufficiale → in gestionale si mostra il logo della struttura (lib/direct-origin.ts)
      code: String((body as { code?: string })?.code || "").trim().slice(0, 40) || undefined,
      note: (note || "Prenotazione dal sito") + (overbooked ? " · ⚠ nessuna camera libera in quelle date: da assegnare a mano" : "") + (badEmailNote ? ` · ⚠ email indicata dall'ospite non valida: ${badEmailNote}` : ""),
      ...(chosenExtras.length ? { extras: chosenExtras } : {}),
      ...(promoValid ? { promoCode: promoValid.code, promoPct: promoValid.pct } : {}),
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
      const { data: row2 } = await admin.from("app_state").select("data, rev").eq("user_id", ownerId).maybeSingle();
      const rev2 = typeof (row2 as { rev?: number } | null)?.rev === "number" ? (row2 as { rev: number }).rev : null;
      const blob2 = ((row2?.data ?? {}) as Record<string, string>) || {};
      let d2: Json = {}; try { d2 = JSON.parse(blob2[DATA_KEY] || "{}") as Json; } catch { d2 = {}; }
      const bk2 = (Array.isArray(d2.bookings) ? d2.bookings : []) as Booking[];
      if (bk2.some((b) => b.extId === extId)) return NextResponse.json({ ok: true, already: true });
      const gs2 = (Array.isArray(d2.guests) ? d2.guests : []) as (Json & { id: string })[];
      if (!gs2.some((x) => x.id === guestId)) { gs2.push({ id: guestId, fullName: `${gFirst} ${gLast}`.trim() || gEmail || "Ospite", email: gEmail || undefined } as Json & { id: string }); d2.guests = gs2; }
      // Il proprietario ha salvato nel frattempo: la camera scelta prima potrebbe non essere più libera. Si rifà il controllo sui dati freschi.
      const merged2 = mergeOwnerData([d2, ...orgParts]);
      const units2 = merged2.units as unknown as Unit[];
      const bkAll2 = merged2.bookings as unknown as Booking[];
      const pool2 = parsePool(blob2[POOL_KEY]);
      const poolOcc2 = inPool(pool2, sid) ? poolOccupancy(pool2, merged2.roomTypes as never, units2, bkAll2) : null;
      const ofType2 = units2.filter((u) => u.roomTypeId === rootRt && !u.outOfService);
      const free2 = poolOcc2 && !poolOcc2.canSell(rootRt, ci, co) ? undefined : ofType2.find((u) => !bkAll2.some((b) => b.unitId === u.id && b.status !== "cancelled" && overlaps(b, ci, co)));
      if (free2) { booking.unitId = free2.id; }
      else {
        if (!internal) return NextResponse.json({ error: "no_availability" }, { status: 409 });
        // Già pagato: si registra comunque, senza camera e con avviso, invece di sovrapporla a un'altra prenotazione.
        booking.unitId = null;
        if (!String(booking.note || "").includes("nessuna camera libera")) booking.note = (String(booking.note || "") + " · ⚠ nessuna camera libera in quelle date: da assegnare a mano").trim();
      }
      bk2.push(booking); d2.bookings = bk2; blob2[DATA_KEY] = JSON.stringify(d2);
      // Scrittura con lock sul rev appena riletto: se cambia ancora, si risponde 409 (il webhook Stripe ritenta, la scrittura è idempotente).
      let write2 = admin.from("app_state").update({ data: blob2, updated_at: new Date().toISOString() }).eq("user_id", ownerId);
      if (rev2 !== null) write2 = write2.eq("rev", rev2);
      const { data: updated2, error: wErr2 } = await write2.select("rev");
      if (wErr2) return NextResponse.json({ error: "write_error", message: wErr2.message }, { status: 500 });
      if (!updated2 || updated2.length === 0) return NextResponse.json({ error: "write_conflict" }, { status: 409 });
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
      if (st) {
        const origin = siteOrigin(req);
        const nN = Math.max(1, Math.round((Date.parse(co) - Date.parse(ci)) / 86400000));
        const g = (k: string) => (st[k] as string) || undefined;
        // Testo della politica di cancellazione (per email + pagina di gestione).
        const cancelPolicy = refundable
          ? (cancelDays > 0 ? `Cancellazione gratuita fino a ${plural(cancelDays, "giorno", "giorni")} prima dell'arrivo.` : "Cancellazione gratuita.")
          : "Tariffa non rimborsabile.";
        const unitName = (mUnits.find((u) => u.id === booking.unitId) as { name?: string } | undefined)?.name || undefined;
        const bookingCode = (booking.code as string) || booking.id.slice(0, 8).toUpperCase();
        // Tassa di soggiorno e importi: stessa formula del gestionale (lib/booking.ts), così voucher e scheda prenotazione coincidono.
        const cityTaxAmount = cityTaxOfBookingRaw(st as unknown as Structure, { adults, children, childAges, checkIn: ci, checkOut: co, total: total ?? 0 });
        const grandTotal = Math.round(((total ?? 0) + chosenExtras.reduce((a, e) => a + e.price, 0) + cityTaxAmount) * 100) / 100; // soggiorno + extra + tassa (come bookingGrandTotal)
        const paidNow = typeof booking.paid === "number" ? booking.paid : 0;
        if (gEmail) {
          await internalFetch(`${origin}/api/email`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind: "voucher",
              checkinUrl: `${origin}/checkin?site=${encodeURIComponent(slug)}&b=${encodeURIComponent(booking.id)}`,
              manageUrl: `${origin}/gestisci?site=${encodeURIComponent(slug)}&b=${encodeURIComponent(booking.id)}`,
              booking: {
                code: bookingCode, status: String(booking.status),
                structureName: g("name"), structureEmail: g("email"), color: g("photoColor"),
                guestName: `${gFirst} ${gLast}`.trim() || gEmail, guestEmail: gEmail,
                guestPhone: gPhone || undefined, guestCountry: gCountry || undefined, // lingua dell'email: dal Paese o dal prefisso del telefono
                refundable, cancelDays, guestLanguage: guestLanguage || undefined,
                roomType: (rtObj?.name as string) || undefined, unitName, checkIn: ci, checkOut: co, nights: nN,
                adults, children, total, currency: g("currency") || "€",
                // Importi del dettaglio: acconto versato, tassa di soggiorno (da pagare in struttura), extra e richieste scritte dall'ospite.
                bookingTotal: total, cityTaxAmount: cityTaxAmount > 0 ? cityTaxAmount : undefined, grandTotal, paid: paidNow, due: Math.max(0, Math.round((grandTotal - paidNow) * 100) / 100),
                extras: Array.isArray(booking.extras) && (booking.extras as unknown[]).length ? booking.extras : undefined,
                guestRequests: note || undefined,
                checkInFrom: g("checkInFrom"), checkOutBy: g("checkOutBy"),
                address: [g("address"), g("streetNumber"), g("city")].filter(Boolean).join(" "), phone: g("phone"),
                ratePlan: planName || undefined, cancelPolicy,
                logo: g("logo"), website: g("website"), cin: g("cin"), vat: g("vat"),
              },
            }),
          });
        }
        // Avviso al TITOLARE: nuova prenotazione dal sito (rispetta il toggle "Nuove prenotazioni" delle Impostazioni → Notifiche).
        try {
          const hostEmail = g("email");
          if (hostEmail && parseNotifPrefs(blob["spigolestay:notifs"]).newBooking) {
            const lines = notifyBookingLines({
              ev: "newBooking",
              booking: { code: bookingCode, checkIn: ci, checkOut: co, adults, children, total, paid: paidNow, guestRequests: note || undefined, note: overbookedNote(booking) },
              guest: { fullName: `${gFirst} ${gLast}`.trim() || gEmail, phone: gPhone, email: gEmail, country: gCountry },
              structureName: g("name"), roomLabel: [rtObj?.name as string, unitName].filter(Boolean).join(" · "), channelLabel: "Diretto",
            });
            const logo = g("logo");
            await internalFetch(`${origin}/api/email`, {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({
                kind: "notify", to: hostEmail, event: "newBooking",
                subject: `Nuova prenotazione ${bookingCode} · ${g("name") || ""}`.trim(),
                brand: { name: g("name"), logoUrl: logo && /^https?:\/\//i.test(logo) ? logo : undefined, color: g("photoColor"), address: [g("address"), g("streetNumber"), g("city")].filter(Boolean).join(" ") || undefined },
                channelLabel: "Diretto",
                text: lines.join("\n"),
                ctaUrl: `${origin}/prenotazioni?b=${encodeURIComponent(booking.id)}`, ctaLabel: "Apri la prenotazione",
              }),
            });
          }
        } catch { /* avviso al titolare non critico */ }
      }
    } catch { /* email non critica */ }

    // Disponibilità verso i portali (Channex) senza aspettare un browser aperto: la struttura/tipologia prenotata e, con camere condivise, tutto il gruppo.
    try { const { data: rowP } = await admin.from("app_state").select("data").eq("user_id", ownerId).maybeSingle(); const pushBlob = { ...(((rowP?.data ?? {}) as Record<string, string>) || {}) }; const pushBk = mBookings.some((b) => b.id === booking.id) ? mBookings : [...mBookings, booking]; pushBlob[DATA_KEY] = JSON.stringify({ ...data, roomTypes: mRoomTypes, units: mUnits, bookings: pushBk, rateOverrides: merged.rateOverrides }); await schedulePoolPush(pushBlob, [{ structureId: booking.structureId, roomTypeId: booking.roomTypeId }]); } catch { /* non critico */ }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
