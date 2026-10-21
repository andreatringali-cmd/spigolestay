import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail, norm } from "@/lib/invite-access";
import { groupCopies, type CopyRow } from "@/lib/daily-copies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Elenco delle copie giornaliere (migrazione 0018) per account: SOLA LETTURA, solo amministratori di piattaforma (ADMIN_EMAILS).
// Non legge mai il contenuto delle copie (colonna `data`): solo giorno, dimensione e rev. Non esiste nessun modo, da qui, di ripristinare:
// il ripristino si fa a mano con restore_flat_key_from_daily (vedi docs/COPIE-GIORNALIERE.md).
// Se la migrazione non è ancora applicata le tabelle non esistono: risposta {ok:true, ready:false} (la pagina lo spiega), non un errore.

const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message || ""));

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized", message: "Sessione scaduta: esci e rientra." }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  const email = norm(who?.user?.email);
  if (whoErr || !who?.user?.id || !email) return NextResponse.json({ error: "unauthorized", message: "Sessione scaduta: esci e rientra." }, { status: 401 });
  if (!isAdminEmail(email)) return NextResponse.json({ error: "forbidden", message: "Area riservata all'amministratore." }, { status: 403 });

  const [appQ, orgQ] = await Promise.all([
    admin.from("app_state_daily").select("user_id, day, bytes, rev, taken_at").order("day", { ascending: false }).limit(5000),
    admin.from("org_state_daily").select("org_id, day, bytes, rev, taken_at").order("day", { ascending: false }).limit(5000),
  ]);
  if (missingTable(appQ.error) || missingTable(orgQ.error)) return NextResponse.json({ ok: true, ready: false, accounts: [], totalBytes: 0, totalCopies: 0 });
  if (appQ.error || orgQ.error) return NextResponse.json({ error: "read_failed", message: "Non riesco a leggere l'elenco delle copie: riprova." }, { status: 500 });

  const appRows: CopyRow[] = (appQ.data ?? []).map((r) => ({ id: String(r.user_id), day: String(r.day), bytes: Number(r.bytes), rev: Number(r.rev), takenAt: String(r.taken_at ?? "") }));
  const orgRows: CopyRow[] = (orgQ.data ?? []).map((r) => ({ id: String(r.org_id), day: String(r.day), bytes: Number(r.bytes), rev: Number(r.rev), takenAt: String(r.taken_at ?? "") }));

  // Etichette leggibili: email dell'utente, nome dell'organizzazione (solo gli id che hanno copie)
  const userLabels = new Map<string, string>();
  const wantUsers = new Set(appRows.map((r) => r.id));
  for (let page = 1; page <= 10 && wantUsers.size > userLabels.size; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    for (const u of data?.users ?? []) if (wantUsers.has(u.id) && u.email) userLabels.set(u.id, u.email);
    if ((data?.users ?? []).length < 200) break;
  }
  const orgLabels = new Map<string, string>();
  const orgIds = [...new Set(orgRows.map((r) => r.id))];
  if (orgIds.length) {
    const { data } = await admin.from("organizations").select("id, name").in("id", orgIds);
    for (const o of data ?? []) orgLabels.set(String(o.id), String(o.name || ""));
  }

  const accounts = [...groupCopies("user", appRows, userLabels), ...groupCopies("org", orgRows, orgLabels)];
  const totalBytes = accounts.reduce((s, a) => s + a.totalBytes, 0);
  const totalCopies = accounts.reduce((s, a) => s + a.copies.length, 0);
  return NextResponse.json({ ok: true, ready: true, accounts, totalBytes, totalCopies });
}
