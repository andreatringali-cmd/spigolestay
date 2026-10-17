// Pagamento di un PREVENTIVO (link pubblico /preventivo): parte server.
//  - lettura fidata del preventivo (RPC get_quote, per codice) e convalida contro i dati VERI del proprietario (struttura, conto Stripe, prezzo minimo);
//  - registrazione IDEMPOTENTE della prenotazione dopo il pagamento: la chiamano sia il ritorno pagina (/api/stripe/quote/confirm) sia il webhook Stripe,
//    cosi' l'incasso si registra anche se l'ospite chiude il browser.
// I metadata della sessione Stripe li scrive solo il server (route /api/stripe/quote): qui non ci si fida di nulla che arrivi dal browser.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOrgDataParts, mergeOwnerData, isRealIsoDate } from "./server-booking-guard";
import { POOL_KEY, parsePool, inPool, poolOccupancy } from "./inventory-pool";
import { schedulePoolPush } from "@/lib/pool-push";
import { cityTaxOfBookingRaw, groupRowBalances } from "./booking";
import { ymdRome } from "./dates-rome";
import { parseNotifPrefs } from "./notifPrefs";
import { notifyBookingLines } from "./booking-notify";
import { internalFetch } from "@/lib/server-auth";
import { allocateProportional, refundPaymentIntent } from "./pay-excess";
import { onlinePaymentPatch } from "./online-pay";
import type { Structure } from "./types";

const DATA_KEY = "spigolestay:data:v1";
const PREV_KEY = "spigolestay:preventivi";
type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

// ───────────────────────── preventivo come dato fidato ─────────────────────────

/** Il preventivo salvato dal gestore (tabella quotes) cosi' come lo restituisce la funzione get_quote. Tutti i campi sono opzionali: dati vecchi e nuovi convivono. */
export interface QuoteData {
  s?: string; ci?: string; co?: string; ad?: number; ch?: number;
  rooms?: { name?: string; amount?: number; qty?: number; rt?: string }[];
  /** righe camera strutturate (preferite a `rooms`): tipologia, quantita', prezzo a notte */
  lines?: { rt?: string; qty?: number; price?: number }[];
  tot?: number; dep?: number; gn?: string; ge?: string; oe?: string; sid?: string; rt?: string; ref?: string; acct?: string; uid?: string;
  extras?: { id?: string; name?: string; price?: number; per?: string }[];
  /** facoltativi: politica di cancellazione concordata nel preventivo */
  refundable?: boolean; cancelDays?: number; ratePlan?: string;
}

/** Legge il preventivo dal codice breve con la funzione get_quote (l'unica via: la tabella non e' leggibile in blocco). null = non trovato / non leggibile. */
export async function loadQuoteByCode(admin: SupabaseClient, code: string): Promise<QuoteData | null> {
  const c = String(code || "").trim();
  if (!/^[a-z0-9]{4,32}$/i.test(c)) return null;
  try {
    const { data, error } = await (admin as unknown as { rpc: (fn: string, a: Json) => PromiseLike<{ data: unknown; error: unknown }> }).rpc("get_quote", { p_code: c });
    if (error || !data || typeof data !== "object") return null;
    return (Array.isArray(data) ? data[0] : data) as QuoteData;
  } catch { return null; }
}

export interface QuoteSplit { acc: number; tax: number; rest: number }

/**
 * Scompone il totale del preventivo (che include tassa di soggiorno, parcheggio, colazione) in: soggiorno (`acc`), tassa (`tax`, la ricalcola l'app dalle regole
 * del Comune) e `rest` (parcheggio/colazione/altro). La prenotazione salva SOLO il soggiorno come `total` e i servizi come extra: la tassa la aggiunge poi l'app
 * (bookingGrandTotal), quindi scriverla anche nel totale la contava due volte.
 */
export function splitQuoteTotal(st: Structure | undefined, p: { tot: number; accKnown?: number; adults: number; children: number; ci: string; co: string }): QuoteSplit {
  const tot = r2(Math.max(0, p.tot));
  const taxOf = (acc: number) => r2(cityTaxOfBookingRaw(st, { adults: p.adults, children: p.children, checkIn: p.ci, checkOut: p.co, total: acc }));
  if (p.accKnown !== undefined && p.accKnown > 0) {
    const acc = r2(Math.min(tot, p.accKnown));
    const tax = taxOf(acc);
    const rest = r2(Math.max(0, tot - acc - tax));
    return { acc, tax, rest: rest < 0.5 ? 0 : rest };
  }
  // Soggiorno non noto: acc + tassa(acc) = tot (nessun altro servizio). La tassa dipende poco da acc: poche iterazioni bastano.
  let acc = tot;
  for (let i = 0; i < 6; i++) acc = r2(Math.max(0, tot - taxOf(acc)));
  return { acc, tax: taxOf(acc), rest: 0 };
}

/** Righe camera del preventivo: tipologia, quantita', importo del soggiorno di quella riga (€). Senza dettaglio: una sola riga (la prima tipologia). */
export interface QuoteRoomRow { rt: string; qty: number; amount?: number }
export function quoteRoomRows(q: QuoteData, roomTypes: Json[], sid: string, nights: number): QuoteRoomRow[] {
  const known = (id: string) => roomTypes.some((x) => s(x.id) === id && s(x.structureId) === sid);
  const out: QuoteRoomRow[] = [];
  if (Array.isArray(q.lines) && q.lines.length) {
    for (const l of q.lines.slice(0, 10)) {
      const rt = s(l.rt);
      const qty = Math.min(10, Math.max(1, Math.round(n(l.qty) || 1)));
      if (known(rt)) out.push({ rt, qty, amount: nights > 0 && n(l.price) > 0 ? r2(n(l.price) * nights * qty) : undefined });
    }
    if (out.length) return out;
  }
  if (Array.isArray(q.rooms) && q.rooms.length > 1) {
    // Righe con il solo nome della tipologia: si risale all'id dalla struttura (la prima riga e' q.rt).
    q.rooms.slice(0, 10).forEach((r, i) => {
      const byName = roomTypes.find((x) => s(x.structureId) === sid && s(x.name).trim().toLowerCase() === s(r.name).trim().toLowerCase());
      const rt = s(r.rt) || (byName ? s(byName.id) : i === 0 ? s(q.rt) : "");
      if (known(rt)) out.push({ rt, qty: Math.min(10, Math.max(1, Math.round(n(r.qty) || 1))), amount: n(r.amount) > 0 ? r2(n(r.amount)) : undefined });
    });
    if (out.length) return out;
  }
  const rt = s(q.rt);
  const single = Array.isArray(q.rooms) && q.rooms.length === 1 ? n(q.rooms[0].amount) : 0;
  return known(rt) ? [{ rt, qty: 1, amount: single > 0 ? r2(single) : undefined }] : [];
}

/** Extra del catalogo del preventivo scelti dall'ospite (indici nell'elenco): prezzo calcolato QUI (a notte / a persona / a soggiorno), mai dal browser. */
export function pickQuoteExtras(catalog: QuoteData["extras"], picked: unknown, nights: number, persons: number): { name: string; price: number }[] {
  const out: { name: string; price: number }[] = [];
  if (!Array.isArray(catalog) || !Array.isArray(picked)) return out;
  const seen = new Set<number>();
  for (const raw of picked.slice(0, 20)) {
    const i = Number(raw);
    if (!Number.isInteger(i) || i < 0 || i >= catalog.length || seen.has(i)) continue;
    seen.add(i);
    const e = catalog[i];
    const base = n(e.price);
    if (!(base >= 0) || !s(e.name).trim()) continue;
    const price = e.per === "night" || e.per === "day" ? base * Math.max(1, nights) : e.per === "person" ? base * Math.max(1, persons) : base;
    out.push({ name: s(e.name).replace(/[|:]/g, " ").trim().slice(0, 60), price: r2(price) });
  }
  return out;
}

/** "Nome:12.5|Nome2:8" -> [{name, price}] (formato compatto dei metadata Stripe). */
export function parseExtMeta(raw: string | undefined): { name: string; price: number }[] {
  return String(raw || "").split("|").map((seg) => seg.trim()).filter(Boolean).map((seg) => {
    const idx = seg.lastIndexOf(":");
    if (idx < 0) return null;
    const price = Number(seg.slice(idx + 1));
    const name = seg.slice(0, idx).trim();
    return name && Number.isFinite(price) && price >= 0 ? { name, price } : null;
  }).filter((x): x is { name: string; price: number } => !!x);
}

/** Righe camera nei metadata: "rtId~qty~importoInCentesimi|…" (importo 0 = non noto). */
export const encodeRoomRows = (rows: QuoteRoomRow[]): string => rows.map((r) => `${r.rt}~${r.qty}~${Math.round((r.amount ?? 0) * 100)}`).join("|").slice(0, 480);
export function decodeRoomRows(raw: string | undefined): QuoteRoomRow[] {
  const out: QuoteRoomRow[] = [];
  for (const seg of String(raw || "").split("|").filter(Boolean)) {
    const [rt, q, a] = seg.split("~");
    const cents = Number(a);
    if (rt) out.push({ rt, qty: Math.min(10, Math.max(1, Math.round(Number(q) || 1))), amount: cents > 0 ? cents / 100 : undefined });
  }
  return out;
}

// ───────────────────────── registrazione dopo il pagamento ─────────────────────────

export type RegisterQuoteResult =
  | { ok: true; already?: boolean; duplicateRefunded?: boolean; bookingIds: string[] }
  | { ok: false; status: number; error: string; message?: string };

interface SessionLike {
  id: string; payment_status?: string | null; amount_total?: number | null; metadata?: Record<string, string> | null;
  payment_intent?: string | { id?: string; transfer_data?: { destination?: string | { id?: string } | null } | null } | null;
}

/**
 * Crea (una sola volta) la prenotazione di un preventivo pagato. Idempotente: per sessione (retry del webhook / ritorno pagina) e per preventivo
 * (un secondo pagamento dello stesso preventivo NON crea un'altra prenotazione: la seconda sessione viene rimborsata).
 */
export async function registerQuotePayment(admin: SupabaseClient, session: SessionLike, opts: { origin: string; accountId?: string }): Promise<RegisterQuoteResult> {
  const m = (session.metadata ?? {}) as Record<string, string>;
  if (session.payment_status !== "paid") return { ok: false, status: 402, error: "not_paid" };
  // Solo sessioni nate da un preventivo (kind "quote"): niente "book"/"chatpay" ne' pagamenti del saldo al check-in (portano bookingId).
  if (m.kind !== "quote" || m.bookingId) return { ok: false, status: 400, error: "not_a_quote" };
  // L'importo incassato deve coincidere con quello deciso dal server (dep): niente piu' controllo "se presente".
  const paidCents = Math.max(0, Math.round(session.amount_total ?? 0));
  if (m.dep === undefined || m.dep === "" || Math.abs(Math.round((Number(m.dep) || 0) * 100) - paidCents) > 1 || paidCents <= 0) {
    return { ok: false, status: 400, error: "amount_mismatch" };
  }
  const sid = (m.sid || "").trim(), ci = (m.ci || "").trim(), co = (m.co || "").trim();
  if (!sid || !isRealIsoDate(ci) || !isRealIsoDate(co) || co <= ci) return { ok: false, status: 400, error: "missing_metadata" };
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? "");
  const dest = typeof session.payment_intent === "object" && session.payment_intent ? session.payment_intent.transfer_data?.destination : undefined;
  const acct = opts.accountId || (typeof dest === "string" ? dest : (dest as { id?: string } | null | undefined)?.id || "");

  // Proprietario: dall'id utente scritto dal server; per sessioni vecchie, dall'email.
  let ownerId = (m.uid || "").trim();
  if (!ownerId && m.oe) {
    const { data: prof } = await admin.from("profiles").select("user_id, email").eq("email", m.oe.trim().toLowerCase()).maybeSingle();
    ownerId = (prof?.user_id as string) || "";
  }
  if (!ownerId) return { ok: false, status: 404, error: "owner_not_found" };

  const qkey = (m.qc || m.ref || "").trim();
  const extId = qkey ? `quote:${ownerId}:${qkey}` : `stripe:${session.id}`;

  const attempt = async (): Promise<RegisterQuoteResult | "conflict"> => {
    const { data: row, error: readErr } = await admin.from("app_state").select("data, rev").eq("user_id", ownerId).maybeSingle();
    if (readErr) return { ok: false, status: 500, error: "read_error" };
    const blob = ((row?.data ?? {}) as Record<string, string>) || {};
    const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;
    let data: Json = {};
    try { data = JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { data = {}; }
    const bookings = arr(data.bookings);
    const guests = arr(data.guests);

    const orgParts = await loadOrgDataParts(admin, ownerId);
    const merged = mergeOwnerData([data, ...orgParts]);
    const allBookings = merged.bookings;

    // Idempotenza per sessione: gia' registrata (anche in un'organizzazione).
    const mine = allBookings.filter((b) => s(b.stripeSessionId) === session.id || arr(b.paidSessions).some((x) => String(x) === session.id) || s(b.extId) === `stripe:${session.id}`);
    if (mine.length) return { ok: true, already: true, bookingIds: mine.map((b) => s(b.id)) };
    // Idempotenza per preventivo: stesso preventivo gia' pagato con un'altra sessione = secondo pagamento, da restituire.
    const dup = allBookings.find((b) => s(b.extId) === extId || s(b.extId).startsWith(extId + "#"));
    if (dup) {
      const rf = await refundPaymentIntent(pi, paidCents, "quote-dup-" + session.id);
      if (!rf.ok) return { ok: false, status: 500, error: "duplicate_refund_failed", message: rf.error };
      return { ok: true, already: true, duplicateRefunded: true, bookingIds: [s(dup.id)] };
    }

    const st = merged.structures.find((x) => s(x.id) === sid);
    if (!st) return { ok: false, status: 404, error: "structure_not_found" };

    const adults = Math.max(1, parseInt(m.ad || "1", 10) || 1);
    const children = Math.max(0, parseInt(m.ch || "0", 10) || 0);
    const tot = r2(Number(m.tot) || 0);
    const guestExtras = parseExtMeta(m.ext);
    const rowsMeta = decodeRoomRows(m.rl);
    const base: QuoteRoomRow[] = rowsMeta.length ? rowsMeta : [{ rt: (m.rt || "").trim(), qty: 1 }];
    const rows: QuoteRoomRow[] = [];
    for (const r of base) for (let i = 0; i < r.qty && rows.length < 10; i++) rows.push({ rt: r.rt, qty: 1, amount: r.amount !== undefined ? r2(r.amount / r.qty) : undefined });
    if (!rows.length) return { ok: false, status: 400, error: "missing_metadata" };

    // Soggiorno / tassa / servizi: il totale del preventivo include la tassa e i servizi, che nella prenotazione stanno altrove (extra) o li calcola l'app.
    const accKnown = rows.every((r) => r.amount !== undefined && r.amount > 0) ? r2(rows.reduce((a, r) => a + (r.amount ?? 0), 0)) : (Number(m.acc) > 0 ? Number(m.acc) : undefined);
    const split = splitQuoteTotal(st as unknown as Structure, { tot: tot > 0 ? tot : paidCents / 100, accKnown, adults, children, ci, co });
    const rowAcc = rows.map((r) => (r.amount !== undefined ? r.amount : r2(split.acc / rows.length)));
    // Scarto di arrotondamento sulla prima riga: le righe sommano esattamente il soggiorno.
    if (rows.length > 1) rowAcc[0] = r2(rowAcc[0] + (split.acc - rowAcc.reduce((a, v) => a + v, 0)));
    const restExtra = Number(m.xr) > 0 ? Number(m.xr) : split.rest;

    // Disponibilita': prima unita' LIBERA della tipologia; se non ce n'e' si registra comunque (e' gia' pagato) ma SENZA camera e con avviso, mai sopra un'altra prenotazione.
    const pool = parsePool(blob[POOL_KEY]);
    const poolOcc = inPool(pool, sid) ? poolOccupancy(pool, merged.roomTypes as never, merged.units as never, allBookings as never) : null;
    const taken = new Set<string>();
    const unitFor = (rt: string): string | null => {
      if (poolOcc && !poolOcc.canSell(rt, ci, co)) return null;
      const u = merged.units.find((x) => s(x.roomTypeId) === rt && !x.outOfService && !taken.has(s(x.id)) && !allBookings.some((b) => s(b.unitId) === s(x.id) && s(b.status) !== "cancelled" && s(b.checkIn) < co && s(b.checkOut) > ci));
      if (u) taken.add(s(u.id));
      return u ? s(u.id) : null;
    };

    // Ospite: riusa quello con la stessa email, altrimenti ne crea uno.
    const gn = (m.gn || "").trim(), ge = (m.ge || "").trim();
    let guestId = "";
    if (ge) { const g = guests.find((x) => s(x.email).toLowerCase() === ge.toLowerCase()); if (g) guestId = s(g.id); }
    let newGuest: Json | null = null;
    if (!guestId) {
      guestId = globalThis.crypto?.randomUUID?.() ?? `g_${Date.now()}`;
      newGuest = { id: guestId, fullName: gn || ge || "Ospite", firstName: gn.split(" ")[0] || undefined, lastName: gn.split(" ").slice(1).join(" ") || undefined, email: ge || undefined };
    }

    // Codici leggibili XEN-AAAA-nnnn progressivi (come il gestionale).
    const year = ci.slice(0, 4), prefix = `XEN-${year}-`;
    let maxN = allBookings.reduce((mx, b) => (s(b.code).startsWith(prefix) ? Math.max(mx, Number(s(b.code).slice(prefix.length)) || 0) : mx), 0);

    const groupId = globalThis.crypto?.randomUUID?.() ?? `grp_${Date.now()}`;
    const nowMs = Date.now();
    const refundable = m.rf === "1";
    const cancelDays = Math.max(0, parseInt(m.cd || "0", 10) || 0);
    const created: Json[] = rows.map((r, i) => {
      const unitId = unitFor(r.rt);
      // Adulti ripartiti fra le camere (almeno uno ciascuna); i bambini restano sulla prima.
      const ad = Math.max(1, Math.floor(adults / rows.length) + (i < adults % rows.length ? 1 : 0));
      const code = `${prefix}${String(++maxN).padStart(4, "0")}`;
      const exs: { name: string; price: number }[] = i === 0 ? [...guestExtras, ...(restExtra > 0 ? [{ name: "Servizi del preventivo (parcheggio / colazione)", price: r2(restExtra) }] : [])] : [];
      return {
        id: globalThis.crypto?.randomUUID?.() ?? `b_${nowMs}_${i}`,
        groupId, structureId: sid, roomTypeId: r.rt, unitId, guestId,
        channel: "direct", status: "confirmed", checkIn: ci, checkOut: co, bookedOn: ymdRome(nowMs),
        adults: ad, children: i === 0 ? children : 0,
        total: rowAcc[i], cleaningFee: 0,
        ...(exs.length ? { extras: exs } : {}),
        paid: 0, code, updatedAt: nowMs,
        extId: i === 0 ? extId : `${extId}#${i + 1}`,
        source: "manuale",
        refundable: refundable || undefined, cancelDays: cancelDays || undefined,
        note: (m.ref ? `Da preventivo n. ${m.ref} · pagato online` : "Pagato online") + (unitId ? "" : " · ⚠ nessuna camera libera in quelle date: da assegnare a mano") + (m.rfu === "1" ? " · ⚠ link di pagamento vecchio senza politica di cancellazione: registrata come non rimborsabile, verifica il preventivo" : ""),
      } as Json;
    });

    // Incasso: ripartito in proporzione al residuo di ogni camera (con la quota di tassa del gruppo): ogni camera porta la sua quota dell'acconto.
    const bals = groupRowBalances(st as unknown as Structure, created.map((x) => ({ id: s(x.id), adults: n(x.adults), children: n(x.children), checkIn: ci, checkOut: co, total: n(x.total), cleaningFee: 0, extras: arr(x.extras) as { price?: number }[], paid: 0 })));
    const alloc = allocateProportional(created.map((x) => Math.round((bals.find((b) => b.id === s(x.id))?.balance ?? 0) * 100)), paidCents);
    // Quanto avanza oltre i residui (importi arrotondati diversamente) resta sulla prima camera: l'incasso e' comunque tutto registrato.
    alloc[0] += paidCents - alloc.reduce((t, v) => t + v, 0);
    created.forEach((x, i) => {
      const part = alloc[i] / 100;
      if (!(part > 0)) { created[i] = { ...x, paidSessions: [session.id] }; return; }
      created[i] = {
        ...x, paid: part, depositPaid: true, paymentMethod: "carta", paidSessions: [session.id],
        ...onlinePaymentPatch({ paid: 0, stripePaymentIntent: pi }, part, nowMs),
        stripeSessionId: session.id, stripeAccountId: acct || undefined,
        // Una sola camera: il payment intent e' il suo pagamento principale. Piu' camere: ognuna cita il PI con la SUA quota (rimborso proporzionale, mai l'intero pagamento).
        ...(pi ? (created.length === 1 ? { stripePaymentIntent: pi } : { stripeExtraPayments: [{ pi, amount: part }] }) : {}),
      };
    });

    if (newGuest) { guests.push(newGuest); data.guests = guests; }
    data.bookings = [...bookings, ...created];
    blob[DATA_KEY] = JSON.stringify(data);
    // Segna il preventivo come confermato nella copia sul server (best-effort).
    try {
      const prev = JSON.parse(blob[PREV_KEY] || "[]") as (Json & { number?: number; status?: string })[];
      if (Array.isArray(prev) && m.ref) {
        const target = prev.find((p) => String(p.number) === m.ref.split("/")[0]);
        if (target) { target.status = "confermato"; blob[PREV_KEY] = JSON.stringify(prev); }
      }
    } catch { /* niente */ }

    // Scrittura con service role (bypassa RLS) con lock sul rev; su conflitto si rilegge tutto e si riprova (idempotenza ricontrollata).
    let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", ownerId);
    if (rev !== null) write = write.eq("rev", rev);
    const { data: updated, error: wErr } = await write.select("rev");
    if (wErr) return { ok: false, status: 500, error: "write_error", message: wErr.message };
    if (!updated || updated.length === 0) return "conflict";

    // Dopo la scrittura: ledger fee di piattaforma, avviso al titolare, disponibilita' verso i portali (tutti best-effort).
    try {
      const feeTotal = parseInt(m.fee_total || "0", 10) || 0;
      if (feeTotal > 0 && (m.source || "direct") === "direct") {
        await admin.from("platform_fees").upsert({
          tenant_id: ownerId, org_id: null, structure_id: sid, booking_id: s(created[0].id), source: "direct",
          currency: "EUR", gross_amount_cents: paidCents,
          fee_base_cents: parseInt(m.fee_base || "0", 10) || 0, fee_vat_cents: parseInt(m.fee_vat || "0", 10) || 0, fee_total_cents: feeTotal,
          stripe_account_id: acct || null, stripe_payment_intent_id: pi || null, status: "collected", collected_at: new Date().toISOString(),
        }, { onConflict: "stripe_payment_intent_id" });
      }
    } catch { /* il ledger fee non deve mai bloccare la conferma prenotazione */ }
    try {
      const hostEmail = s(st.email);
      if (hostEmail && parseNotifPrefs(blob["spigolestay:notifs"]).newBooking) {
        const first = created[0];
        const rtName = s(merged.roomTypes.find((x) => s(x.id) === s(first.roomTypeId))?.name);
        const lines = notifyBookingLines({
          ev: "newBooking",
          booking: { code: s(first.code), checkIn: ci, checkOut: co, adults, children, total: created.reduce((a, x) => a + n(x.total), 0), paid: paidCents / 100, note: s(first.note) },
          guest: { fullName: gn || ge, email: ge }, structureName: s(st.name), roomLabel: rows.length > 1 ? `${rows.length} camere` : rtName, channelLabel: "Diretto",
        });
        const logo = s(st.logo);
        await internalFetch(`${opts.origin}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "notify", to: hostEmail, event: "newBooking", subject: `Nuova prenotazione ${s(first.code)} (preventivo pagato) · ${s(st.name)}`,
            brand: { name: s(st.name), logoUrl: /^https?:\/\//i.test(logo) ? logo : undefined, color: s(st.photoColor) || undefined, address: [s(st.address), s(st.streetNumber), s(st.city)].filter(Boolean).join(" ") || undefined },
            channelLabel: "Diretto", text: lines.join("\n"),
            ctaUrl: `${opts.origin}/prenotazioni?b=${encodeURIComponent(s(first.id))}`, ctaLabel: "Apri la prenotazione",
          }),
        });
      }
    } catch { /* avviso non critico */ }
    try {
      const pushBlob = { ...blob, [DATA_KEY]: JSON.stringify({ ...data, structures: merged.structures, roomTypes: merged.roomTypes, units: merged.units, bookings: [...allBookings, ...created], rateOverrides: merged.rateOverrides }) };
      await schedulePoolPush(pushBlob, created.map((x) => ({ structureId: sid, roomTypeId: s(x.roomTypeId) })));
    } catch { /* non critico */ }
    return { ok: true, bookingIds: created.map((x) => s(x.id)) };
  };

  for (let i = 0; i < 3; i++) {
    const r = await attempt();
    if (r !== "conflict") return r;
  }
  return { ok: false, status: 409, error: "write_conflict" };
}
