import type { SupabaseClient } from "@supabase/supabase-js";
import { registeredUserId } from "./invite-access";

// Trova l'accesso (utente di autenticazione) di un indirizzo, anche se non ha la scheda `profiles` (es. registrato con Google e mai entrato).
// Serve quando qualcuno viene invitato, tolto dall'elenco e invitato di nuovo: il suo accesso esiste già e non va ricreato.
export interface AuthUserInfo { id: string; confirmed: boolean; lastSignInAt: string | null; providers: string[] }

const toInfo = (u: { id: string; email_confirmed_at?: string | null; last_sign_in_at?: string | null; identities?: { provider?: string }[] | null; app_metadata?: { providers?: string[] } | null }): AuthUserInfo => ({
  id: u.id,
  confirmed: !!u.email_confirmed_at,
  lastSignInAt: u.last_sign_in_at ?? null,
  providers: [...new Set([...(u.identities ?? []).map((i) => String(i.provider ?? "")), ...((u.app_metadata?.providers ?? []) as string[])].filter(Boolean))],
});

export async function findAuthUserByEmail(admin: SupabaseClient, email: string): Promise<AuthUserInfo | null> {
  const want = String(email || "").trim().toLowerCase();
  if (!want) return null;
  const pid = await registeredUserId(admin, want);
  if (pid) {
    const { data } = await admin.auth.admin.getUserById(pid);
    if (data?.user) return toInfo(data.user);
  }
  // Senza scheda profilo: si cerca tra gli accessi, una pagina da 1000 alla volta (fino a 20.000).
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === want);
    if (hit) return toInfo(hit);
    if (data.users.length < 1000) return null;
  }
  return null;
}
