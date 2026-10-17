import Stripe from "stripe";
import { siteOrigin, rateLimited } from "@/lib/server-auth";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computePlatformFee, estimatedStripeFeeCents, type PaymentSource } from "@/lib/payments/fee";
import { clientIp, findOwnerStructure, loadOwnerStructureData, stayFloor, stripeAccountChargesEnabled, isRealIsoDate } from "@/lib/server-booking-guard";
import { findBookingStoreById } from "@/lib/manage-booking";
import { chatPayContext } from "@/lib/chat-pay";
import { MIN_CHARGE_CENTS, toCents } from "@/lib/chat-pay-core";
import { groupRowBalances } from "@/lib/booking";
import { loadQuoteByCode, quoteRoomRows, pickQuoteExtras, parseExtMeta, splitQuoteTotal, encodeRoomRows, type QuoteData } from "@/lib/quote-pay";
import { asPayLang, payLabels, nightsLabel, type PayLang } from "@/lib/pay-labels";
import { fmtDMY } from "@/lib/dates";
import type { Booking, Structure } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const mv = (v: unknown, max = 480) => String(v ?? "").slice(0, max);
// Testi mostrati nella pagina Stripe a nome Xenora: niente link (anti-phishing). Il testo libero resta, ma senza URL.
const noLinks = (t: string) => t.replace(/(?:https?:\/\/|www\.)\S*/gi, "").replace(/\s{2,}/g, " ").trim();

type Prepared =
  | { ok: false; status: number; error: string; message: string }
  | { ok: true; amountCents: number; acct: string; meta: Record<string, string>; label: string; desc: string; email?: string; totalEur: number; depositEur: number };
const fail = (status: number, error: string, message: string): Prepared => ({ ok: false, status, error, message });

/** Conto Stripe della struttura pronto a incassare (verifica live). Ritorna il messaggio d'errore oppure null se va bene. */
async function accountProblem(stripe: Stripe, acct: string): Promise<{ error: string; message: string } | null> {
  if (!acct) return { error: "stripe_not_connected", message: "Il pagamento online non è attivo per questa struttura: contatta direttamente la struttura." };
  if ((await stripeAccountChargesEnabled(stripe as never, acct)) === false) return { error: "stripe_not_active", message: "Il conto di pagamento della struttura non è ancora attivo: contatta direttamente la struttura." };
  return null;
}

// ── Preventivo (link pubblico /preventivo) ──────────────────────────────────────────────
// Importo, struttura, conto Stripe e date si ricavano dal SERVER: dal preventivo salvato (codice breve → RPC get_quote) oppure, per i vecchi link
// con il payload nell'indirizzo (?q=), da quanto dichiara il browser ma CONVALIDATO contro i dati veri del proprietario. Il conto Stripe è sempre
// quello della struttura (mai quello scritto dal client): senza conto la sessione non si crea (prima finiva sul conto piattaforma, a nome Xenora).
async function prepareQuote(admin: SupabaseClient, stripe: Stripe, body: Json, lang: PayLang | undefined): Promise<Prepared> {
  const code = s(body.code).trim();
  const legacy = ((body.metadata && typeof body.metadata === "object") ? body.metadata : {}) as Json;
  let q: QuoteData;
  let legacyAmountCents = 0;
  let legacyPolicyUnknown = false;
  if (code) {
    const loaded = await loadQuoteByCode(admin, code);
    if (!loaded) return fail(404, "quote_not_found", "Preventivo non trovato: chiedi alla struttura un nuovo link.");
    q = loaded;
  } else {
    // Vecchio link: dichiarazioni del browser. Servono solo come proposta; sotto vengono verificate.
    q = {
      sid: mv(legacy.sid, 80), rt: mv(legacy.rt, 80), ci: mv(legacy.ci, 10), co: mv(legacy.co, 10),
      ad: Number(legacy.ad) || 1, ch: Number(legacy.ch) || 0, tot: Number(legacy.tot) || 0,
      gn: mv(legacy.gn, 200), ge: mv(legacy.ge, 200), ref: mv(legacy.ref, 40), uid: mv(legacy.uid, 80),
    };
    // Politica di cancellazione: se il vecchio link la porta (refundable/rf, cancelDays/cd) vale quella; altrimenti NON si inventa. Resta "non rimborsabile"
    // (scelta prudente per il gestore: un rimborso automatico non dovuto non si recupera) ma la prenotazione porta un avviso, cosi' il gestore verifica il PDF del preventivo.
    const rfRaw = legacy.refundable ?? legacy.rf;
    if (rfRaw === undefined || rfRaw === null || rfRaw === "") legacyPolicyUnknown = true;
    else q.refundable = rfRaw === true || rfRaw === 1 || rfRaw === "1" || rfRaw === "true";
    q.cancelDays = Math.max(0, Math.round(Number(legacy.cancelDays ?? legacy.cd) || 0));
    // Link senza `uid` ma con l'email del gestore (`oe`): il proprietario si ricava dall'email come faceva la vecchia registrazione (profilo con quell'email).
    if (!q.uid && s(legacy.oe).trim()) {
      const { data: prof } = await admin.from("profiles").select("user_id, email").eq("email", s(legacy.oe).trim().toLowerCase()).maybeSingle();
      q.uid = s((prof as { user_id?: string } | null)?.user_id);
    }
    legacyAmountCents = Math.round((Number(body.amount) || 0) * 100);
    if (legacyAmountCents <= 0) return fail(400, "invalid_amount", "Importo non valido.");
  }
  const uid = s(q.uid).trim(), sid = s(q.sid).trim(), ci = s(q.ci).trim(), co = s(q.co).trim();
  if (!uid || !sid) return fail(400, "invalid_quote", "Preventivo incompleto: chiedi alla struttura un nuovo link.");
  if (!isRealIsoDate(ci) || !isRealIsoDate(co) || co <= ci) return fail(400, "bad_dates", "Date del preventivo non valide.");
  const nights = Math.round((Date.parse(co) - Date.parse(ci)) / 86400000);
  if (nights > 60) return fail(400, "bad_dates", "Date del preventivo non valide.");

  // La struttura deve appartenere al proprietario del preventivo, e i dati di pagamento sono i SUOI.
  const st = await findOwnerStructure(admin, uid, sid);
  if (!st) return fail(400, "invalid_structure", "Preventivo non valido: chiedi alla struttura un nuovo link.");
  const acct = s(st.stripeAccount);
  const prob = await accountProblem(stripe, acct);
  if (prob) return fail(409, prob.error, prob.message);

  const od = await loadOwnerStructureData(admin, uid, sid);
  if (!od) return fail(400, "invalid_structure", "Preventivo non valido: chiedi alla struttura un nuovo link.");
  const rows = quoteRoomRows(q, od.roomTypes as unknown as Json[], sid, nights);
  if (!rows.length) return fail(400, "invalid_quote", "Tipologia di camera del preventivo non trovata: chiedi alla struttura un nuovo link.");
  const tot = Math.round(n(q.tot) * 100) / 100;
  if (!(tot > 0)) return fail(400, "invalid_quote", "Il preventivo non ha un importo.");

  // Prezzo minimo: metà del listino del soggiorno (come per il sito): un preventivo "regalato" non passa.
  const adults = Math.max(1, Math.min(30, Math.round(Number(body.adults) || n(q.ad) || 1)));
  const childrenAsked = body.children !== undefined ? Number(body.children) : n(q.ch);
  const children = Math.max(0, Math.min(30, Math.round(Number.isFinite(childrenAsked) ? childrenAsked : 0)));
  const split = splitQuoteTotal(st as unknown as Structure, { tot, accKnown: rows.every((r) => r.amount !== undefined) ? rows.reduce((a, r) => a + (r.amount ?? 0), 0) : undefined, adults, children, ci, co });
  let floor = 0, floorKnown = false;
  for (const r of rows) { const f = stayFloor(od, r.rt, ci, co); if (f !== null) { floor += f * r.qty; floorKnown = true; } }
  if (floorKnown && split.acc < floor) return fail(400, "price_mismatch", "Importo del preventivo non valido: chiedi alla struttura un nuovo link.");

  // Preventivo gia' pagato: niente secondo pagamento (e quindi niente seconda prenotazione).
  const qkey = code || s(q.ref).trim();
  if (qkey && od.bookings.some((b) => s(b.extId) === `quote:${uid}:${qkey}`)) return fail(409, "already_confirmed", "Questo preventivo risulta già confermato e pagato.");

  // Importo da pagare ADESSO.
  let stayCents: number;
  const persons = adults + children;
  const picked = code ? pickQuoteExtras(q.extras, body.extras, nights, persons) : parseExtMeta(mv(legacy.ext));
  const extrasCents = Math.round(picked.reduce((a, e) => a + e.price, 0) * 100);
  if (code) {
    // Acconto del preventivo; 0 = nessun pagamento online (si paga in struttura): NON si fa pagare l'intero.
    const dep = Math.round(n(q.dep) * 100) / 100;
    if (!(dep > 0)) return fail(409, "no_online_payment", "Questo preventivo non prevede un pagamento online: l'importo si salda direttamente in struttura.");
    stayCents = Math.min(Math.round(dep * 100), Math.round(tot * 100));
  } else {
    // Vecchio link: l'importo lo propone il browser. Limite: non oltre totale + extra (il minimo vale per tutti, sotto).
    const maxCents = Math.round(tot * 100) + extrasCents + 1;
    if (legacyAmountCents > maxCents) return fail(400, "invalid_amount", "Importo non valido.");
    stayCents = Math.max(0, legacyAmountCents - extrasCents);
  }
  const amountCents = stayCents + extrasCents;
  // Acconto minimo: un decimo del prezzo minimo del soggiorno (5% del listino), al massimo 50 €. Il preventivo salvato lo scrive chiunque abbia accesso alla tabella:
  // senza questo limite un acconto di 0,50 € farebbe risultare "confermata" una prenotazione da 300 € nel gestionale altrui. Soglia bassa di proposito:
  // un preventivo scontato o con acconto del 10-15% (listino 1000, preventivo 800, acconto 10% = 80 €) e' legittimo.
  if (floorKnown && amountCents < Math.min(Math.round(floor * 10), 5000)) return fail(400, "invalid_amount", "Importo non valido: chiedi alla struttura un nuovo link.");
  if (amountCents < MIN_CHARGE_CENTS) return fail(400, "amount_too_low", "Importo troppo basso per il pagamento online.");

  const L = payLabels(lang);
  const name = s(st.name) || L.stay;
  const label = `${name} · ${fmtDMY(ci)} → ${fmtDMY(co)}`.slice(0, 250);
  const desc = [nightsLabel(nights, lang), qkey ? `${L.ref} ${qkey}` : ""].filter(Boolean).join(" · ");
  const extMeta = picked.map((e) => `${e.name}:${e.price}`).join("|").slice(0, 450);
  const meta: Record<string, string> = {
    uid, sid, rt: rows[0].rt, ci, co, ad: String(adults), ch: String(children),
    tot: String(tot), acc: String(split.acc), xr: String(split.rest), dep: String(amountCents / 100), rl: encodeRoomRows(rows),
    ref: mv(q.ref, 40), qc: mv(code, 40), gn: mv(q.gn, 200), ge: mv(q.ge, 200), ext: extMeta,
    rf: q.refundable === true ? "1" : "0", cd: String(Math.max(0, Math.round(n(q.cancelDays)))),
    ...(legacyPolicyUnknown ? { rfu: "1" } : {}),
  };
  return { ok: true, amountCents, acct, meta, label, desc, email: s(q.ge) || undefined, totalEur: tot, depositEur: amountCents / 100 };
}

// ── Saldo al check-in (pagina /checkin) ──────────────────────────────────────────────────
// Prenotazione, struttura, conto Stripe e residuo si ricavano dal server a partire dall'id prenotazione: il browser non sceglie né conto né importo massimo.
async function prepareBalance(admin: SupabaseClient, stripe: Stripe, body: Json, bookingId: string, group: boolean): Promise<Prepared> {
  const store = await findBookingStoreById(admin, bookingId);
  if (!store) return fail(404, "booking_not_found", "Prenotazione non trovata.");
  const bk = store.booking as unknown as Booking;
  if (bk.status === "cancelled" || bk.status === "no_show") return fail(409, "cancelled", "La prenotazione risulta annullata: non è possibile pagare online.");
  const st = (store.structure ?? undefined) as unknown as Structure | undefined;
  const acct = s((store.structure as Json | null)?.stripeAccount);
  const prob = await accountProblem(stripe, acct);
  if (prob) return fail(409, prob.error, prob.message);
  const all = (Array.isArray(store.data.bookings) ? store.data.bookings : []) as unknown as Booking[];
  let balanceCents: number;
  const members = group && bk.groupId ? all.filter((x) => x.groupId === bk.groupId && x.status !== "cancelled" && x.status !== "no_show" && x.channel !== "blocked") : [];
  if (members.length > 1) {
    const bals = groupRowBalances(st, members.map((x) => ({ id: x.id, adults: x.adults, children: x.children, childAges: x.childAges, checkIn: x.checkIn, checkOut: x.checkOut, total: x.total, cityTaxExempt: x.cityTaxExempt, cleaningFee: x.cleaningFee, extras: x.extras, paid: x.paid, cityTaxPaid: x.cityTaxPaid, cityTaxInPaid: (x as { cityTaxInPaid?: boolean }).cityTaxInPaid })));
    balanceCents = bals.reduce((a, r) => a + Math.round(r.balance * 100), 0);
  } else {
    balanceCents = chatPayContext(bk, st, false, all).balanceCents;
  }
  if (balanceCents <= 0) return fail(409, "already_paid", "Per questa prenotazione non risulta nulla da pagare.");
  const askedCents = toCents(Number(body.amount) || 0);
  // Mai oltre il residuo vero (il browser non sceglie quanto far pagare in più; può solo chiedere meno).
  const amountCents = askedCents > 0 ? Math.min(askedCents, balanceCents) : balanceCents;
  if (amountCents < MIN_CHARGE_CENTS) return fail(400, "amount_too_low", "Importo troppo basso per il pagamento online.");
  const label = noLinks(s(body.label)).slice(0, 250) || `${s(store.structure?.name) || "Prenotazione"}`;
  const desc = noLinks(s(body.desc)).slice(0, 300);
  const meta: Record<string, string> = { bookingId, bid: bookingId, sid: mv(bk.structureId, 80), ...(members.length > 1 ? { group: "1" } : {}) };
  const email = s((store.guest as Json | null)?.email);
  return { ok: true, amountCents, acct, meta, label, desc, email: email.includes("@") ? email : undefined, totalEur: balanceCents / 100, depositEur: amountCents / 100 };
}

async function prepare(req: Request, body: Json): Promise<{ stripe: Stripe; prep: Prepared; admin: SupabaseClient } | NextResponse> {
  const key = process.env.STRIPE_SECRET_KEY;
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  if (!sbUrl || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  // Limite di frequenza: la route è anonima e ogni chiamata legge il database e interroga Stripe.
  if (rateLimited("quote:" + clientIp(req), 20, 60_000)) return NextResponse.json({ error: "troppe_richieste", message: "Troppe richieste: riprova fra un minuto." }, { status: 429 });
  const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const stripe = new Stripe(key);
  const lang = asPayLang(body.locale) ?? asPayLang(body.lang);
  const meta = (body.metadata && typeof body.metadata === "object" ? body.metadata : {}) as Json;
  const bookingId = s(meta.bookingId).trim();
  const prep = bookingId ? await prepareBalance(admin, stripe, body, bookingId, s(meta.group) === "1") : await prepareQuote(admin, stripe, body, lang);
  return { stripe, prep, admin };
}

// Stato del pagamento di un preventivo (per la pagina pubblica): la pagina nasconde "Paga" se non è pagabile.
//   GET /api/stripe/quote?code=<codice>  →  { payable, reason?, message?, deposit?, total? }
export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = (u.searchParams.get("code") || "").trim();
  if (!code) return NextResponse.json({ payable: false, reason: "missing_code" }, { status: 400 });
  const r = await prepare(req, { code });
  if (r instanceof NextResponse) return r;
  if (!r.prep.ok) return NextResponse.json({ payable: false, reason: r.prep.error, message: r.prep.message }, { status: 200 });
  return NextResponse.json({ payable: true, deposit: r.prep.depositEur, total: r.prep.totalEur });
}

// Crea una sessione di Checkout una tantum per il pagamento (o acconto) di un preventivo, oppure per il saldo di una prenotazione dal check-in.
export async function POST(req: Request) {
  try {
    const body = ((await req.json().catch(() => ({}))) ?? {}) as Json;
    const origin = siteOrigin(req);
    // Gli URL di ritorno devono restare sul nostro sito (niente open redirect / phishing dopo il pagamento): stessa origine del sito o di questa richiesta.
    const okOrigins = new Set([origin]);
    try { okOrigins.add(new URL(req.url).origin); } catch { /* url non valido */ }
    const sameSite = (u: string) => { try { return okOrigins.has(new URL(u).origin); } catch { return false; } };
    const success = String(body.successUrl || `${origin}/preventivo`);
    const cancel = String(body.cancelUrl || `${origin}/preventivo`);
    if (!sameSite(success) || !sameSite(cancel)) return NextResponse.json({ error: "invalid_return_url" }, { status: 400 });

    const r = await prepare(req, body);
    if (r instanceof NextResponse) return r;
    const { stripe, prep } = r;
    if (!prep.ok) return NextResponse.json({ error: prep.error, message: prep.message }, { status: prep.status });

    const email = typeof body.email === "string" && body.email.includes("@") ? body.email : prep.email;
    // Lingua della pagina di pagamento Stripe: quella scelta dall'ospite (it/en/fr/de/es), altrimenti la decide Stripe dal browser.
    const locale = asPayLang(body.locale) ?? asPayLang(body.lang);
    // Fee di piattaforma Xenora (Stripe Connect): SOLO su prenotazioni dirette e solo se il tenant ha attivato la fee ed ha P.IVA.
    // La paga la struttura, mai l'ospite → nessuna voce nel checkout. Questa route crea solo pagamenti DIRETTI.
    const source: PaymentSource = "direct";
    const fee = computePlatformFee(prep.amountCents, source, {
      bps: Number.isFinite(Number(body.feeBps)) ? Number(body.feeBps) : undefined,
      vatRate: Number.isFinite(Number(body.feeVatRate)) ? Number(body.feeVatRate) : undefined,
      enabled: body.feeEnabled !== false,
      hasVatNumber: body.hasVatNumber === true,
    });
    const meta: Record<string, string> = { ...prep.meta };
    if (fee.applies) {
      meta.fee_base = String(fee.baseCents);
      meta.fee_vat = String(fee.vatCents);
      meta.fee_total = String(fee.totalCents);
    }

    // kind e source per ULTIMI: il chiamante non può sovrascriverli.
    const finalMeta = { ...meta, kind: "quote", source };
    // Destination charge: addebito sulla PIATTAFORMA, fondi trasferiti all'account della struttura (transfer_data.destination), sempre quello
    // della struttura ricavato dal server. La struttura sostiene la commissione Stripe: le trasferiamo il NETTO (lordo − stima Stripe − eventuale fee Xenora).
    const transferAmount = Math.max(0, prep.amountCents - estimatedStripeFeeCents(prep.amountCents) - (fee.applies ? fee.totalCents : 0));
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price_data: { currency: "eur", unit_amount: prep.amountCents, product_data: { name: prep.label, ...(prep.desc ? { description: prep.desc } : {}) } }, quantity: 1 }],
      metadata: finalMeta,
      payment_intent_data: { metadata: finalMeta, transfer_data: { destination: prep.acct, amount: transferAmount }, on_behalf_of: prep.acct },
      customer_email: email,
      ...(locale ? { locale } : {}),
      success_url: success.includes("{CHECKOUT_SESSION_ID}") ? success : `${success}${success.includes("?") ? "&" : "?"}paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
