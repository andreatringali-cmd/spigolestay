import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimited } from "@/lib/server-auth";
import { decideAccess, verifyAccessToken } from "@/lib/access-token";
import { findAuthUserByEmail } from "@/lib/auth-lookup";
import { isAdminEmail, norm } from "@/lib/invite-access";
import { friendlyError } from "@/lib/friendly-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// La persona invitata sceglie la password dal link ricevuto per email (un solo clic, niente conferma separata).
// Il link firmato dimostra che l'email è la sua; qui si controlla che sia ancora abilitata (invito non annullato) e si crea l'accesso già confermato.
// Chi ha già un accesso (es. con Google, tolto dall'elenco e invitato di nuovo) può impostare la password dal link come con una email di reset, ma solo finché da quando il link è stato creato non ha fatto altri accessi: il link si consuma da solo.
const PASSWORD_MIN = 8;
const ip = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "not_configured", message: "Servizio non disponibile: riprova tra poco." }, { status: 503 });
  if (rateLimited(`access-complete:${ip(req)}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "rate_limited", message: "Troppi tentativi. Riprova tra un'ora." }, { status: 429 });
  }
  const b = await req.json().catch(() => null) as { e?: string; t?: string; n?: string; s?: string; password?: string } | null;
  const email = verifyAccessToken(String(b?.e ?? ""), String(b?.t ?? ""), String(b?.n ?? ""), String(b?.s ?? ""));
  if (!email) return NextResponse.json({ error: "invalid_link", message: "Il link non è più valido: ha più di 7 giorni o è stato modificato." }, { status: 400 });
  const password = String(b?.password ?? "");
  if (password.length < PASSWORD_MIN) return NextResponse.json({ error: "weak", message: `La password deve avere almeno ${PASSWORD_MIN} caratteri.` }, { status: 400 });
  if (rateLimited(`access-complete-mail:${email}`, 8, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "rate_limited", message: "Troppi tentativi per questo indirizzo. Riprova tra un'ora." }, { status: 429 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  // L'invito deve essere ancora valido (se il titolare lo ha annullato, il vecchio link non serve più).
  if (!isAdminEmail(email)) {
    const { data: al } = await admin.from("access_allowlist").select("email").eq("email", norm(email)).maybeSingle();
    if (!al) return NextResponse.json({ error: "not_invited", message: "Questo indirizzo non risulta più invitato." }, { status: 403 });
  }

  try {
    const existing = await findAuthUserByEmail(admin, email);
    const what = decideAccess(existing, Number(b?.t ?? 0));
    if (what === "used") {
      return NextResponse.json({ error: "link_used", message: "Questo link è già stato usato, oppure hai fatto l'accesso da quando l'abbiamo creato. Entra con le tue credenziali, oppure richiedi un nuovo link." }, { status: 409 });
    }
    const res = what === "create"
      ? await admin.auth.admin.createUser({ email, password, email_confirm: true })
      : await admin.auth.admin.updateUserById((existing as { id: string }).id, { password, email_confirm: true });
    if (res.error) {
      // Un accesso esiste ma non l'avevamo trovato: non si crea un doppione, si rimanda al login.
      const code = String((res.error as { code?: string }).code ?? "");
      if (code === "email_exists" || /already been registered|already registered/i.test(String(res.error.message ?? ""))) {
        return NextResponse.json({ error: "already_registered", message: "Hai già un accesso con questo indirizzo: entra con Google oppure con la tua email e password." }, { status: 409 });
      }
      return NextResponse.json({ error: "auth_failed", message: friendlyError(res.error) }, { status: 400 });
    }
    return NextResponse.json({ ok: true, email });
  } catch (e) {
    return NextResponse.json({ error: "failed", message: friendlyError(e) }, { status: 500 });
  }
}
