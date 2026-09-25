import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Backfill UNA-TANTUM (super-admin): popola i campi abbonamento nelle righe `profiles` degli abbonati
// ESISTENTI leggendoli da Stripe, senza aspettare un evento webhook. Utile subito dopo aver introdotto
// la modalità DB del back-office (o dopo eventi persi). Accesso riservato: solo le email in ADMIN_EMAILS.
// Best-effort per cliente (try/catch, salta gli errori). POST, gated come le altre route admin.
const OWNER_EMAILS = (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com,andreatringali.spi@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Mappa configurabile price.id → chiave piano, da STRIPE_PRICE_MAP (JSON), es.
// {"price_xxx":"basic","price_yyy":"pro","price_zzz":"ultimate"}. Fallback quando manca metadata.plan.
function loadPriceMap(): Record<string, string> {
  try {
    const parsed = JSON.parse(process.env.STRIPE_PRICE_MAP || "{}") as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch { return {}; }
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!url || !service) return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who } = await admin.auth.getUser(token);
  const caller = who?.user;
  if (!caller?.email || !OWNER_EMAILS.includes(caller.email.toLowerCase()))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!stripeKey) return NextResponse.json({ ok: false, error: "stripe_not_configured", scanned: 0, updated: 0, errors: [] as string[] }, { status: 200 });
  const stripe = new Stripe(stripeKey);
  const priceMap = loadPriceMap();

  // Profili con un cliente Stripe collegato (cap ragionevole per non eccedere i tempi di una richiesta).
  const CAP = 500;
  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id,stripe_customer_id")
    .not("stripe_customer_id", "is", null)
    .limit(CAP);

  const list = (profiles || []) as { user_id: string; stripe_customer_id: string | null }[];
  let scanned = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const p of list) {
    const cid = p.stripe_customer_id;
    if (!cid) continue;
    scanned++;
    try {
      const subs = await stripe.subscriptions.list({ customer: cid, status: "all", limit: 1 });
      const sub = subs.data[0];
      if (!sub) continue; // nessuna subscription per questo cliente: nulla da scrivere

      const item0 = sub.items?.data?.[0];
      const price = item0?.price;
      const amt = typeof price?.unit_amount === "number" ? price.unit_amount : null;
      const interval = price?.recurring?.interval;
      const monthlyCents = amt == null ? null : (interval === "year" ? Math.round(amt / 12) : amt);
      const periodEndUnix = (item0 as unknown as { current_period_end?: number })?.current_period_end
        ?? (sub as unknown as { current_period_end?: number })?.current_period_end
        ?? null;
      const planKey = sub.metadata?.plan
        || (price?.metadata as Record<string, string> | undefined)?.plan
        || (price?.id ? priceMap[price.id] : null)
        || null;

      const patch: Record<string, unknown> = {
        subscription_status: sub.status,
        current_period_end: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
        monthly_amount_cents: monthlyCents,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        sub_currency: price?.currency ?? null,
        sub_updated_at: new Date().toISOString(),
      };
      if (planKey) patch.plan = planKey; // se il piano non è ricavabile, lascia invariato (come il webhook)

      const { error } = await admin.from("profiles").update(patch).eq("stripe_customer_id", cid);
      if (error) { errors.push(`${cid}: ${error.message}`); continue; }
      updated++;
    } catch (e) {
      errors.push(`${cid}: ${(e as Error)?.message || "stripe_error"}`); // best-effort: salta e continua
    }
  }

  return NextResponse.json({ ok: true, scanned, updated, errors });
}
