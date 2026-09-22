import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recensione DIRETTA dal sito PUBBLICO (Xenosite, xenora.it/<slug>).
// Un visitatore anonimo lascia una recensione dal mini-sito: questa route
// (service role, nessuna autenticazione) risolve lo slug → proprietario + struttura
// dalla tabella public_sites e APPENDE la recensione all'array `directReviews` nel
// blob dati del proprietario (stessa riga app_state dove vivono le prenotazioni).
// Il gestore la vedrà in "Recensioni" (fonte Diretta), potrà rispondere e pubblicare.
// Stesso pattern di /api/public-booking (rev-lock + retry singolo).

const DATA_KEY = "spigolestay:data:v1";
type Json = Record<string, unknown>;
type DirectReview = { id: string; updatedAt?: number; structureId: string; guest: string; date: string; rating: number; text: string; source: "direct"; reply?: string; createdAt: number };

const isoDay = () => new Date().toISOString().slice(0, 10);

// Normalizza il voto in scala 0..10. Le stelle del sito sono 1..5 → ×2.
// Un valore già in 6..10 viene tenuto così com'è (già scala /10).
function normRating(raw: unknown): number {
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) return 0;
  const r = n <= 5 ? n * 2 : n;
  return Math.max(0, Math.min(10, Math.round(r)));
}

export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim();
    const rating = normRating(body?.rating);
    const guest = String(body?.guest || "").trim().slice(0, 60) || "Ospite";
    const text = String(body?.text || "").trim().slice(0, 1000);

    if (!slug || rating <= 0) return NextResponse.json({ error: "bad_request" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

    // 1) slug → proprietario + struttura (il mini-sito di uno slug è di UNA struttura)
    const { data: site, error: siteErr } = await admin.from("public_sites").select("user_id, structure_id").eq("slug", slug).maybeSingle();
    if (siteErr) return NextResponse.json({ error: "read_error" }, { status: 500 });
    if (!site?.user_id || !site?.structure_id) return NextResponse.json({ error: "site_not_found" }, { status: 404 });
    const ownerId = site.user_id as string;
    const sid = site.structure_id as string;

    const now = Date.now();
    const review: DirectReview = {
      id: (globalThis.crypto?.randomUUID?.() ?? `dr_${now}`),
      updatedAt: now,
      structureId: sid,
      guest,
      date: isoDay(),
      rating,
      text,
      source: "direct",
      reply: "",
      createdAt: now,
    };

    // 2) leggi app_state del proprietario e appendi la recensione
    const { data: row, error: readErr } = await admin.from("app_state").select("data, rev").eq("user_id", ownerId).maybeSingle();
    if (readErr) return NextResponse.json({ error: "read_error" }, { status: 500 });
    const blob = ((row?.data ?? {}) as Record<string, string>) || {};
    const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;

    let data: Json = {};
    try { data = JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { data = {}; }
    const list = (Array.isArray(data.directReviews) ? data.directReviews : []) as DirectReview[];
    list.push(review);
    data.directReviews = list;
    blob[DATA_KEY] = JSON.stringify(data);

    // 3) scrittura con lock su rev; retry una volta in caso di conflitto
    let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", ownerId);
    if (rev !== null) write = write.eq("rev", rev);
    const { data: updated, error: wErr } = await write.select("rev");
    if (wErr) return NextResponse.json({ error: "write_error", message: wErr.message }, { status: 500 });
    if (!updated || updated.length === 0) {
      // Conflitto di versione: rileggi e riprova una volta senza lock.
      const { data: row2 } = await admin.from("app_state").select("data").eq("user_id", ownerId).maybeSingle();
      const blob2 = ((row2?.data ?? {}) as Record<string, string>) || {};
      let d2: Json = {}; try { d2 = JSON.parse(blob2[DATA_KEY] || "{}") as Json; } catch { d2 = {}; }
      const l2 = (Array.isArray(d2.directReviews) ? d2.directReviews : []) as DirectReview[];
      l2.push(review); d2.directReviews = l2; blob2[DATA_KEY] = JSON.stringify(d2);
      const { error: wErr2 } = await admin.from("app_state").update({ data: blob2, updated_at: new Date().toISOString() }).eq("user_id", ownerId);
      if (wErr2) return NextResponse.json({ error: "write_error", message: wErr2.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
