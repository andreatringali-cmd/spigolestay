import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimited, siteOrigin } from "@/lib/server-auth";
import { buildAccessUrl, safeNext } from "@/lib/access-token";
import { isAdminEmail, norm } from "@/lib/invite-access";
import { sendInviteEmail } from "@/lib/invite-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// «Richiedi un nuovo link»: il link dell'invito vale 7 giorni. Se è scaduto, la persona lo chiede di nuovo da qui.
// Risposta SEMPRE uguale (ok), qualunque indirizzo si scriva: così non si scopre chi è invitato e chi no. L'email parte solo se l'indirizzo
// è ancora abilitato; tetti per indirizzo e per rete.
const ip = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function POST(req: Request) {
  const ok = NextResponse.json({ ok: true });
  const b = await req.json().catch(() => null) as { email?: string; next?: string } | null;
  const email = norm(b?.email);
  if (!isEmail(email)) return ok;
  if (rateLimited(`access-link-ip:${ip(req)}`, 10, 60 * 60 * 1000) || rateLimited(`access-link:${email}`, 3, 60 * 60 * 1000)) return ok;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return ok;
  try {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    if (!isAdminEmail(email)) {
      const { data: al } = await admin.from("access_allowlist").select("email").eq("email", email).maybeSingle();
      if (!al) return ok;
    }
    const origin = siteOrigin(req);
    const accessLink = buildAccessUrl(origin, email, safeNext(b?.next));
    if (!accessLink) return ok;
    await sendInviteEmail({ origin, email, inviter: "Xenora", accessLink, reissue: true });
  } catch { /* risposta uguale in ogni caso */ }
  return ok;
}
