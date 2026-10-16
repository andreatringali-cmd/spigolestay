import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isOwnerEmail } from "@/lib/server-auth";
import { migrateMedia } from "@/lib/media-migrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Una chiamata elabora un BLOCCO (al massimo maxMs, default 40 s) e termina ben prima del limite di 60 s di Vercel.
export const maxDuration = 60;

// Migrazione una-tantum delle foto dai dati (data URI) a Supabase Storage. SOLO amministratore della piattaforma (ADMIN_EMAILS,
// come le altre route /api/admin/*). Corpo: { dryRun?, maxImages?, maxMs? }. Risposta: MigrateResult (vedi lib/media-migrate.ts).
// Il motore è idempotente e a blocchi: il client (components/MediaMigrator.tsx) la richiama finché `done`.

// Protezione base contro due blocchi in parallelo nella stessa istanza (due schede aperte): il lucchetto su rev resterebbe comunque valido.
let running = false;

const clamp = (v: unknown, min: number, max: number, def: number): number => {
  const n = typeof v === "number" && isFinite(v) ? v : def;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  const caller = who?.user;
  if (whoErr || !caller?.email || !isOwnerEmail(caller.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { dryRun?: unknown; maxImages?: unknown; maxMs?: unknown };
  const dryRun = body?.dryRun === true;
  if (running) return NextResponse.json({ error: "busy", message: "Un altro blocco è già in corso." }, { status: 409 });
  running = true;
  try {
    const result = await migrateMedia(admin, {
      dryRun,
      maxImages: clamp(body?.maxImages, 1, 50, 10),
      maxMs: clamp(body?.maxMs, 1000, 45_000, 40_000),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error)?.message ?? "migrazione non riuscita", done: false }, { status: 500 });
  } finally {
    running = false;
  }
}
