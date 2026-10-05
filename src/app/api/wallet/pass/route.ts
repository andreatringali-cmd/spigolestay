import { NextResponse } from "next/server";
import { siteOrigin } from "@/lib/server-auth";
import { createClient } from "@supabase/supabase-js";
import { findBookingStore, findBookingStoreById } from "@/lib/manage-booking";
import { buildWalletSaveUrl, googleWalletConfigured } from "@/lib/googleWallet";
import { uploadPublicAsset, dataUrlToBytes } from "@/lib/email-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v : "");

// GET: genera il link "Aggiungi a Google Wallet" per il pass di soggiorno dell'ospite.
// Pubblica come /api/checkin: raggiunta dal link della prenotazione (?site=&b=), NESSUNA
// autenticazione. Se le env GOOGLE_WALLET_* non sono ancora impostate -> { ok:false,
// reason:"not_configured" } con HTTP 200 (mai 500): è uno stato atteso finché l'utente
// non attiva la funzione, stesso pattern di ai_not_configured/alloggiati_soap_not_configured.
export async function GET(req: Request) {
  if (!googleWalletConfigured()) return NextResponse.json({ ok: false, reason: "not_configured" });

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ ok: false, reason: "not_configured" });

  try {
    const u = new URL(req.url);
    const slug = (u.searchParams.get("slug") || "").trim();
    const bid = (u.searchParams.get("b") || "").trim();
    if (!bid) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    // Con lo slug è più veloce; senza slug (link interni/email vecchie) si cerca per id.
    let store = slug ? await findBookingStore(admin, slug, bid) : null;
    if (!store) store = await findBookingStoreById(admin, bid);
    if (!store) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    const b = store.booking as Json;
    const st = (store.structure ?? {}) as Json;
    const rt = (store.roomType ?? {}) as Json;
    const g = (store.guest ?? {}) as Json;
    const unit = arr(store.data.units).find((x) => (x as { id?: string }).id === s(b.unitId)) as Json | undefined;

    const origin = siteOrigin(req);
    const guestName = s(g.firstName) || s(g.fullName).split(" ")[0] || "";
    const address = [s(st.address), s(st.streetNumber)].filter(Boolean).join(" ") + (s(st.city) ? `, ${s(st.city)}` : "");

    // Il logo della struttura è salvato come data URL (caricato dalla pagina Strutture): Google
    // Wallet, come le email, richiede un URL pubblico https. Lo carichiamo su storage pubblico
    // (stesso helper riusato dalle email) e riusiamo l'URL: hash-based, quindi upload ripetuti
    // della stessa immagine riusano lo stesso file invece di duplicarlo.
    let logoUrl = s(st.logo).startsWith("http") ? s(st.logo) : undefined;
    if (!logoUrl && s(st.logo).startsWith("data:")) {
      const parsed = dataUrlToBytes(s(st.logo));
      if (parsed) logoUrl = (await uploadPublicAsset(parsed.bytes, parsed.ext, parsed.contentType)) ?? undefined;
    }

    const url = buildWalletSaveUrl({
      bookingId: s(b.id) || bid,
      bookingCode: s(b.code) || s(b.id).slice(0, 8).toUpperCase(),
      structureName: s(st.name),
      structureColor: s(st.photoColor),
      structureLogoUrl: logoUrl,
      roomTypeName: s(rt.name),
      unitName: unit ? s(unit.name) : "",
      checkIn: s(b.checkIn),
      checkOut: s(b.checkOut),
      accessInfo: s(unit?.accessInfo) || s(st.accessInfo) || undefined,
      address: address || undefined,
      guestName: guestName || undefined,
      originUrl: origin,
    });

    if (!url) return NextResponse.json({ ok: false, reason: "not_configured" });
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
