import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cancello di accesso "su invito": stabilisce se l'utente autenticato può ENTRARE nell'app.
// Xenora non è a registrazione aperta — chi entra con Google ma non è approvato viene bloccato.
// Regola VOLUTAMENTE semplice e assoluta: email in access_allowlist → entra, altrimenti no.
// Nessun "utente già esistente" grandfather: così "Rimuovi" da Accessi revoca DAVVERO l'accesso,
// anche a chi ha già usato l'app (prima la rimozione non aveva effetto su chi aveva già uno
// stato salvato). Unica eccezione: gli OWNER/admin (ADMIN_EMAILS), che non possono auto-bloccarsi.
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
    if (!email) return NextResponse.json({ allowed: false, reason: "not_approved" }, { status: 200 });

    // Email approvata in allowlist: unica condizione di ingresso.
    const { data: al } = await admin.from("access_allowlist").select("email").eq("email", email).maybeSingle();
    if (al) return NextResponse.json({ allowed: true, reason: "allowlist" });

    return NextResponse.json({ allowed: false, reason: "not_approved" }, { status: 200 });
  } catch {
    return NextResponse.json({ allowed: true, reason: "error_fail_open" }, { status: 200 });
  }
}
