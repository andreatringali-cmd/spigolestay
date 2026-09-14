import Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe Connect (Accounts v2): crea/riusa un account "merchant" per una struttura e restituisce
// il link di onboarding. Ogni proprietario collega il proprio Stripe e incassa sul proprio conto.
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  try {
    const body = await req.json().catch(() => ({}));
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    const structureId = String(body?.structureId || "");
    const email = typeof body?.email === "string" ? body.email : undefined;
    const returnBase = String(body?.returnUrl || `${origin}/strutture/${structureId}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stripe = new Stripe(key) as any;

    let acct = typeof body?.accountId === "string" && body.accountId ? body.accountId : "";
    if (!acct) {
      const account = await stripe.v2.core.accounts.create({
        contact_email: email,
        dashboard: "full", // configurazione tipo "Standard": dashboard Stripe completa per il proprietario
        identity: { country: "IT", entity_type: "individual" },
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
        // Standard: Stripe gestisce commissioni e perdite sul conto del proprietario.
        defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
        include: ["configuration.merchant"],
        metadata: { structureId },
      });
      acct = account.id;
    }
    const link = await stripe.v2.core.accountLinks.create({
      account: acct,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          return_url: `${returnBase}${returnBase.includes("?") ? "&" : "?"}stripe=done&acct=${acct}`,
          refresh_url: `${returnBase}${returnBase.includes("?") ? "&" : "?"}stripe=refresh`,
        },
      },
    });
    return NextResponse.json({ url: link.url, accountId: acct });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}

// Stato dell'account collegato: pagamenti abilitati?
export async function GET(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stripe = new Stripe(key) as any;
    const a = await stripe.v2.core.accounts.retrieve(id, { include: ["configuration.merchant"] });
    const status = a?.configuration?.merchant?.capabilities?.card_payments?.status;
    return NextResponse.json({ chargesEnabled: status === "active", status: status ?? null });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
