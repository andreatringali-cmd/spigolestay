import Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe Connect: crea (o riusa) un account Express per una struttura e restituisce il link di onboarding.
// Ogni proprietario collega così il PROPRIO Stripe e incassa sul proprio conto (Xenora è la piattaforma).
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  try {
    const body = await req.json().catch(() => ({}));
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    const structureId = String(body?.structureId || "");
    const returnBase = String(body?.returnUrl || `${origin}/strutture/${structureId}`);
    const stripe = new Stripe(key);
    let acct = typeof body?.accountId === "string" && body.accountId ? body.accountId : "";
    if (!acct) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "IT",
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_type: "individual",
        metadata: { structureId },
      });
      acct = account.id;
    }
    const link = await stripe.accountLinks.create({
      account: acct,
      refresh_url: `${returnBase}${returnBase.includes("?") ? "&" : "?"}stripe=refresh`,
      return_url: `${returnBase}${returnBase.includes("?") ? "&" : "?"}stripe=done&acct=${acct}`,
      type: "account_onboarding",
    });
    return NextResponse.json({ url: link.url, accountId: acct });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}

// Verifica lo stato di un account collegato (onboarding completato? pagamenti abilitati?).
export async function GET(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  try {
    const stripe = new Stripe(key);
    const a = await stripe.accounts.retrieve(id);
    return NextResponse.json({ chargesEnabled: a.charges_enabled, detailsSubmitted: a.details_submitted, payoutsEnabled: a.payouts_enabled });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
