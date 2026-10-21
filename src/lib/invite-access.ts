// Chi può invitare collaboratori in un account, e cosa può concedere. Lato SERVER: l'identità arriva sempre dal token Supabase,
// mai dai campi inviati dal browser. Le funzioni di decisione (rootOf, canInvite, clampProfile…) sono pure e testate; quelle che
// toccano il database prendono il client "admin" (service role) come argomento, così i test usano un database finto.
//
// Modello: ogni accesso ha un ACCOUNT, identificato dall'email del TITOLARE (la radice). Un collaboratore invitato è una riga di
// access_allowlist con kind="collaboratore" e added_by = email di chi l'ha invitato (titolare, oppure un collaboratore con il
// permesso «Utenti»): risalendo la catena di added_by si arriva sempre alla radice. L'amministratore di piattaforma (ADMIN_EMAILS)
// resta fuori da queste regole: può tutto, come prima.
import type { SupabaseClient } from "@supabase/supabase-js";

/** Inviti in attesa (collaboratori che non si sono ancora registrati) ammessi per ogni account. */
export const MAX_PENDING_INVITES = 20;
/** Tetto per utente: inviti/rinvii all'ora (in memoria per istanza; il vero argine è MAX_PENDING_INVITES sul database). */
export const INVITE_RATE_MAX = 30;
export const INVITE_RATE_WINDOW_MS = 60 * 60 * 1000;
/** Profondità massima della catena "invitato da" (protezione da cicli). */
const MAX_HOPS = 6;

export const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
/** ilike senza caratteri jolly: "_" e "%" dell'email non devono combaciare con altri indirizzi. */
export const likeEsc = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com,andreatringali.spi@gmail.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
export const isAdminEmail = (email: string) => adminEmails().includes(norm(email));

type Level = "none" | "view" | "edit";
const ORD: Record<string, number> = { none: 0, view: 1, edit: 2 };

export interface CollabRow { email: string; added_by?: string | null; created_at?: string | null; note?: string | null; profile?: Record<string, unknown> | null }

export type Standing =
  | { role: "admin"; email: string; root: string }
  | { role: "titolare"; email: string; root: string }
  | { role: "collaboratore"; email: string; root: string; perms: Record<string, string>; structureIds: string[] | null };

/** Email del TITOLARE dell'account a cui appartiene `email` ("" se la catena è interrotta o circolare). */
export function rootOf(collabs: Map<string, CollabRow>, email: string): string {
  let e = norm(email);
  for (let hops = 0; hops <= MAX_HOPS; hops++) {
    if (!e) return "";
    if (isAdminEmail(e)) return e;
    const r = collabs.get(e);
    if (!r) return e; // non è un collaboratore: è il titolare del proprio account
    e = norm(r.added_by);
  }
  return "";
}

/** Tutti i collaboratori invitati (di tutti gli account): la tabella è piccola e serve per risalire le catene. */
export async function loadCollaborators(admin: SupabaseClient): Promise<Map<string, CollabRow>> {
  const { data } = await admin.from("access_allowlist").select("email, note, added_by, created_at, profile").eq("kind", "collaboratore");
  const map = new Map<string, CollabRow>();
  for (const r of (data ?? []) as CollabRow[]) map.set(norm(r.email), r);
  return map;
}

/** Ruolo di chi chiama, ricavato dal DATABASE (non dal browser). */
export async function standingOf(admin: SupabaseClient, emailIn: string): Promise<Standing> {
  const email = norm(emailIn);
  if (isAdminEmail(email)) return { role: "admin", email, root: email };
  const collabs = await loadCollaborators(admin);
  const me = collabs.get(email);
  if (!me) return { role: "titolare", email, root: email };
  const prof = (me.profile ?? {}) as Record<string, unknown>;
  const perms: Record<string, string> = {};
  if (prof.perms && typeof prof.perms === "object") for (const [k, v] of Object.entries(prof.perms as Record<string, unknown>)) if (typeof v === "string") perms[k] = v;
  const ids = prof.allStructures === false && Array.isArray(prof.structureIds) ? (prof.structureIds as unknown[]).filter((x): x is string => typeof x === "string") : null;
  return { role: "collaboratore", email, root: rootOf(collabs, email), perms, structureIds: ids };
}

/** Può invitare/rinviare/annullare inviti: titolare, oppure collaboratore con «Utenti» in modifica (e account riconoscibile). */
export function canInvite(s: Standing): boolean {
  if (s.role === "admin" || s.role === "titolare") return true;
  return !!s.root && s.perms.utenti === "edit";
}
/** Può vedere l'elenco degli inviti dell'account (anche con «Utenti» in sola lettura). */
export function canSeeInvites(s: Standing): boolean {
  if (s.role === "admin" || s.role === "titolare") return true;
  return !!s.root && (s.perms.utenti === "edit" || s.perms.utenti === "view");
}

/** Il profilo che un collaboratore invia non può superare il SUO: permessi al massimo uguali, strutture solo tra le sue, mai il modello «Titolare». */
export function clampProfile(profile: Record<string, unknown> | null, s: Standing): Record<string, unknown> | null {
  if (!profile || s.role !== "collaboratore") return profile;
  const out: Record<string, unknown> = { ...profile };
  if (out.perms && typeof out.perms === "object") {
    const p: Record<string, string> = {};
    for (const [k, v] of Object.entries(out.perms as Record<string, string>)) {
      const mine = (s.perms[k] as Level | undefined) ?? "none";
      p[k] = (ORD[v] ?? 0) <= (ORD[mine] ?? 0) ? v : mine;
    }
    // il permesso di gestire gli utenti in modifica lo delega solo il titolare: un collaboratore può al massimo dare la sola lettura
    if (p.utenti === "edit") p.utenti = "view";
    out.perms = p;
  }
  if (out.templateKey === "owner") out.templateKey = "custom";
  if (s.structureIds) {
    // chi vede solo alcune strutture può dare accesso solo a quelle
    out.allStructures = false;
    const asked = Array.isArray(out.structureIds) ? (out.structureIds as string[]) : [];
    out.structureIds = asked.filter((id) => s.structureIds!.includes(id));
  }
  return out;
}

/** Riga di access_allowlist di una email, di qualunque tipo (titolare o collaboratore). */
export async function existingRow(admin: SupabaseClient, email: string): Promise<{ email: string; kind?: string | null; added_by?: string | null } | null> {
  const { data } = await admin.from("access_allowlist").select("email, kind, added_by").ilike("email", likeEsc(norm(email))).maybeSingle();
  return (data as { email: string; kind?: string | null; added_by?: string | null } | null) ?? null;
}

/** Ha già un account Xenora (si è registrata con questa email)? Restituisce l'id utente. */
export async function registeredUserId(admin: SupabaseClient, email: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("user_id").ilike("email", likeEsc(norm(email))).maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}

/** Quella persona ha già dati o strutture propri (un suo account, o membro di un'altra organizzazione)? */
export async function hasOwnAccount(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data: st } = await admin.from("app_state").select("user_id").eq("user_id", userId).maybeSingle();
  if (st) return true;
  const { data: ms } = await admin.from("memberships").select("org_id").eq("user_id", userId).limit(1);
  return Array.isArray(ms) && ms.length > 0;
}

/** Inviti dell'account ancora in attesa (la persona non si è ancora registrata). */
export async function countPendingInvites(admin: SupabaseClient, collabs: Map<string, CollabRow>, root: string): Promise<number> {
  const mine = [...collabs.values()].filter((r) => rootOf(collabs, r.email) === root).map((r) => norm(r.email));
  if (mine.length < MAX_PENDING_INVITES) return mine.length; // anche se fossero tutti in attesa, sotto il tetto: niente altre query
  const { data } = await admin.from("profiles").select("email").in("email", mine);
  const registered = new Set(((data ?? []) as { email?: string }[]).map((p) => norm(p.email)));
  return mine.filter((e) => !registered.has(e)).length;
}

/** Il codice dell'invito-struttura ancora in attesa per quella email, fatto da chi invia (serve al link /accetta-invito nell'email). */
export async function pendingStructureCode(admin: SupabaseClient, email: string, invitedBy: string): Promise<string | null> {
  const { data } = await admin.from("org_invites").select("code, created_at").ilike("email", likeEsc(norm(email))).eq("status", "pending").eq("invited_by", invitedBy).order("created_at", { ascending: false }).limit(1);
  const row = Array.isArray(data) ? (data[0] as { code?: string } | undefined) : undefined;
  return row?.code ?? null;
}

/** L'email `target` appartiene allo stesso account di `callerEmail`? (vero anche per l'amministratore.) */
export async function sameAccount(admin: SupabaseClient, callerEmail: string, targetEmail: string): Promise<boolean> {
  if (isAdminEmail(callerEmail)) return true;
  const collabs = await loadCollaborators(admin);
  const t = collabs.get(norm(targetEmail));
  if (!t) return false;
  const a = rootOf(collabs, callerEmail);
  return !!a && rootOf(collabs, targetEmail) === a;
}
