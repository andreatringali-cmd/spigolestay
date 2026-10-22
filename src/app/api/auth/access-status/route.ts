import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimited } from "@/lib/server-auth";
import { decideAccess, verifyAccessToken } from "@/lib/access-token";
import { findAuthUserByEmail } from "@/lib/auth-lookup";
import { isAdminEmail, norm } from "@/lib/invite-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// La pagina del link di invito chiede com'è messo l'indirizzo: nuovo (si sceglie la password), già con un accesso (si può entrare con Google o impostare
// la password), link già usato, oppure link non valido / invito non più valido. Solo con il link firmato in mano; mai l'elenco degli invitati.
const ip = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "not_configured", message: "Servizio non disponibile: riprova tra poco." }, { status: 503 });
  if (rateLimited(`access-status:${ip(req)}`, 60, 60 * 60 * 1000)) return NextResponse.json({ error: "rate_limited", message: "Troppi tentativi. Riprova tra un'ora." }, { status: 429 });
  const b = await req.json().catch(() => null) as { e?: string; t?: string; n?: string; s?: string } | null;
  const email = verifyAccessToken(String(b?.e ?? ""), String(b?.t ?? ""), String(b?.n ?? ""), String(b?.s ?? ""));
  if (!email) return NextResponse.json({ state: "invalid", message: "Il link non è più valido: ha più di 7 giorni o è stato modificato." });
  try {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    if (!isAdminEmail(email)) {
      const { data: al } = await admin.from("access_allowlist").select("email").eq("email", norm(email)).maybeSingle();
      if (!al) return NextResponse.json({ state: "invalid", message: "Questo indirizzo non risulta più invitato." });
    }
    const existing = await findAuthUserByEmail(admin, email);
    const what = decideAccess(existing, Number(b?.t ?? 0));
    return NextResponse.json({ state: what === "used" ? "used" : what === "reset" ? "existing" : "new", providers: existing?.providers ?? [] });
  } catch {
    return NextResponse.json({ error: "failed", message: "Non riesco a controllare il link: riprova tra poco." }, { status: 500 });
  }
}
