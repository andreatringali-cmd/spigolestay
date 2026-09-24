import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Feed pagamenti GLOBALE per il back-office (super-admin): TUTTE le fatture Stripe della piattaforma,
// non solo quelle di un singolo cliente. Accesso riservato: solo le email in ADMIN_EMAILS (default: il titolare).
const OWNER_EMAILS = (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com,andreatringali.spi@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!url || !service) return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who } = await admin.auth.getUser(token);
  const caller = who?.user;
  if (!caller?.email || !OWNER_EMAILS.includes(caller.email.toLowerCase())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!stripeKey) return NextResponse.json({ ok: true, stripeConfigured: false, invoices: [] });

  const stripe = new Stripe(stripeKey);
  try {
    const inv = await stripe.invoices.list({ limit: 100, expand: ["data.customer"] });
    const invoices = inv.data.map((i) => {
      // Il customer può essere: string (id), Stripe.Customer (espanso) o Stripe.DeletedCustomer.
      const cust = i.customer;
      const isExpanded = typeof cust === "object" && cust !== null && !("deleted" in cust && cust.deleted);
      const customer = isExpanded ? (cust as Stripe.Customer) : null;
      const customerId = typeof cust === "string" ? cust : (cust?.id ?? null);
      return {
        id: i.id,
        customerId,
        customerEmail: customer?.email ?? i.customer_email ?? null,
        customerName: customer?.name ?? i.customer_name ?? "",
        date: i.created ? new Date(i.created * 1000).toISOString() : null,
        amount: (i.amount_paid ?? i.amount_due ?? 0) / 100,
        currency: (i.currency || "eur").toUpperCase(),
        status: i.status || null,               // paid | open | void | uncollectible | draft
        paid: i.status === "paid",
        pdf: i.invoice_pdf || null,
        hostedUrl: i.hosted_invoice_url || null,
        description: i.lines?.data?.[0]?.description || i.number || null,
      };
    });
    invoices.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return NextResponse.json({ ok: true, stripeConfigured: true, invoices });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error)?.message || "stripe_error", invoices: [] }, { status: 200 });
  }
}
