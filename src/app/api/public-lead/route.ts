import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Iscrizione newsletter dal sito PUBBLICO (Xenosite).
// Salva il contatto tra gli OSPITI del proprietario (app_state), risolvendo lo
// slug → proprietario dalla tabella public_sites. Dedup per email.

const DATA_KEY = "spigolestay:data:v1";
type Json = Record<string, unknown>;

export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim();
    const g = (body?.guest ?? {}) as Record<string, string>;
    const firstName = String(g.firstName || "").trim();
    const lastName = String(g.lastName || "").trim();
    const email = String(g.email || "").trim();
    const phone = String(g.phone || "").trim();
    if (!slug || (!email && !phone)) return NextResponse.json({ error: "bad_request" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: site, error: siteErr } = await admin.from("public_sites").select("user_id").eq("slug", slug).maybeSingle();
    if (siteErr) return NextResponse.json({ error: "read_error" }, { status: 500 });
    if (!site?.user_id) return NextResponse.json({ error: "site_not_found" }, { status: 404 });
    const ownerId = site.user_id as string;

    const { data: row, error: readErr } = await admin.from("app_state").select("data, rev").eq("user_id", ownerId).maybeSingle();
    if (readErr) return NextResponse.json({ error: "read_error" }, { status: 500 });
    const blob = ((row?.data ?? {}) as Record<string, string>) || {};
    const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;

    let data: Json = {};
    try { data = JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { data = {}; }
    const guests = (Array.isArray(data.guests) ? data.guests : []) as (Json & { id: string; email?: string; phone?: string; tags?: string[] })[];

    // Dedup: se esiste già lo stesso contatto (email o telefono), aggiorna il tag newsletter.
    const norm = (s?: string) => (s || "").trim().toLowerCase();
    const existing = guests.find((x) => (email && norm(x.email) === norm(email)) || (!email && phone && norm(x.phone) === norm(phone)));
    if (existing) {
      const tags = Array.isArray(existing.tags) ? existing.tags : [];
      if (!tags.includes("newsletter")) existing.tags = [...tags, "newsletter"];
    } else {
      const fullName = `${firstName} ${lastName}`.trim() || email || "Iscritto newsletter";
      guests.push({
        id: (globalThis.crypto?.randomUUID?.() ?? `g_${Date.now()}`),
        firstName: firstName || undefined, lastName: lastName || undefined, fullName,
        email: email || undefined, phone: phone || undefined,
        tags: ["newsletter"], source: "sito",
      } as Json & { id: string });
    }
    data.guests = guests;
    blob[DATA_KEY] = JSON.stringify(data);

    let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", ownerId);
    if (rev !== null) write = write.eq("rev", rev);
    const { data: updated, error: wErr } = await write.select("rev");
    if (wErr) return NextResponse.json({ error: "write_error", message: wErr.message }, { status: 500 });
    if (!updated || updated.length === 0) {
      // Conflitto di versione: riprova una volta senza lock.
      const { data: row2 } = await admin.from("app_state").select("data").eq("user_id", ownerId).maybeSingle();
      const blob2 = ((row2?.data ?? {}) as Record<string, string>) || {};
      let d2: Json = {}; try { d2 = JSON.parse(blob2[DATA_KEY] || "{}") as Json; } catch { d2 = {}; }
      const gs2 = (Array.isArray(d2.guests) ? d2.guests : []) as (Json & { id: string; email?: string; phone?: string; tags?: string[] })[];
      const ex2 = gs2.find((x) => (email && norm(x.email) === norm(email)) || (!email && phone && norm(x.phone) === norm(phone)));
      if (ex2) { const t = Array.isArray(ex2.tags) ? ex2.tags : []; if (!t.includes("newsletter")) ex2.tags = [...t, "newsletter"]; }
      else { const fullName = `${firstName} ${lastName}`.trim() || email || "Iscritto newsletter"; gs2.push({ id: (globalThis.crypto?.randomUUID?.() ?? `g_${Date.now()}`), firstName: firstName || undefined, lastName: lastName || undefined, fullName, email: email || undefined, phone: phone || undefined, tags: ["newsletter"], source: "sito" } as Json & { id: string }); }
      d2.guests = gs2; blob2[DATA_KEY] = JSON.stringify(d2);
      const { error: wErr2 } = await admin.from("app_state").update({ data: blob2, updated_at: new Date().toISOString() }).eq("user_id", ownerId);
      if (wErr2) return NextResponse.json({ error: "write_error", message: wErr2.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
