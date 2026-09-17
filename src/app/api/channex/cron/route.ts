import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { importBookings } from "@/lib/channex-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rete di sicurezza: importa dal feed Channex TUTTE le prenotazioni non ancora
// confermate (tutti i tenant mappati), nel caso un webhook si perda.
// Proteggi con CRON_SECRET: Vercel Cron invia "Authorization: Bearer <CRON_SECRET>"
// se l'env è impostata; oppure chiamalo da un cron esterno con ?key=<CRON_SECRET>.
// vercel.json (quando il piano lo consente):
//   { "crons": [{ "path": "/api/channex/cron", "schedule": "*/15 * * * *" }] }
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    const key = new URL(req.url).searchParams.get("key") || "";
    if (auth !== `Bearer ${secret}` && key !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const res = await importBookings(admin);
  return NextResponse.json(res);
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
