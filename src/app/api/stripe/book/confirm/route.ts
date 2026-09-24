import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_KEY = "spigolestay:data:v1";
type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);

// Ritorna lo stripeAccount della struttura (personale o org condivisa) collegata allo slug.
async function acctForSlug(admin: SupabaseClient, slug: string): Promise<{ ownerId: string; sid: string; acct: string } | null> {
  const { data: site } = await admin.from("public_sites").select("user_id, structure_id").eq("slug", slug).maybeSingle();
  const s0 = site as { user_id?: string; structure_id?: string } | null;
  const ownerId = (s0?.user_id as string) || ""; const sid = (s0?.structure_id as string) || "";
  if (!ownerId || !sid) return null;
  const parse = (data: unknown): Json => { const blob = ((data ?? {}) as Record<string, string>) || {}; try { return JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { return {}; } };
  // ORG condivise per prime (fonte di verità), poi personale: evita account Stripe vecchi/di test.
  const { data: ms } = await admin.from("memberships").select("org_id").eq("user_id", ownerId);
  for (const m of arr(ms)) {
    const { data: os } = await admin.from("org_state").select("data").eq("org_id", m.org_id as string).maybeSingle();
    const found = arr(parse((os as { data?: unknown } | null)?.data).structures).find((s) => s.id === sid);
    if (found?.stripeAccount) return { ownerId, sid, acct: String(found.stripeAccount) };
  }
  const { data: row } = await admin.from("app_state").select("data").eq("user_id", ownerId).maybeSingle();
  const perSt = arr(parse((row as { data?: unknown } | null)?.data).structures).find((s) => s.id === sid) || null;
  if (perSt?.stripeAccount) return { ownerId, sid, acct: String(perSt.stripeAccount) };
  return { ownerId, sid, acct: "" };
}

// Verifica che la sessione Stripe sia PAGATA, poi registra la prenotazione (via public-booking,
// idempotente sul token) che invia anche l'email di conferma.
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 503 });
  if (!sbUrl || !service) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  try {
    const b = await req.json().catch(() => ({}));
    const sessionId = String(b?.session_id || "").trim();
    const slug = String(b?.slug || "").trim();
    if (!sessionId || !slug) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const resolved = await acctForSlug(admin, slug);
    if (!resolved?.acct) return NextResponse.json({ ok: false, error: "no_stripe_account" }, { status: 400 });

    const stripe = new Stripe(key);
    // Destination charge: la sessione è sull'account PIATTAFORMA (niente stripeAccount header).
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (session.payment_status !== "paid") return NextResponse.json({ ok: false, error: "not_paid", status: session.payment_status }, { status: 402 });
    const m = (session.metadata ?? {}) as Record<string, string>;
    const pi = session.payment_intent;
    const paymentIntent = typeof pi === "string" ? pi : (pi?.id || "");

    // Registra la prenotazione tramite public-booking (scrittura idempotente + email).
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    const pb = await fetch(`${origin}/api/public-booking`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug, rt: m.rt, ci: m.ci, co: m.co,
        adults: Number(m.ad) || 1, children: Number(m.ch) || 0,
        total: Number(m.tot) || 0, deposit: Number(m.dep) || 0,
        note: m.note || "", code: m.code || "", token: m.token || sessionId,
        planName: m.rpn || "", refundable: m.ref === "1", cancelDays: Number(m.cd) || 0,
        stripePaymentIntent: paymentIntent, stripeSessionId: session.id, stripeAccountId: resolved.acct,
        guest: { firstName: (m.gn || "").split(" ")[0] || "", lastName: (m.gn || "").split(" ").slice(1).join(" "), email: m.ge || "", phone: m.gp || "", country: m.gc || "" },
      }),
    });
    const pj = await pb.json().catch(() => ({}));
    return NextResponse.json({ ok: !!pj?.ok, already: pj?.already });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
