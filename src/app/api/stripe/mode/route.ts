import Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnostica sicura: modalità della chiave (test/live) e IDENTITÀ dell'account piattaforma
// (id, nome pubblico, email) — così si capisce a QUALE account Stripe è collegata la chiave
// `STRIPE_SECRET_KEY` (dove finiscono abbonamenti e commissioni). Non espone la chiave.
export async function GET() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  const mode = key.startsWith("sk_live_") || key.startsWith("rk_live_")
    ? "live"
    : key.startsWith("sk_test_") || key.startsWith("rk_test_")
      ? "test"
      : key ? "unknown" : "not_configured";
  let account: { id?: string; name?: string | null; email?: string | null; country?: string | null } | null = null;
  if (key) {
    try {
      const stripe = new Stripe(key);
      // Recupera l'account della chiave stessa (nessun id = account collegato alla secret key).
      const a = await (stripe.accounts.retrieve as (id?: string) => Promise<Stripe.Account>)();
      account = { id: a.id, name: a.business_profile?.name ?? a.settings?.dashboard?.display_name ?? null, email: a.email ?? null, country: a.country ?? null };
    } catch { account = null; }
  }
  return NextResponse.json({ mode, configured: !!key, account });
}
