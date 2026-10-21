import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { createClient } from "@supabase/supabase-js";
import { importBookings } from "@/lib/channex-inbound";
import { channexEnabled } from "@/lib/channex";
import { ensureChannexHooks } from "@/lib/channex-hooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rete di sicurezza: importa dal feed Channex TUTTE le prenotazioni non ancora
// confermate (tutti i tenant mappati), nel caso un webhook si perda.
// OBBLIGATORIO CRON_SECRET (se manca la rotta non esegue nulla): Vercel Cron invia "Authorization: Bearer <CRON_SECRET>"
// se l'env è impostata; oppure chiamalo da un cron esterno con ?key=<CRON_SECRET>.
// vercel.json (quando il piano lo consente):
//   { "crons": [{ "path": "/api/channex/cron", "schedule": "*/15 * * * *" }] }
async function run(req: Request) {
  // Senza CRON_SECRET la rotta si ferma (come gli altri cron): niente accesso anonimo all'importazione di tutti i tenant.
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, skipped: "no_secret" });
  if (!cronAuthorized(req, secret, ["key"])) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const res = await importBookings(admin);
  // Rete di sicurezza anche per i MESSAGGI delle OTA: se una property ha perso (o non ha mai avuto) l'avviso, lo si registra qui.
  let hooks: unknown = undefined;
  if (channexEnabled()) {
    try {
      const { data: rows } = await admin.from("channex_map").select("channex_property_id");
      const out = await ensureChannexHooks(((rows ?? []) as { channex_property_id?: string }[]).map((r) => r.channex_property_id as string));
      hooks = out.result.map((r) => ({ p: r.propertyId, nuovoPrenotazioni: r.created, nuovoMessaggi: !!r.messagesCreated, errore: r.error }));
    } catch (e) { hooks = { errore: (e as Error)?.message ?? "errore" }; }
  }
  return NextResponse.json({ ...(res as object), hooks });
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
