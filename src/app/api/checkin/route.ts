import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { findBookingStore, mutateStore } from "@/lib/manage-booking";
import { cityTaxOf } from "@/lib/booking";
import type { Structure } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" ? v : 0);

// GET: dati per rendere la pagina di check-in a un ospite ANONIMO (dal link email).
export async function GET(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  try {
    const u = new URL(req.url);
    const slug = (u.searchParams.get("slug") || "").trim();
    const bid = (u.searchParams.get("b") || "").trim();
    if (!slug || !bid) return NextResponse.json({ error: "missing_params" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const store = await findBookingStore(admin, slug, bid);
    if (!store) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const b = store.booking as Json;
    const st = (store.structure ?? {}) as Json;
    const rt = (store.roomType ?? {}) as Json;
    const g = (store.guest ?? {}) as Json;
    const unit = arr(store.data.units).find((x) => (x as { id?: string }).id === s(b.unitId)) as Json | undefined;
    // Tassa di soggiorno calcolata sul server (dipende dalla configurazione struttura).
    const nightsTot = (() => { try { return Math.max(1, Math.round((Date.parse(s(b.checkOut)) - Date.parse(s(b.checkIn))) / 86400000)); } catch { return 1; } })();
    const cityTax = cityTaxOf(st as unknown as Structure, n(b.adults) || 1, nightsTot, n(b.total), b.cityTaxExempt === true);

    return NextResponse.json({
      ok: true,
      booking: {
        id: s(b.id), code: s(b.code) || s(b.id).slice(0, 8).toUpperCase(), status: s(b.status),
        checkIn: s(b.checkIn), checkOut: s(b.checkOut), adults: n(b.adults) || 1, children: n(b.children),
        total: n(b.total), paid: n(b.paid), cleaningFee: n(b.cleaningFee), cityTax,
        cityTaxExempt: b.cityTaxExempt === true,
        webCheckin: b.webCheckin === true, arrivalTime: s(b.arrivalTime), guestRequests: s(b.guestRequests),
        extras: arr(b.extras), extraGuests: arr(b.extraGuests),
        docPhotoFront: s(b.docPhotoFront) || null, docPhotoBack: s(b.docPhotoBack) || null, signature: s(b.signature) || null,
        invoiceRequest: (b.invoiceRequest as Json) || null,
      },
      guest: { firstName: s(g.firstName) || s(g.fullName).split(" ")[0] || "", lastName: s(g.lastName) || s(g.fullName).split(" ").slice(1).join(" ") || "", email: s(g.email), phone: s(g.phone), sex: s(g.sex), birthDate: s(g.birthDate), birthPlace: s(g.birthPlace), citizenship: s(g.citizenship) || s(g.country), docType: s(g.docType), docNumber: s(g.docNumber), docPlace: s(g.docPlace) },
      roomType: { name: s(rt.name) },
      unit: unit ? { name: s(unit.name), accessInfo: s(unit.accessInfo) } : null,
      structure: {
        name: s(st.name), color: s(st.photoColor), phone: s(st.phone), email: s(st.email),
        address: s(st.address), streetNumber: s(st.streetNumber), city: s(st.city),
        checkInFrom: s(st.checkInFrom), checkOutBy: s(st.checkOutBy), accessInfo: s(st.accessInfo),
        currency: s(st.currency) || "€", cityTax: (st.cityTax as Json) || null,
        stripeAccount: s(st.stripeAccount), stripeChargesEnabled: st.stripeChargesEnabled === true,
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
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim();
    const bid = String(body?.b || "").trim();
    if (!slug || !bid) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });

    const doc = (body?.doc ?? {}) as DocIn;
    if (!s(doc.firstName).trim() || !s(doc.lastName).trim()) return NextResponse.json({ ok: false, error: "missing_name" }, { status: 400 });
    const arrival = String(body?.arrival || "").slice(0, 40);
    const guestRequests = String(body?.guestRequests || "").slice(0, 800);
    const extraGuests = arr(body?.extraGuests).map((e) => ({
      firstName: s((e as Json).firstName).slice(0, 80), lastName: s((e as Json).lastName).slice(0, 80),
      birthDate: s((e as Json).birthDate).slice(0, 20), birthPlace: s((e as Json).birthPlace).slice(0, 120),
      citizenship: s((e as Json).citizenship).slice(0, 80), docType: s((e as Json).docType).slice(0, 60), docNumber: s((e as Json).docNumber).slice(0, 60),
    })).filter((e) => e.firstName && e.lastName);
    const docPhotoFront = typeof body?.docPhotoFront === "string" ? body.docPhotoFront : undefined;
    const docPhotoBack = typeof body?.docPhotoBack === "string" ? body.docPhotoBack : undefined;
    const signature = typeof body?.signature === "string" ? body.signature : undefined;
    const invoiceRequest = (body?.invoiceRequest ?? undefined) as Json | undefined;
    const chosenExtras = arr(body?.chosenExtras).map((e) => ({ name: s((e as Json).name).slice(0, 120), price: n((e as Json).price) })).filter((e) => e.name);

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const store = await findBookingStore(admin, slug, bid);
    if (!store) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    const guestId = s((store.booking as Json).guestId);

    const wrote = await mutateStore(admin, store, (data, idx) => {
      const bookings = arr(data.bookings);
      if (idx < 0 || idx >= bookings.length) return false;
      const bk = bookings[idx] as Json;
      // Merge extra (upsell) senza duplicati.
      const baseExtras = arr(bk.extras) as { name: string; price: number }[];
      const merged = [...baseExtras];
      for (const c of chosenExtras) if (!merged.some((x) => x.name === c.name)) merged.push(c);
      const primaryGuest = { firstName: s(doc.firstName).trim(), lastName: s(doc.lastName).trim(), sex: (doc.sex || undefined) as string | undefined, birthDate: doc.birthDate, birthPlace: doc.birthPlace, citizenship: doc.citizenship, docType: doc.docType, docNumber: s(doc.docNumber).trim(), docPlace: doc.docPlace };
      bookings[idx] = {
        ...bk, webCheckin: true, arrivalTime: arrival || bk.arrivalTime, guestRequests: guestRequests || undefined,
        extraGuests, docPhotoFront: docPhotoFront ?? bk.docPhotoFront, docPhotoBack: docPhotoBack ?? bk.docPhotoBack,
        signature: signature ?? bk.signature, invoiceRequest: invoiceRequest ?? bk.invoiceRequest, extras: merged, primaryGuest,
      };
      data.bookings = bookings;
      // Aggiorna l'anagrafica ospite.
      const guests = arr(data.guests);
      const gi = guests.findIndex((x) => (x as { id?: string }).id === guestId);
      if (gi >= 0) {
        guests[gi] = { ...(guests[gi] as Json), firstName: s(doc.firstName).trim(), lastName: s(doc.lastName).trim(), fullName: `${s(doc.firstName)} ${s(doc.lastName)}`.trim(), sex: (doc.sex || undefined), birthDate: doc.birthDate, birthPlace: doc.birthPlace, citizenship: doc.citizenship, docType: doc.docType, docNumber: s(doc.docNumber).trim(), docPlace: doc.docPlace };
        data.guests = guests;
      }
      return true;
    });
    if (!wrote) return NextResponse.json({ ok: false, error: "write_conflict" }, { status: 409 });

    // Avvisa il gestore (best-effort).
    try {
      const st = (store.structure ?? {}) as Json;
      const rt = (store.roomType ?? {}) as Json;
      const b = store.booking as Json;
      const hostEmail = s(st.email);
      if (hostEmail) {
        const origin = req.headers.get("origin") || new URL(req.url).origin;
        const guests = [{ firstName: s(doc.firstName), lastName: s(doc.lastName), sex: doc.sex, birthDate: doc.birthDate, birthPlace: doc.birthPlace, citizenship: doc.citizenship, docType: doc.docType, docNumber: doc.docNumber, docPlace: doc.docPlace }, ...extraGuests];
        await fetch(`${origin}/api/email`, {
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
