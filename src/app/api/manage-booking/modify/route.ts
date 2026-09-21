import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { findBookingStore, writeBookingPatch } from "@/lib/manage-booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const s = (v: unknown) => (typeof v === "string" ? v : "");
const isISO = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Richiesta di MODIFICA date/ospiti da parte dell'ospite. Non applica automaticamente
// (servirebbe verifica disponibilità + riprezzo + differenza di pagamento): registra la
// richiesta sulla prenotazione e avvisa il gestore, che la conferma dal gestionale.
export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim();
    const bid = String(body?.b || "").trim();
    const ci = isISO(body?.ci) ? String(body.ci) : undefined;
    const co = isISO(body?.co) ? String(body.co) : undefined;
    const message = String(body?.message || "").slice(0, 500);
    if (!slug || !bid) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
    if (!ci && !co && !message) return NextResponse.json({ ok: false, error: "empty_request" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const store = await findBookingStore(admin, slug, bid);
    if (!store) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    const b = store.booking as Record<string, unknown>;
    if (s(b.status) === "cancelled") return NextResponse.json({ ok: false, error: "cancelled" }, { status: 400 });

    const now = new Date().toISOString();
    const wrote = await writeBookingPatch(admin, store, { changeRequest: { at: now, ci, co, message: message || undefined } });
    if (!wrote) return NextResponse.json({ ok: false, error: "write_conflict" }, { status: 409 });

    // Avvisa il gestore.
    const st = (store.structure ?? {}) as Record<string, unknown>;
    const g = (store.guest ?? {}) as Record<string, unknown>;
    const code = s(b.code) || s(b.id).slice(0, 8).toUpperCase();
    const hostEmail = s(st.email);
    if (hostEmail) {
      const origin = req.headers.get("origin") || new URL(req.url).origin;
      try {
        await fetch(`${origin}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "quote", to: hostEmail, subject: `Richiesta modifica ${code} · ${s(st.name)}`,
            text: `L'ospite ha richiesto una modifica alla prenotazione ${code}.\n\nAttuale: ${s(b.checkIn)} → ${s(b.checkOut)}\n${ci || co ? `Nuove date richieste: ${ci || s(b.checkIn)} → ${co || s(b.checkOut)}\n` : ""}${message ? `Messaggio: ${message}\n` : ""}\nOspite: ${`${s(g.firstName)} ${s(g.lastName)}`.trim() || s(g.email)}\n\nApri il gestionale per confermare o proporre un'alternativa.`,
          }),
        });
      } catch { /* email non critica */ }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
