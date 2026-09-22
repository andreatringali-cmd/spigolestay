import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnostica sicura: dice SOLO se la chiave Stripe collegata è in modalità test o live.
// Non espone la chiave né dati sensibili.
export async function GET() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  const mode = key.startsWith("sk_live_") || key.startsWith("rk_live_")
    ? "live"
    : key.startsWith("sk_test_") || key.startsWith("rk_test_")
      ? "test"
      : key ? "unknown" : "not_configured";
  return NextResponse.json({ mode, configured: !!key });
}
