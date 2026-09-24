import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Storico pagamenti/fatture di un cliente Stripe, per il back-office (super-admin).
// Restituisce le fatture abbonamento (data, importo, stato, PDF/URL) e i pagamenti.
const OWNER_EMAILS = (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com,andreatringali.spi@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!url || !service) return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });
  if (!stripeKey) return NextResponse.json({ ok: true, stripeConfigured: false, invoices: [] });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who } = await admin.auth.getUser(token);
  const caller = who?.user;
  if (!caller?.email || !OWNER_EMAILS.includes(caller.email.toLowerCase())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const customerId = String(body?.customerId || "").trim();
  if (!customerId) return NextResponse.json({ error: "missing_customer" }, { status: 400 });

  const stripe = new Stripe(stripeKey);
  try {
    const inv = await stripe.invoices.list({ customer: customerId, limit: 24 });
    const invoices = inv.data.map((i) => ({
      id: i.id,
      number: i.number || null,
      date: i.created ? new Date(i.created * 1000).toISOString() : null,
      periodEnd: i.lines?.data?.[0]?.period?.end ? new Date(i.lines.data[0].period.end * 1000).toISOString() : null,
      amount: (i.amount_paid ?? i.amount_due ?? 0) / 100,
      currency: (i.currency || "eur").toUpperCase(),
      status: i.status || null,               // paid | open | void | uncollectible | draft
      paid: i.status === "paid",
      pdf: i.invoice_pdf || null,             // PDF della fattura Stripe
      hostedUrl: i.hosted_invoice_url || null,
      description: i.lines?.data?.[0]?.description || null,
    }));
    return NextResponse.json({ ok: true, stripeConfigured: true, invoices });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error)?.message || "stripe_error", invoices: [] }, { status: 200 });
  }
}
