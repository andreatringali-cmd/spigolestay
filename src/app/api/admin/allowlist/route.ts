import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { notifyAccessApproved } from "@/lib/allowlist-approve";
import { sanitizeProfile } from "@/lib/user-access";
import { isUserAllowed, rateLimited, siteOrigin } from "@/lib/server-auth";
import {
  INVITE_RATE_MAX, INVITE_RATE_WINDOW_MS, MAX_PENDING_INVITES,
  canInvite, canSeeInvites, clampProfile, countPendingInvites, existingRow, hasOwnAccount, isAdminEmail, likeEsc,
  loadCollaborators, norm, pendingStructureCode, registeredUserId, rootOf, standingOf, type Standing,
} from "@/lib/invite-access";
import { sendInviteEmail } from "@/lib/invite-notify";
import { buildAccessUrl } from "@/lib/access-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Accessi su invito (allowlist). Due categorie di chiamanti, riconosciute SEMPRE dal token Supabase (mai dai campi inviati):
//  - AMMINISTRATORE di piattaforma (ADMIN_EMAILS): può tutto, come sempre (elenco completo, titolari e collaboratori, rimozioni).
//  - TITOLARE di un account (o collaboratore con il permesso «Utenti» in modifica): può invitare, rimandare e annullare inviti di
//    collaboratori SOLO del proprio account (vedi src/app/api/org/INVITI.md). Non può creare altri titolari né toccare altri account.
// GET elenca, POST aggiunge / aggiorna il profilo / rimanda, DELETE rimuove.

interface Ctx { admin: SupabaseClient; userId: string; email: string; name: string; standing: Standing }

async function requireStaff(req: Request): Promise<Ctx | NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized", message: "Sessione scaduta: esci e rientra." }, { status: 401 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error } = await admin.auth.getUser(token);
  const user = who?.user;
  const email = norm(user?.email);
  if (error || !user?.id || !email) return NextResponse.json({ error: "unauthorized", message: "Sessione scaduta: esci e rientra." }, { status: 401 });
  if (!isAdminEmail(email)) {
    // come ovunque nel server: chi non è ammesso (accesso su invito) non può invitare nessuno
    let ok = false;
    try { ok = await isUserAllowed(admin, user); } catch { return NextResponse.json({ error: "access_check_failed", message: "Controllo dell'accesso non riuscito: riprova tra poco." }, { status: 503 }); }
    if (!ok) return NextResponse.json({ error: "forbidden", message: "Questo account non è ancora abilitato." }, { status: 403 });
  }
  const standing = await standingOf(admin, email);
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name = String(meta.full_name || meta.name || "").trim() || email;
  return { admin, userId: user.id, email, name, standing };
}

// Dove atterra la persona dopo aver scelto la password: l'invito a una struttura, altrimenti le Pulizie per l'addetta, altrimenti la home.
function nextAfterInvite(code: string | null | undefined, profile: unknown): string {
  if (code) return `/accetta-invito?code=${encodeURIComponent(code)}`;
  const key = (profile as { templateKey?: string } | null | undefined)?.templateKey;
  return key === "cleaner" ? "/pulizie" : "/";
}

const normEmail = norm;
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const deny = (status: number, error: string, message: string) => NextResponse.json({ error, message }, { status });
const MSG_NO_PERM = "Non hai il permesso «Utenti» in modifica: chiedi al titolare dell'account di invitare la persona o di darti il permesso.";

export async function GET(req: Request) {
  const a = await requireStaff(req);
  if (a instanceof NextResponse) return a;
  if (a.standing.role === "admin") {
    const { data, error } = await a.admin.from("access_allowlist").select("email, note, added_by, created_at, kind").order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    return NextResponse.json({ ok: true, items: data ?? [] });
  }
  if (!canSeeInvites(a.standing)) return deny(403, "missing_permission", "Non hai il permesso di vedere gli utenti di questo account.");
  // titolare / collaboratore: solo gli inviti del proprio account
  const collabs = await loadCollaborators(a.admin);
  const items = [...collabs.values()]
    .filter((r) => rootOf(collabs, r.email) === a.standing.root)
    .map((r) => ({ email: r.email, note: r.note ?? null, added_by: r.added_by ?? null, created_at: r.created_at ?? null, kind: "collaboratore" }))
    .sort((x, y) => String(y.created_at ?? "").localeCompare(String(x.created_at ?? "")));
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const a = await requireStaff(req);
  if (a instanceof NextResponse) return a;
  const body = await req.json().catch(() => null) as { email?: string; note?: string; kind?: string; profile?: unknown; profileOnly?: boolean; resend?: boolean; notify?: boolean } | null;
  const email = normEmail(body?.email);
  if (!isEmail(email)) return NextResponse.json({ error: "email_non_valida", message: "L'indirizzo email non è valido." }, { status: 400 });
  const note = String(body?.note ?? "").slice(0, 200) || null;
  const profile = sanitizeProfile(body?.profile);

  // ---- AMMINISTRATORE: comportamento invariato -------------------------------------------------------------------------------
  if (a.standing.role === "admin") {
    // Solo aggiornamento del profilo di chi è già invitato: nessuna email, nessun nuovo accesso.
    if (body?.profileOnly) {
      if (!profile) return NextResponse.json({ ok: true, updated: false });
      const { data: upd, error: upErr } = await a.admin.from("access_allowlist").update({ profile }).eq("email", email).select("email");
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 200 });
      return NextResponse.json({ ok: true, updated: (upd ?? []).length > 0 });
    }
    const { error } = await a.admin.from("access_allowlist").upsert({ email, note, added_by: a.email, kind: body?.kind === "collaboratore" || (note ?? "").startsWith("Utente:") ? "collaboratore" : "titolare", ...(profile ? { profile } : {}) }, { onConflict: "email" });
    if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    // notify:false = l'email la manderà un passo successivo (dopo la condivisione delle strutture, così contiene il link all'invito)
    const notified = body?.notify === false ? false : await notifyAccessApproved(email, nextAfterInvite(null, profile));
    return NextResponse.json({ ok: true, notified, sentAt: new Date().toISOString() });
  }

  // ---- TITOLARE / COLLABORATORE con «Utenti»: solo il proprio account ---------------------------------------------------------
  const { admin, standing } = a;
  if (!canInvite(standing)) return deny(403, "missing_permission", MSG_NO_PERM);
  if (email === a.email) return deny(400, "self_invite", "Questo è il tuo indirizzo: sei già dentro, non serve invitarti.");
  const root = standing.root;
  if (isAdminEmail(email)) return deny(409, "email_other_account", `${email} risulta già collegata a un altro account Xenora: non posso invitarla qui. Usa un altro indirizzo.`);

  const collabs = await loadCollaborators(admin);
  const existing = await existingRow(admin, email);
  // La riga esiste già: deve essere un collaboratore DI QUESTO account. Titolari e collaboratori di altri account non si toccano.
  if (existing && (existing.kind !== "collaboratore" || rootOf(collabs, email) !== root)) {
    return deny(409, "email_other_account", `${email} risulta già collegata a un altro account Xenora: non posso invitarla qui. Usa un altro indirizzo.`);
  }
  const userId = await registeredUserId(admin, email);

  // Solo aggiornamento del profilo (permessi/strutture) di un collaboratore già invitato: niente email, niente nuovi accessi.
  if (body?.profileOnly) {
    if (!existing) return deny(404, "invite_not_found", "Questa persona non è ancora stata invitata.");
    const clean = clampProfile(profile, standing);
    if (!clean) return NextResponse.json({ ok: true, updated: false });
    const { error: upErr } = await admin.from("access_allowlist").update({ profile: clean }).eq("email", existing.email);
    if (upErr) return deny(500, "update_failed", "Non sono riuscito a salvare i permessi: riprova.");
    return NextResponse.json({ ok: true, updated: true });
  }

  // Inviti e rinvii: tetto orario per utente
  if (rateLimited(`invite:${a.userId}`, INVITE_RATE_MAX, INVITE_RATE_WINDOW_MS)) {
    return deny(429, "rate_limited", "Hai mandato molti inviti in poco tempo. Riprova tra un'ora.");
  }

  // Già registrato e già dentro: niente da (ri)mandare.
  if (existing && userId) return deny(409, "already_member", `${email} fa già parte del tuo account: ha già effettuato la registrazione.`);

  // Rimanda l'invito esistente (nessuna modifica ai dati, solo l'email)
  if (body?.resend) {
    if (!existing) return deny(404, "invite_not_found", "Non trovo un invito per questo indirizzo: crea di nuovo l'utente.");
    const code = await pendingStructureCode(admin, email, a.userId);
    const origin = siteOrigin(req);
    const { data: prof } = await admin.from("access_allowlist").select("profile").eq("email", existing.email).maybeSingle();
    const notified = await sendInviteEmail({ origin, email, inviter: a.name, code, accessLink: buildAccessUrl(origin, email, nextAfterInvite(code, (prof as { profile?: unknown } | null)?.profile)), replyTo: a.email });
    return NextResponse.json({ ok: true, notified, sentAt: new Date().toISOString() });
  }

  if (!existing) {
    // Chi ha già un account proprio (dati o strutture) non si "adotta": sovrascriverebbe la sua scheda al primo accesso.
    if (userId && await hasOwnAccount(admin, userId)) {
      return deny(409, "email_other_account", `${email} ha già un proprio account Xenora: non posso invitarla come collaboratore. Usa un altro indirizzo.`);
    }
    // Tetto di inviti in attesa per account
    const pending = await countPendingInvites(admin, collabs, root);
    if (pending >= MAX_PENDING_INVITES) {
      return deny(409, "invite_limit", `Hai già ${MAX_PENDING_INVITES} inviti in attesa. Aspetta che qualcuno si registri oppure annulla un invito che non serve più.`);
    }
  }

  const clean = clampProfile(profile, standing);
  const who = `${(clean?.firstName as string) ?? ""} ${(clean?.lastName as string) ?? ""}`.trim();
  const row = { email, note: `Utente: ${who}`.trim().slice(0, 200), added_by: a.email, kind: "collaboratore", ...(clean ? { profile: clean } : {}) };
  // kind e note sono decisi qui (non dal browser): un titolare non può creare altri titolari
  const { error } = existing
    ? await admin.from("access_allowlist").update(row).eq("email", existing.email)
    : await admin.from("access_allowlist").upsert(row, { onConflict: "email" });
  if (error) return deny(500, "invite_failed", "Non sono riuscito a registrare l'invito: riprova tra poco.");

  const origin = siteOrigin(req);
  const inviteCode = body?.notify === false ? null : await pendingStructureCode(admin, email, a.userId);
  const notified = body?.notify === false ? false : await sendInviteEmail({ origin, email, inviter: a.name, code: inviteCode, accessLink: buildAccessUrl(origin, email, nextAfterInvite(inviteCode, clean)), replyTo: a.email });
  return NextResponse.json({ ok: true, notified, sentAt: new Date().toISOString() });
}

export async function DELETE(req: Request) {
  const a = await requireStaff(req);
  if (a instanceof NextResponse) return a;
  const body = await req.json().catch(() => null) as { email?: string } | null;
  const email = normEmail(body?.email);
  if (!email) return NextResponse.json({ error: "email_mancante", message: "Manca l'indirizzo email." }, { status: 400 });

  if (a.standing.role === "admin") {
    // Sicurezza: non permettere di rimuovere un OWNER dalla lista.
    if (isAdminEmail(email)) return NextResponse.json({ error: "owner_non_rimovibile" }, { status: 400 });
    const { error } = await a.admin.from("access_allowlist").delete().eq("email", email);
    if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    return NextResponse.json({ ok: true });
  }

  // Annulla un invito del proprio account, finché la persona non si è registrata.
  const { admin, standing } = a;
  if (!canInvite(standing)) return deny(403, "missing_permission", MSG_NO_PERM);
  const collabs = await loadCollaborators(admin);
  const existing = await existingRow(admin, email);
  if (!existing) return NextResponse.json({ ok: true, removed: false }); // già annullato: va bene così
  if (existing.kind !== "collaboratore" || rootOf(collabs, email) !== standing.root) {
    return deny(403, "email_other_account", "Questo indirizzo non fa parte del tuo account.");
  }
  if (await registeredUserId(admin, email)) {
    return deny(409, "already_member", `${email} si è già registrata: l'invito non si può più annullare. Per toglierle l'accesso alle strutture usa la scheda della struttura (Co-gestori).`);
  }
  const { error } = await admin.from("access_allowlist").delete().eq("email", existing.email);
  if (error) return deny(500, "delete_failed", "Non sono riuscito ad annullare l'invito: riprova.");
  // anche le condivisioni di struttura in attesa fatte da te per quella email: altrimenti il vecchio link resterebbe valido
  await admin.from("org_invites").delete().ilike("email", likeEsc(email)).eq("status", "pending").eq("invited_by", a.userId);
  return NextResponse.json({ ok: true, removed: true });
}
