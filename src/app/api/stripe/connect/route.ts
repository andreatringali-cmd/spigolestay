import Stripe from "stripe";
import { userOwnsStripeAccount } from "@/lib/stripe-guard";
import { requireUser, isErr } from "@/lib/server-auth";
import { siteOrigin } from "@/lib/server-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe Connect (Express): crea/riusa un account collegato per una struttura e restituisce
// il link di onboarding. Ogni proprietario collega il proprio Stripe e incassa sul proprio conto;
// la piattaforma addebita una fee sui pagamenti diretti (application_fee).
// Prerequisito: aver completato il "Connect platform setup" in dashboard Stripe (live).
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  const who = await requireUser(req);
  if (isErr(who)) return who;
  try {
    const body = await req.json().catch(() => ({}));
    const origin = siteOrigin(req);
    const structureId = String(body?.structureId || "");
    const email = typeof body?.email === "string" ? body.email : undefined;
    // Ritorno solo verso il nostro sito (niente redirect verso domini a scelta).
    const wantedReturn = String(body?.returnUrl || "");
    const returnBase = wantedReturn.startsWith(origin + "/") ? wantedReturn : `${origin}/strutture/${structureId}`;
    const stripe = new Stripe(key);

    let acct = typeof body?.accountId === "string" && body.accountId ? body.accountId : "";
    // Si lavora solo su un conto collegato proprio: prima bastava conoscere l'acct_… di un altro.
    if (acct && !(await userOwnsStripeAccount(stripe, who.admin, who.userId, acct))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    // Capability richieste: carte + Klarna (pagamento a rate per l'ospite). Google Pay/Apple Pay
    // non sono una capability separata (viaggiano su card_payments). Klarna comparirà al checkout
    // dell'ospite una volta approvata da Stripe (può richiedere una verifica aggiuntiva).
    const CAPS = { card_payments: { requested: true }, transfers: { requested: true }, klarna_payments: { requested: true } };
    // PayPal è un metodo nativo Stripe ma la capability non è tipizzata in questa versione dell'SDK:
    // la richiediamo via cast, best-effort (se l'API non la supporta, l'errore viene ignorato).
    const extraCaps = { paypal_payments: { requested: true } } as unknown as import("stripe").Stripe.AccountUpdateParams.Capabilities;
    // Se c'è già un account salvato ma NON è accessibile con la chiave attuale (tipico
    // passaggio test→live, o account creato con un'altra API), lo scartiamo e ne creiamo uno nuovo.
    if (acct) {
      try {
        await stripe.accounts.retrieve(acct);
        // Account esistente: richiedi Klarna + PayPal se non già attive (best-effort, non blocca).
        try { await stripe.accounts.update(acct, { capabilities: { klarna_payments: { requested: true }, ...extraCaps } }); } catch {}
      } catch { acct = ""; }
    }
    if (!acct) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "IT",
        email,
        capabilities: CAPS,
        business_profile: { name: (typeof body?.name === "string" ? body.name : undefined) || undefined },
        metadata: { structureId, uid: who.userId },
      });
      acct = account.id;
    }
    const sep = returnBase.includes("?") ? "&" : "?";
    const link = await stripe.accountLinks.create({
      account: acct,
      refresh_url: `${returnBase}${sep}stripe=refresh`,
      return_url: `${returnBase}${sep}stripe=done&acct=${acct}`,
      type: "account_onboarding",
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
  const who = await requireUser(req);
  if (isErr(who)) return who;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  try {
    const stripe = new Stripe(key);
    if (!(await userOwnsStripeAccount(stripe, who.admin, who.userId, id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const a = await stripe.accounts.retrieve(id);
    return NextResponse.json({
      chargesEnabled: !!a.charges_enabled,
      payoutsEnabled: !!a.payouts_enabled,
      detailsSubmitted: !!a.details_submitted,
      status: a.charges_enabled ? "active" : (a.details_submitted ? "pending" : "incomplete"),
    });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
