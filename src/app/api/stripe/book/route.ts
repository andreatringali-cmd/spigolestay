import Stripe from "stripe";
import { loadOwnerStructureData, stayFloor, hasFreeUnit, clientIp, findOwnerStructure, loadOwnerRatePlans, isRealIsoDate, stripeAccountChargesEnabled } from "@/lib/server-booking-guard";
import { rateLimited } from "@/lib/server-auth";
import { siteOrigin } from "@/lib/server-auth";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { estimatedStripeFeeCents } from "@/lib/payments/fee";
import { fmtDMY } from "@/lib/dates";
import { guestLangOf } from "@/lib/guest-lang";
import { resolvePlanPolicy, depositCentsFor } from "@/lib/plan-policy";
import { payLabels, asPayLang } from "@/lib/pay-labels";
import { rootRoomTypeId, loadOwnerPromos, resolveBookPromo, floorWithPromo, priceBookExtras, extrasTotalOf, encodeOrderExtras } from "@/lib/book-order";
import { ymdRome } from "@/lib/dates-rome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe accetta al massimo 500 caratteri per valore di metadata e 40 per chiave: ogni valore e' tagliato qui.
const mv = (v: unknown, n = 480) => String(v ?? "").slice(0, n);

// Crea la sessione di pagamento (caparra o totale) sul conto Stripe della struttura.
// Se la struttura non ha Stripe collegato (o attivo) o l'importo e' 0 → { payment: false } (il client
// registra la prenotazione senza pagamento online, "paga in struttura").
// IMPORTANTE: piano, percentuale di caparra, rimborsabilita' e giorni di cancellazione si ricalcolano QUI dai piani del proprietario:
// il browser dell'ospite manda solo il nome del piano, mai la politica (prima si poteva pagare 0,50 € dichiarando "rimborsabile").
// Stesso criterio per extra e codice promo: il browser manda id/quantita' degli extra e il codice, prezzo e validita' si verificano qui.
// IMPORTO ADDEBITATO = % del piano su (soggiorno al netto dello sconto + extra). La tassa di soggiorno NON si addebita online: si paga in struttura
// (la pagina /prenota lo dice e non la include nel "da pagare ora").
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  try {
    // Limite di frequenza PRIMA di qualsiasi lettura: anche le richieste "senza pagamento" costano letture del database.
    if (rateLimited("book:" + clientIp(req), 15, 60_000)) return NextResponse.json({ ok: false, error: "troppe_richieste" }, { status: 429 });
    const b = await req.json().catch(() => ({}));
    const slug = String(b?.slug || "").trim();
    const clientSid = String(b?.s || b?.structureId || "").trim();
    const rt = String(b?.rt || "").trim();
    const ci = String(b?.ci || "").trim(), co = String(b?.co || "").trim();
    const adults = Math.max(1, parseInt(String(b?.adults ?? "1"), 10) || 1);
    const children = Math.max(0, parseInt(String(b?.children ?? "0"), 10) || 0);
    const childAges = Array.isArray(b?.childAges) ? (b.childAges as unknown[]).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x >= 0 && x < 120).slice(0, 12) : [];
    const total = Math.min(1_000_000, Math.max(0, Math.round((Number(b?.total) || 0) * 100) / 100)); // soggiorno al netto dello sconto promo; ai centesimi, non all'euro intero
    const promoCode = String(b?.promoCode || "").trim().slice(0, 40);
    const deposit = Math.max(0, Math.round((Number(b?.deposit) || 0) * 100) / 100);
    const note = mv(b?.note);
    const code = mv(b?.code, 40);
    const planName = mv(b?.planName, 60);
    const g = (b?.guest ?? {}) as Record<string, string>;
    const token = String(b?.token || "").slice(0, 80) || (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
    if (!slug || !rt || !ci || !co) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
    // Stessa regola di /api/public-booking: un indirizzo non valido si rifiuta PRIMA del pagamento (dopo l'incasso la registrazione non deve mai dipendere dall'email).
    const guestEmail = String(g.email || "").trim();
    if (guestEmail && !(guestEmail.length <= 120 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(guestEmail))) return NextResponse.json({ ok: false, error: "bad_email" }, { status: 400 });
    const nNights = Math.round((Date.parse(co) - Date.parse(ci)) / 86400000);
    if (!isRealIsoDate(ci) || !isRealIsoDate(co) || !(nNights >= 1 && nNights <= 60)) return NextResponse.json({ ok: false, error: "bad_dates" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: site } = await admin.from("public_sites").select("user_id, structure_id").eq("slug", slug).maybeSingle();
    const ownerId = (site?.user_id as string) || "";
    if (!ownerId) return NextResponse.json({ ok: false, error: "site_not_found" }, { status: 404 });
    // La struttura e' quella del sito (public_sites.structure_id), non quella dichiarata dal browser: altrimenti si pagherebbe sul conto di una e si prenoterebbe l'altra.
    const siteSid = String((site as { structure_id?: string }).structure_id || "");
    const sid = siteSid || clientSid;
    if (!sid) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
    if (siteSid && clientSid && clientSid !== siteSid) return NextResponse.json({ ok: false, error: "structure_mismatch" }, { status: 400 });

    const st = await findOwnerStructure(admin, ownerId, sid);
    const acct = st && typeof st.stripeAccount === "string" ? st.stripeAccount : "";

    // Politica del piano scelto: dai piani del proprietario, mai dal client.
    const nightsN = nNights;
    const policy = resolvePlanPolicy(await loadOwnerRatePlans(admin, ownerId), planName, { roomTypeId: rt, checkIn: ci, nights: nightsN, structureId: sid, cancelPolicy: st?.cancelPolicy }); // la cancellazione la decide la scheda struttura
    // Senza nome di piano (widget semplici) vale l'acconto della struttura (30% se non impostato), non rimborsabile.
    if (!planName.trim()) policy.depositPct = typeof st?.depositPct === "number" ? Math.min(100, Math.max(0, Math.round(st.depositPct))) : 30;
    // Extra scelti (validati sul catalogo del proprietario) e codice promo (validato sulle sue promo): servono a importo, floor e prenotazione.
    const orderExtras = priceBookExtras(b?.extras, st, { checkIn: ci, checkOut: co, adults });
    const extrasEur = extrasTotalOf(orderExtras);
    const promo = promoCode ? resolveBookPromo(await loadOwnerPromos(admin, ownerId), promoCode, { structureId: sid, checkIn: ci, today: ymdRome(Date.now()) }) : null;
    const baseEur = Math.round((total + extrasEur) * 100) / 100; // quanto si puo' incassare online: soggiorno + extra (senza tassa di soggiorno)
    const amountCents = depositCentsFor(baseEur, deposit, policy.depositPct); // 0 = nessun anticipo previsto dal piano
    if (!key || !acct || amountCents <= 0) return NextResponse.json({ ok: true, payment: false, token, policy: { refundable: policy.refundable, cancelDays: policy.cancelDays } });

    // Controlli sul server prima di far pagare: i numeri arrivano dal browser dell'ospite e non sono affidabili.
    const od = await loadOwnerStructureData(admin, ownerId, sid);
    if (od) {
      if (!od.roomTypes.some((x) => (x as { id?: string; structureId?: string }).id === rt && (x as { structureId?: string }).structureId === sid)) return NextResponse.json({ ok: false, error: "room_type_not_found" }, { status: 400 });
      const floor = stayFloor(od, rt, ci, co);
      // total e' gia' al netto del codice promo: la soglia scende solo per una promo VALIDATA (e al massimo del 50%), un codice inventato non cambia nulla.
      if (floor !== null && total < floorWithPromo(floor, promo?.pct ?? 0)) return NextResponse.json({ ok: false, error: "price_mismatch" }, { status: 400 });
      // Le tariffe derivate usano le camere fisiche della tipologia madre: la disponibilita' si verifica sulla radice.
      if (hasFreeUnit(od, rootRoomTypeId(od.roomTypes as unknown as Record<string, unknown>[], rt), ci, co) === false) return NextResponse.json({ ok: false, error: "no_availability" }, { status: 409 });
    }

    const stripe = new Stripe(key);
    // Conto della struttura non ancora abilitato a incassare: niente pagina di pagamento che poi fallisce, si ripiega su "paga in struttura".
    if ((await stripeAccountChargesEnabled(stripe as never, acct)) === false) return NextResponse.json({ ok: true, payment: false, token, reason: "stripe_not_active", policy: { refundable: policy.refundable, cancelDays: policy.cancelDays } });

    const lang = asPayLang(b?.lang) ?? guestLangOf({ language: g.language, country: g.country, phone: g.phone });
    const L = payLabels(lang);

    // Metadata: portano l'intera prenotazione fino alla conferma post-pagamento. Tutti i valori sono scelti QUI (politica, importo).
    const meta: Record<string, string> = {
      kind: "book", slug, s: mv(sid), rt: mv(rt), ci, co, ad: String(adults), ch: String(children),
      ca: childAges.join(",").slice(0, 120),
      tot: String(total), dep: String(amountCents / 100), note, code, token,
      rpn: mv(policy.planName || planName, 60), ref: policy.refundable ? "1" : "0", cd: String(policy.cancelDays),
      gn: mv(`${g.firstName || ""} ${g.lastName || ""}`.trim(), 200), gf: mv(g.firstName, 100), gl: mv(g.lastName, 100), ge: mv(g.email, 200), gp: mv(g.phone, 60), gc: mv(g.country, 60), lg: lang,
      ...(orderExtras.length ? { ex: encodeOrderExtras(orderExtras) } : {}), ...(promo ? { pc: promo.code } : {}),
    };
    const origin = siteOrigin(req);
    // "(caparra)" solo se e' un acconto PARZIALE; se si paga l'intero importo non e' una caparra.
    const isPartial = amountCents < Math.round(baseEur * 100);
    const label = `${st?.name || L.stay} · ${fmtDMY(ci)} → ${fmtDMY(co)}${isPartial ? ` (${L.deposit})` : ""}`.slice(0, 250);
    const success = `${origin}/prenota?site=${encodeURIComponent(slug)}&s=${encodeURIComponent(sid)}&paid=1&session_id={CHECKOUT_SESSION_ID}`;
    const cancel = `${origin}/prenota?site=${encodeURIComponent(slug)}&s=${encodeURIComponent(sid)}&canceled=1`;
    // DESTINATION CHARGE: addebito sulla piattaforma, fondi trasferiti alla struttura
    // (i direct charges non sono piu' supportati per piattaforme nuove con account Express).
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // Solo carta: i metodi asincroni (bonifico, SEPA...) segnerebbero la sessione "non pagata" al ritorno e la prenotazione non verrebbe registrata.
      payment_method_types: ["card"],
      locale: lang,
      line_items: [{ price_data: { currency: "eur", unit_amount: amountCents, product_data: { name: label } }, quantity: 1 }],
      customer_email: g.email && String(g.email).includes("@") ? String(g.email) : undefined,
      metadata: meta,
      payment_intent_data: { metadata: meta, transfer_data: { destination: acct, amount: Math.max(0, amountCents - estimatedStripeFeeCents(amountCents)) }, on_behalf_of: acct },
      success_url: success, cancel_url: cancel,
    });
    return NextResponse.json({ ok: true, payment: true, url: session.url, token });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "stripe_error" }, { status: 500 });
  }
}
