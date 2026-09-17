import Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Elenca le fatture reali dell'abbonamento dal conto Stripe (per email cliente).
// Se Stripe non è configurato o il cliente non esiste, ritorna lista vuota: la
// pagina Abbonamento → Fatture ricade sull'elenco dimostrativo.
export async function GET(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ configured: false, invoices: [] });

  const email = new URL(req.url).searchParams.get("email");
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });

  try {
    const stripe = new Stripe(key);
    const list = await stripe.customers.list({ email, limit: 1 });
    const cust = list.data[0];
    if (!cust) return NextResponse.json({ configured: true, invoices: [] });

    const inv = await stripe.invoices.list({ customer: cust.id, limit: 24 });
    const invoices = inv.data.map((i) => ({
      number: i.number || i.id,
      created: i.created ? i.created * 1000 : null,
      due: i.due_date ? i.due_date * 1000 : (i.created ? i.created * 1000 : null),
      paidAt: i.status_transitions?.paid_at ? i.status_transitions.paid_at * 1000 : null,
      status: i.status,                            // draft|open|paid|void|uncollectible
      subtotalCents: i.subtotal ?? 0,
      taxCents: (i.total ?? 0) - (i.subtotal ?? 0),
      totalCents: i.total ?? 0,
      currency: (i.currency || "eur").toUpperCase(),
      description: i.lines?.data?.[0]?.description || "Abbonamento Xenora",
      pdfUrl: i.invoice_pdf || null,
      hostedUrl: i.hosted_invoice_url || null,
    }));
    return NextResponse.json({ configured: true, invoices });
  } catch (e) {
    return NextResponse.json({ configured: true, invoices: [], error: (e as Error)?.message }, { status: 200 });
  }
}
