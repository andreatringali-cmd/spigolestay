// Invito di un collaboratore (lato browser): un solo punto che fa, in ordine,
//  1) abilita l'indirizzo e salva il profilo (permessi/strutture) — senza email;
//  2) condivide le strutture scelte (così esiste il codice dell'invito);
//  3) manda l'email, che contiene il link /accetta-invito se c'è un codice, e quello di registrazione.
// Serve a «Nuovo utente», a «Rimanda invito» (elenco e scheda) e ad «Annulla invito». Le regole di chi può farlo stanno sul SERVER
// (api/admin/allowlist, api/org/invite): qui si leggono solo le risposte e si traducono in frasi chiare.
import { supabase } from "./supabase";
import { humanInviteError, inviteFailureMessage, structuresToShare } from "./user-access";
import { loadUsers, saveUsers, type User } from "./users";

type J = Record<string, unknown>;
export interface InviteOutcome {
  ok: boolean;               // l'indirizzo è abilitato (l'invito esiste)
  notified: boolean;         // l'email è partita
  sentAt?: string;
  message: string;           // frase pronta da mostrare
  shared: number;            // strutture condivise ora
  deferred: number;          // strutture che condividerà il titolare quando apre Xenora (chi invita non è il titolare)
  orgIds: Record<string, string>; // structureId → orgId, da salvare sulla struttura
  warnings: string[];        // errori per singola struttura
}

const bearer = async () => (await supabase?.auth.getSession())?.data.session?.access_token || "";
export const profileOf = (u: User) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, username: u.username, phone: u.phone, language: u.language, avatarColor: u.avatarColor, templateKey: u.templateKey, perms: u.perms, allStructures: u.allStructures, structureIds: u.structureIds });
const note = (u: User) => `Utente: ${u.firstName} ${u.lastName}`.trim();

async function callAllowlist(token: string, method: "POST" | "DELETE" | "GET", body?: J): Promise<{ status: number; j: J }> {
  const r = await fetch("/api/admin/allowlist", { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, j: (await r.json().catch(() => ({}))) as J };
}

/** Condivide con l'email della persona le strutture del suo profilo (idempotente). */
export async function shareStructures(token: string, u: User, structures: { id: string; name: string }[]): Promise<Pick<InviteOutcome, "shared" | "deferred" | "orgIds" | "warnings">> {
  const out = { shared: 0, deferred: 0, orgIds: {} as Record<string, string>, warnings: [] as string[] };
  for (const st of structuresToShare(structures, u)) {
    try {
      const rs = await fetch("/api/org/invite", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ structureId: st.id, email: u.email.trim(), silent: true }) });
      const sj = (await rs.json().catch(() => ({}))) as J;
      if (sj.ok) { out.shared += 1; if (sj.orgId) out.orgIds[st.id] = String(sj.orgId); }
      else if (sj.error === "not_owner") out.deferred += 1; // chi invita non è il titolare di quella struttura: la condividerà il titolare
      else out.warnings.push(`${st.name}: ${humanInviteError(String(sj.error ?? ""), String(sj.message ?? ""))}`);
    } catch { out.warnings.push(`${st.name}: rete non disponibile`); }
  }
  return out;
}

/** Invita (o rimanda l'invito a) un collaboratore: abilitazione + strutture + email. */
export async function runInvite(u: User, structures: { id: string; name: string }[]): Promise<InviteOutcome> {
  const fail = (message: string): InviteOutcome => ({ ok: false, notified: false, message, shared: 0, deferred: 0, orgIds: {}, warnings: [] });
  try {
    const token = await bearer();
    if (!token) return fail("Sessione scaduta: esci e rientra, poi riprova.");
    // 1) abilita + profilo, senza email (l'email parte dopo la condivisione, così contiene il link all'invito)
    const a = await callAllowlist(token, "POST", { email: u.email.trim(), note: note(u), kind: "collaboratore", profile: profileOf(u), notify: false });
    if (!a.j.ok) return fail(inviteFailureMessage(a.status, a.j));
    // 2) strutture
    const sh = await shareStructures(token, u, structures);
    // 3) email
    const b = await callAllowlist(token, "POST", { email: u.email.trim(), note: note(u), kind: "collaboratore", resend: true });
    if (!b.j.ok) return { ...fail(inviteFailureMessage(b.status, b.j)), ...sh, ok: true }; // abilitata ma email non partita
    const notified = b.j.notified === true;
    const sentAt = typeof b.j.sentAt === "string" ? b.j.sentAt : new Date().toISOString();
    return { ok: true, notified, sentAt, message: notified ? `Invito inviato a ${u.email.trim()}.` : `${u.email.trim()} è abilitata, ma l'email non è partita: copia il link di registrazione e mandaglielo tu.`, ...sh };
  } catch { return fail("Rete non disponibile: riprova."); }
}

/** Annulla un invito non ancora usato (toglie l'abilitazione e le condivisioni in attesa). */
export async function cancelInvite(email: string): Promise<{ ok: boolean; message: string }> {
  try {
    const token = await bearer();
    if (!token) return { ok: false, message: "Sessione scaduta: esci e rientra, poi riprova." };
    const r = await callAllowlist(token, "DELETE", { email: email.trim() });
    return r.j.ok ? { ok: true, message: `Invito a ${email.trim()} annullato.` } : { ok: false, message: inviteFailureMessage(r.status, r.j) };
  } catch { return { ok: false, message: "Rete non disponibile: riprova." }; }
}

/** Date di creazione degli inviti già presenti sul server, per email (serve a chi non ha la data salvata sul browser). */
export async function fetchInviteDates(): Promise<Record<string, string>> {
  try {
    const token = await bearer();
    if (!token) return {};
    const r = await callAllowlist(token, "GET");
    const out: Record<string, string> = {};
    for (const it of (Array.isArray(r.j.items) ? r.j.items : []) as { email?: string; created_at?: string }[]) if (it.email && it.created_at) out[it.email.trim().toLowerCase()] = it.created_at;
    return out;
  } catch { return {}; }
}

/** Scrive sulla scheda utente l'esito dell'invito (data, email non partita) e avvisa le pagine aperte. */
export function markInvited(userId: string, patch: { invitedAt?: string; inviteMailFailed?: boolean } | null) {
  try {
    const next = loadUsers().map((x) => {
      if (x.id !== userId) return x;
      const { invitedAt: _a, inviteMailFailed: _b, ...rest } = x; void _a; void _b;
      return { ...rest, ...(patch ?? {}) } as User;
    });
    saveUsers(next);
    window.dispatchEvent(new Event("spigolestay:users"));
  } catch { /* niente */ }
}
