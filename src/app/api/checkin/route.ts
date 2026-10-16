import { NextResponse } from "next/server";
import { siteOrigin } from "@/lib/server-auth";
import { internalFetch } from "@/lib/server-auth";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { findBookingStore, findBookingStoreById, mutateStore } from "@/lib/manage-booking";
import { cityTaxOf, cityTaxOfGroup, cityTaxShareOf, groupRowBalances, type GroupTaxRow } from "@/lib/booking";
import type { Structure } from "@/lib/types";
import { guestLangOrNull } from "@/lib/guest-lang";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { clientIp } from "@/lib/server-booking-guard";
import { rateLimited } from "@/lib/server-auth";
import { PRIVATE_BUCKET } from "@/lib/media";
import { memberOrgIds, putMedia, removeMedia } from "@/lib/media-server";
import { privateRefsIn, orphanedRefs } from "@/lib/media-orphans";
import { AttachmentError, MAX_EXTRA_GUESTS, canViewStore, createAttachmentResolver, storeMediaTarget, uploadSecret } from "@/lib/checkin-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" ? v : 0);

// Chi apre il link da ospite (anonimo) NON deve ricevere foto documento né firma (nemmeno i riferimenti): la pagina le ignora comunque.
// Le vede solo chi è loggato in Xenora e appartiene a quella struttura (proprietario/collaboratore o socio dell'organizzazione).
async function viewerCanSeeDocs(req: Request, admin: SupabaseClient, store: { table: "app_state" | "org_state"; keyVal: string }): Promise<boolean> {
  if (!req.headers.get("authorization")) return false;
  try {
    const a = await authTenant(req);
    if (isResponse(a)) return false;
    const orgIds = store.table === "org_state" ? await memberOrgIds(admin, [a.userId, a.tenantId]) : [];
    return canViewStore(store, { tenantId: a.tenantId, userId: a.userId, orgIds });
  } catch { return false; }
}
const withoutDocPhotos = (o: Json): Json => { const c = { ...o }; delete c.docPhotoFront; delete c.docPhotoBack; return c; };

// GET: dati per rendere la pagina di check-in a un ospite ANONIMO (dal link email).
export async function GET(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  try {
    const u = new URL(req.url);
    const slug = (u.searchParams.get("slug") || "").trim();
    const bid = (u.searchParams.get("b") || "").trim();
    if (!bid) return NextResponse.json({ error: "missing_params" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    // Con lo slug è più veloce; senza slug (link interni/email vecchie) si cerca per id.
    let store = slug ? await findBookingStore(admin, slug, bid) : null;
    if (!store) store = await findBookingStoreById(admin, bid);
    if (!store) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const b = store.booking as Json;
    const st = (store.structure ?? {}) as Json;
    const rt = (store.roomType ?? {}) as Json;
    const g = (store.guest ?? {}) as Json;
    const seeDocs = await viewerCanSeeDocs(req, admin, store);
    const unit = arr(store.data.units).find((x) => (x as { id?: string }).id === s(b.unitId)) as Json | undefined;
    // Tassa di soggiorno calcolata sul server (dipende dalla configurazione struttura).
    const nightsTot = (() => { try { return Math.max(1, Math.round((Date.parse(s(b.checkOut)) - Date.parse(s(b.checkIn))) / 86400000)); } catch { return 1; } })();
    let cityTax = cityTaxOf(st as unknown as Structure, n(b.adults) || 1, nightsTot, n(b.total), b.cityTaxExempt === true, (n(b.adults) || 1) + n(b.children));
    let cityTaxGroup: number | undefined;
    let groupBalance: number | undefined;

    // Prenotazione di GRUPPO: se questa prenotazione ha un groupId, restituisci tutte le camere
    // del gruppo (stessa struttura/store) per un check-in unico che compila tutti gli ospiti.
    const groupId = s(b.groupId);
    let group: { b: string; code: string; roomType: string; unit: string; adults: number; children: number; webCheckin: boolean }[] = [];
    if (groupId) {
      const rts = arr(store.data.roomTypes); const uns = arr(store.data.units);
      group = arr(store.data.bookings)
        .filter((x) => s((x as Json).groupId) === groupId && s((x as Json).status) !== "cancelled" && s((x as Json).status) !== "no_show" && s((x as Json).channel) !== "blocked")
        .map((x) => { const xb = x as Json; const rt = rts.find((r) => (r as Json).id === xb.roomTypeId) as Json | undefined; const un = uns.find((u) => (u as Json).id === xb.unitId) as Json | undefined; return { b: s(xb.id), code: s(xb.code) || s(xb.id).slice(0, 8).toUpperCase(), roomType: s(rt?.name), unit: un ? s(un.name) : "", adults: n(xb.adults) || 1, children: n(xb.children), webCheckin: xb.webCheckin === true }; });
    }

    // Gruppo di più camere: la tassa si calcola UNA volta sull'insieme delle camere (come il Comune) e ogni camera ne porta la sua quota, così le quote sommano esattamente il totale.
    if (group.length > 1) {
      const rows = arr(store.data.bookings).filter((x) => s((x as Json).groupId) === groupId && s((x as Json).status) !== "cancelled" && s((x as Json).status) !== "no_show" && s((x as Json).channel) !== "blocked")
        .map((x) => { const xb = x as Json; return { id: s(xb.id), adults: n(xb.adults), children: n(xb.children), childAges: (Array.isArray(xb.childAges) ? (xb.childAges as unknown[]).filter((v): v is number => typeof v === "number") : []), checkIn: s(xb.checkIn), checkOut: s(xb.checkOut), total: n(xb.total), cityTaxExempt: xb.cityTaxExempt === true, cleaningFee: n(xb.cleaningFee), extras: arr(xb.extras) as { price?: number }[], paid: n(xb.paid) }; });
      if (rows.some((r) => r.id === s(b.id))) { cityTaxGroup = cityTaxOfGroup(st as unknown as Structure, rows); cityTax = cityTaxShareOf(st as unknown as Structure, rows, s(b.id)); groupBalance = Math.round(groupRowBalances(st as unknown as Structure, rows).reduce((a, r) => a + r.balance * 100, 0)) / 100; }
    }

    // Verifica LIVE che l'account collegato possa incassare, se il flag salvato non è ancora true:
    // così l'ospite vede "Paga ora" anche se il gestore non ha riaperto la pagina struttura dopo l'onboarding.
    let chargesEnabled = st.stripeChargesEnabled === true;
    const stripeAcct = s(st.stripeAccount);
    if (stripeAcct && !chargesEnabled && process.env.STRIPE_SECRET_KEY) {
      try { const Stripe = (await import("stripe")).default; const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); const a = await stripe.accounts.retrieve(stripeAcct); chargesEnabled = !!a.charges_enabled; } catch {}
    }

    return NextResponse.json({
      ok: true,
      group: group.length > 1 ? group : undefined,
      aiEnabled: !!process.env.ANTHROPIC_API_KEY, // l'auto-compilazione dal documento è attiva?
      booking: {
        id: s(b.id), code: s(b.code) || s(b.id).slice(0, 8).toUpperCase(), status: s(b.status),
        checkIn: s(b.checkIn), checkOut: s(b.checkOut), adults: n(b.adults) || 1, children: n(b.children),
        total: n(b.total), paid: n(b.paid), cleaningFee: n(b.cleaningFee), cityTax, cityTaxGroup, groupBalance,
        cityTaxExempt: b.cityTaxExempt === true,
        webCheckin: b.webCheckin === true, arrivalTime: s(b.arrivalTime), guestRequests: s(b.guestRequests),
        extras: arr(b.extras), extraGuests: seeDocs ? arr(b.extraGuests) : arr(b.extraGuests).map(withoutDocPhotos),
        docPhotoFront: seeDocs ? s(b.docPhotoFront) || null : null, docPhotoBack: seeDocs ? s(b.docPhotoBack) || null : null, signature: seeDocs ? s(b.signature) || null : null,
        invoiceRequest: (b.invoiceRequest as Json) || null,
      },
      guest: { firstName: s(g.firstName) || s(g.fullName).split(" ")[0] || "", lastName: s(g.lastName) || s(g.fullName).split(" ").slice(1).join(" ") || "", email: s(g.email), phone: s(g.phone), sex: s(g.sex), birthDate: s(g.birthDate), birthPlace: s(g.birthPlace), citizenship: s(g.citizenship) || s(g.country), docType: s(g.docType), docNumber: s(g.docNumber), docPlace: s(g.docPlace), docPhotoFront: seeDocs ? s(g.docPhotoFront) || null : null, docPhotoBack: seeDocs ? s(g.docPhotoBack) || null : null,
        // Lingua della pagina: scheda ospite → Paese → prefisso del telefono. null se non c'è nessun dato (allora decide il browser).
        lang: guestLangOrNull({ language: s(g.language), lang: s(g.lang), country: s(g.country), phone: s(g.phone) }) },
      // Ospite "di ritorno": ha già dati documento da un soggiorno precedente → check-in veloce.
      returning: !!(s(g.docNumber) && s(g.firstName) && (s(g.docPhotoFront) || s(b.docPhotoFront))),
      roomType: { name: s(rt.name) },
      unit: unit ? { name: s(unit.name), accessInfo: s(unit.accessInfo) } : null,
      structure: {
        name: s(st.name), color: s(st.photoColor), logo: s(st.logo), phone: s(st.phone), email: s(st.email),
        address: s(st.address), streetNumber: s(st.streetNumber), city: s(st.city),
        checkInFrom: s(st.checkInFrom), checkOutBy: s(st.checkOutBy), accessInfo: s(st.accessInfo),
        currency: s(st.currency) || "€", cityTax: (st.cityTax as Json) || null,
        stripeAccount: s(st.stripeAccount), stripeChargesEnabled: chargesEnabled,
        extras: arr(st.extras).filter((e) => (e as { active?: boolean }).active !== false).map((e) => ({ id: s((e as Json).id), name: s((e as Json).name), desc: s((e as Json).desc), price: n((e as Json).price), per: s((e as Json).per) })),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}

interface DocIn { firstName?: string; lastName?: string; sex?: string; birthDate?: string; birthPlace?: string; citizenship?: string; docType?: string; docNumber?: string; docPlace?: string }

// POST: salva il check-in online sul SERVER (store corretto: personale o condiviso).
export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  try {
    if (rateLimited("ci:" + clientIp(req), 40, 60_000)) return NextResponse.json({ ok: false, error: "troppe_richieste" }, { status: 429 });
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim();
    const bid = String(body?.b || "").trim();
    if (!bid) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });

    const doc = (body?.doc ?? {}) as DocIn;
    if (!s(doc.firstName).trim() || !s(doc.lastName).trim()) return NextResponse.json({ ok: false, error: "missing_name" }, { status: 400 });
    const arrival = String(body?.arrival || "").slice(0, 40);
    const guestRequests = String(body?.guestRequests || "").slice(0, 800);
    // Ospiti aggiuntivi: i campi anagrafici si ripuliscono subito; foto documento (riferimenti o, solo per pagine vecchie, data URI) si risolvono dopo, quando si sa dove vive la prenotazione.
    const extraRaw = arr(body?.extraGuests).slice(0, MAX_EXTRA_GUESTS).map((e) => {
      const g = e as Json;
      const pf = typeof g.docPhotoFront === "string" ? g.docPhotoFront : (typeof g.photoFront === "string" ? g.photoFront : "");
      const pb = typeof g.docPhotoBack === "string" ? g.docPhotoBack : (typeof g.photoBack === "string" ? g.photoBack : "");
      return {
        firstName: s(g.firstName).slice(0, 80), lastName: s(g.lastName).slice(0, 80), sex: s(g.sex).slice(0, 1),
        birthDate: s(g.birthDate).slice(0, 20), birthPlace: s(g.birthPlace).slice(0, 120),
        citizenship: s(g.citizenship).slice(0, 80), docType: s(g.docType).slice(0, 60), docNumber: s(g.docNumber).slice(0, 60), docPlace: s(g.docPlace).slice(0, 120),
        docPhotoFront: pf || undefined, docPhotoBack: pb || undefined,
      };
    }).filter((e) => e.firstName && e.lastName);
    const rawFront = typeof body?.docPhotoFront === "string" ? body.docPhotoFront : undefined;
    const rawBack = typeof body?.docPhotoBack === "string" ? body.docPhotoBack : undefined;
    const rawSignature = typeof body?.signature === "string" ? body.signature : undefined;
    const uploadTokens = (body?.uploads && typeof body.uploads === "object" && !Array.isArray(body.uploads) ? body.uploads : {}) as Record<string, unknown>;
    const invoiceRequest = (body?.invoiceRequest ?? undefined) as Json | undefined;
    const chosenExtras = arr(body?.chosenExtras).map((e) => ({ name: s((e as Json).name).slice(0, 120), price: n((e as Json).price) })).filter((e) => e.name);

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    let store = slug ? await findBookingStore(admin, slug, bid) : null;
    if (!store) store = await findBookingStoreById(admin, bid);
    if (!store) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    const guestId = s((store.booking as Json).guestId);

    // Allegati (foto documento, firma) -> riferimenti nel bucket PRIVATO. Il client ha già caricato i file da /api/checkin/upload e manda
    // solo i riferimenti + i token; qui si accettano solo quelli di QUESTA prenotazione (stesso proprietario, già presenti o con token valido).
    const target = storeMediaTarget(store);
    const resolver = createAttachmentResolver({
      bookingId: bid, target, tokens: uploadTokens, secret: uploadSecret(),
      allowed: privateRefsIn(store.booking, store.guest),
      put: (bytes, mime) => putMedia(admin, { bucket: PRIVATE_BUCKET, scope: target.scope, id: target.id, mime, bytes }),
    });
    let docPhotoFront: string | undefined, docPhotoBack: string | undefined, signature: string | undefined;
    const extraGuests: (typeof extraRaw[number])[] = [];
    try {
      docPhotoFront = await resolver.resolve(rawFront, "photo");
      docPhotoBack = await resolver.resolve(rawBack, "photo");
      signature = await resolver.resolve(rawSignature, "signature");
      for (const e of extraRaw) {
        extraGuests.push({ ...e, docPhotoFront: await resolver.resolve(e.docPhotoFront, "photo"), docPhotoBack: await resolver.resolve(e.docPhotoBack, "photo") });
      }
    } catch (e) {
      for (const r of resolver.uploadedNow) await removeMedia(admin, r).catch(() => false);
      if (e instanceof AttachmentError) return NextResponse.json({ ok: false, error: e.code, message: e.message }, { status: 400 });
      throw e;
    }
    let orphans: string[] = []; // file che dopo questo salvataggio non servono più a nessuno (foto sostituite)

    const wrote = await mutateStore(admin, store, (data, idx) => {
      const bookings = arr(data.bookings);
      if (idx < 0 || idx >= bookings.length) return false;
      const bk = bookings[idx] as Json;
      const guestBefore = arr(data.guests).find((x) => (x as { id?: string }).id === guestId);
      const refsBefore = privateRefsIn(bk, guestBefore);
      // Merge extra (upsell) senza duplicati.
      const baseExtras = arr(bk.extras) as { name: string; price: number }[];
      const merged = [...baseExtras];
      for (const c of chosenExtras) if (!merged.some((x) => x.name === c.name)) merged.push(c);
      const primaryGuest = { firstName: s(doc.firstName).trim(), lastName: s(doc.lastName).trim(), sex: (doc.sex || undefined) as string | undefined, birthDate: doc.birthDate, birthPlace: doc.birthPlace, citizenship: doc.citizenship, docType: doc.docType, docNumber: s(doc.docNumber).trim(), docPlace: doc.docPlace };
      bookings[idx] = {
        ...bk, webCheckin: true, arrivalTime: arrival || bk.arrivalTime, guestRequests: guestRequests || undefined,
        extraGuests, docPhotoFront: docPhotoFront ?? bk.docPhotoFront, docPhotoBack: docPhotoBack ?? bk.docPhotoBack,
        signature: signature ?? bk.signature, invoiceRequest: invoiceRequest ?? bk.invoiceRequest, extras: merged, primaryGuest,
        updatedAt: Date.now(),
      };
      data.bookings = bookings;
      // Aggiorna l'anagrafica ospite.
      const guests = arr(data.guests);
      const gi = guests.findIndex((x) => (x as { id?: string }).id === guestId);
      if (gi >= 0) {
        const gcur = guests[gi] as Json;
        guests[gi] = { ...gcur, firstName: s(doc.firstName).trim(), lastName: s(doc.lastName).trim(), fullName: `${s(doc.firstName)} ${s(doc.lastName)}`.trim(), sex: (doc.sex || undefined), birthDate: doc.birthDate, birthPlace: doc.birthPlace, citizenship: doc.citizenship, docType: doc.docType, docNumber: s(doc.docNumber).trim(), docPlace: doc.docPlace,
          // Salva le foto documento SULL'ANAGRAFICA ospite: visibili nella scheda ospite e
          // riusabili al prossimo soggiorno (check-in veloce). Solo se fornite ora.
          docPhotoFront: docPhotoFront ?? gcur.docPhotoFront, docPhotoBack: docPhotoBack ?? gcur.docPhotoBack,
          updatedAt: Date.now() };
        data.guests = guests;
      }
      orphans = orphanedRefs(refsBefore, data);
      return true;
    });
    if (!wrote) {
      for (const r of resolver.uploadedNow) await removeMedia(admin, r).catch(() => false);
      return NextResponse.json({ ok: false, error: "write_conflict" }, { status: 409 });
    }
    // Foto sostituite (o ospiti aggiuntivi tolti): via anche dallo Storage, se nessun'altra prenotazione/ospite le usa ancora.
    for (const r of orphans) await removeMedia(admin, r).catch(() => false);

    // Genera la schedina Alloggiati Web per questa struttura (best-effort): così dopo il check-in
    // online la schedina risulta subito "pronta da inviare" alla Questura (niente sync manuale).
    try {
      const { syncSchedine } = await import("@/lib/alloggiati/service");
      await syncSchedine(admin, store.ownerId, { structureId: store.sid });
    } catch { /* generazione schedina non critica */ }

    // Avvisa il gestore (best-effort).
    try {
      const st = (store.structure ?? {}) as Json;
      const rt = (store.roomType ?? {}) as Json;
      const b = store.booking as Json;
      const hostEmail = s(st.email);
      if (hostEmail) {
        const origin = siteOrigin(req);
        const guests = [{ firstName: s(doc.firstName), lastName: s(doc.lastName), sex: doc.sex, birthDate: doc.birthDate, birthPlace: doc.birthPlace, citizenship: doc.citizenship, docType: doc.docType, docNumber: doc.docNumber, docPlace: doc.docPlace }, ...extraGuests.map(({ docPhotoFront: _f, docPhotoBack: _b, ...rest }) => rest)]; // l'email non porta le foto dei documenti
        await internalFetch(`${origin}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "checkin", operatorEmail: hostEmail, arrival, guests, booking: { code: s(b.code) || s(b.id).slice(0, 8).toUpperCase(), structureName: s(st.name), structureEmail: hostEmail, color: s(st.photoColor), guestName: `${s(doc.firstName)} ${s(doc.lastName)}`.trim(), guestEmail: s((store.guest as Json)?.email), roomType: s(rt.name), checkIn: s(b.checkIn), checkOut: s(b.checkOut) } }),
        });
      }
    } catch { /* email non critica */ }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
