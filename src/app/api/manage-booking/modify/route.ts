import { NextResponse } from "next/server";
import { siteOrigin } from "@/lib/server-auth";
import { internalFetch } from "@/lib/server-auth";
import { createClient } from "@supabase/supabase-js";
import { rateLimited } from "@/lib/server-auth";
import { clientIp } from "@/lib/server-booking-guard";
import { findBookingStore, writeBookingPatch } from "@/lib/manage-booking";
import { fmtDMY } from "@/lib/dates";
import { ymdRome } from "@/lib/dates-rome";
import { isRealIsoDate } from "@/lib/server-booking-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const s = (v: unknown) => (typeof v === "string" ? v : "");

// Richiesta di MODIFICA date/ospiti da parte dell'ospite. Non applica automaticamente
// (servirebbe verifica disponibilità + riprezzo + differenza di pagamento): registra la
// richiesta sulla prenotazione e avvisa il gestore, che la conferma dal gestionale.
export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  if (rateLimited("mbm:" + clientIp(req), 20, 60_000)) return NextResponse.json({ ok: false, error: "troppe_richieste" }, { status: 429 });
  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim();
    const bid = String(body?.b || "").trim();
    const rawCi = body?.ci === undefined || body?.ci === null || body?.ci === "" ? undefined : body.ci;
    const rawCo = body?.co === undefined || body?.co === null || body?.co === "" ? undefined : body.co;
    // Se l'ospite indica una data, deve essere una data vera (2026-02-30 no): prima una data non valida veniva ignorata in silenzio.
    if ((rawCi !== undefined && !isRealIsoDate(rawCi)) || (rawCo !== undefined && !isRealIsoDate(rawCo))) return NextResponse.json({ ok: false, error: "bad_dates", message: "Date non valide." }, { status: 400 });
    const ci = rawCi as string | undefined;
    const co = rawCo as string | undefined;
    const message = String(body?.message || "").slice(0, 500);
    if (!slug || !bid) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
    if (!ci && !co && !message) return NextResponse.json({ ok: false, error: "empty_request" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const store = await findBookingStore(admin, slug, bid);
    if (!store) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    const b = store.booking as Record<string, unknown>;
    if (s(b.status) === "cancelled") return NextResponse.json({ ok: false, error: "cancelled" }, { status: 400 });
    // Le nuove date devono essere coerenti: partenza dopo l'arrivo, arrivo non nel passato (oggi in Italia), soggiorno al massimo 60 notti.
    if (ci || co) {
      const effCi = ci || s(b.checkIn), effCo = co || s(b.checkOut);
      const nights = Math.round((Date.parse(effCo) - Date.parse(effCi)) / 86400000);
      if (!isRealIsoDate(effCi) || !isRealIsoDate(effCo) || !(nights >= 1) || nights > 60) return NextResponse.json({ ok: false, error: "bad_dates", message: "La partenza deve essere dopo l'arrivo." }, { status: 400 });
      // "Non nel passato" vale solo per un arrivo INDICATO dall'ospite: chi allunga un soggiorno in corso cambia solo la partenza e l'arrivo originale e' gia' passato.
      if (ci && ci < ymdRome(Date.now())) return NextResponse.json({ ok: false, error: "bad_dates", message: "La data di arrivo non può essere nel passato." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const wrote = await writeBookingPatch(admin, store, { changeRequest: { at: now, ci, co, message: message || undefined }, updatedAt: Date.now() });
    if (!wrote) return NextResponse.json({ ok: false, error: "write_conflict" }, { status: 409 });

    // Avvisa il gestore.
    const st = (store.structure ?? {}) as Record<string, unknown>;
    const g = (store.guest ?? {}) as Record<string, unknown>;
    const code = s(b.code) || s(b.id).slice(0, 8).toUpperCase();
    const hostEmail = s(st.email);
    if (hostEmail) {
      const origin = siteOrigin(req);
      try {
        await internalFetch(`${origin}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "notify", event: "modified", to: hostEmail, subject: `Richiesta modifica ${code} · ${s(st.name)}`,
            brand: { name: s(st.name), logoUrl: /^https?:\/\//i.test(s(st.logo)) ? s(st.logo) : undefined, color: s(st.photoColor) || undefined }, structureName: s(st.name), channelLabel: "Diretto",
            ctaUrl: `${origin}/prenotazioni?b=${encodeURIComponent(s(b.id))}`, ctaLabel: "Apri la prenotazione",
            text: `L'ospite ha richiesto una modifica alla prenotazione ${code}.\n\nAttuale: ${fmtDMY(s(b.checkIn))} → ${fmtDMY(s(b.checkOut))}\n${ci || co ? `Nuove date richieste: ${fmtDMY(ci || s(b.checkIn))} → ${fmtDMY(co || s(b.checkOut))}\n` : ""}${message ? `Messaggio: ${message}\n` : ""}\nOspite: ${`${s(g.firstName)} ${s(g.lastName)}`.trim() || s(g.email)}\n\nApri il gestionale per confermare o proporre un'alternativa.`,
          }),
        });
      } catch { /* email non critica */ }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
