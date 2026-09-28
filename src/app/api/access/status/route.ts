import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cancello di accesso "su invito": stabilisce se l'utente autenticato può ENTRARE nell'app.
// Xenora non è a registrazione aperta — chi entra con Google ma non è approvato viene bloccato.
// Ammessi:
//  1) gli OWNER/admin (ADMIN_EMAILS),
//  2) gli utenti GIÀ esistenti (hanno un app_state) — grandfather, nessun lockout,
//  3) i co-gestori con una membership,
//  4) gli invitati con un invito ancora da accettare (org_invites, accepted_at null),
//  5) le email in access_allowlist (approvate dall'owner dal back-office).
// Tutti gli altri: allowed=false → il client li disconnette e mostra "accesso su invito".
// In caso di errore tecnico: fail-open (allowed=true) per non bloccare clienti legittimi su un
// problema transitorio; i dati restano comunque isolati da RLS.

const OWNER_EMAILS = (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com,andreatringali.spi@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Supabase non configurato → non possiamo controllare: fail-open.
  if (!url || !service) return NextResponse.json({ allowed: true, reason: "no_backend" }, { status: 200 });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ allowed: false, reason: "no_token" }, { status: 200 });

  try {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: who, error } = await admin.auth.getUser(token);
    const user = who?.user;
    if (error || !user?.id) return NextResponse.json({ allowed: false, reason: "invalid_token" }, { status: 200 });
    const email = (user.email || "").toLowerCase();

    if (email && OWNER_EMAILS.includes(email)) return NextResponse.json({ allowed: true, reason: "owner" });

    // Utente già esistente (ha uno stato personale) → sempre ammesso.
    const { data: st } = await admin.from("app_state").select("user_id").eq("user_id", user.id).maybeSingle();
    if (st) return NextResponse.json({ allowed: true, reason: "existing" });

    // Co-gestore con membership.
    const { data: mem } = await admin.from("memberships").select("org_id").eq("user_id", user.id).limit(1);
    if (mem && mem.length) return NextResponse.json({ allowed: true, reason: "member" });

    if (email) {
      // Invito ancora da accettare (deve poter entrare per accettarlo).
      const { data: inv } = await admin.from("org_invites").select("id").eq("email", email).is("accepted_at", null).limit(1);
      if (inv && inv.length) return NextResponse.json({ allowed: true, reason: "invited" });

      // Email approvata in allowlist.
      const { data: al } = await admin.from("access_allowlist").select("email").eq("email", email).maybeSingle();
      if (al) return NextResponse.json({ allowed: true, reason: "allowlist" });
    }

    return NextResponse.json({ allowed: false, reason: "not_approved" }, { status: 200 });
  } catch {
    return NextResponse.json({ allowed: true, reason: "error_fail_open" }, { status: 200 });
  }
}
