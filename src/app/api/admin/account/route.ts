import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dettaglio completo di UN account per il back-office (super-admin) di Xenora.
// Aggrega: dati auth+profilo, strutture/camere (dal blob personale app_state e da
// tutte le org di cui l'utente è titolare in org_state), collaboratori per struttura,
// abbonamento + storico fatture Stripe, e la nota interna del titolare.
// Accesso riservato: solo le email in ADMIN_EMAILS (default: il titolare).
const OWNER_EMAILS = (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com,andreatringali.spi@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const DATA_KEY = "spigolestay:data:v1";
type J = Record<string, unknown>;
const arr = (x: unknown): J[] => (Array.isArray(x) ? (x as J[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const numOr = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

// Estrae il blob "spigolestay:data:v1" dalla colonna data (jsonb: chiave→stringa JSON).
function parseBlob(dataCol: unknown): J {
  try {
    const s = ((dataCol ?? {}) as Record<string, string>)[DATA_KEY] || "{}";
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === "object" ? (parsed as J) : {};
  } catch { return {}; }
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin: SupabaseClient = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who } = await admin.auth.getUser(token);
  const caller = who?.user;
  if (!caller?.email || !OWNER_EMAILS.includes(caller.email.toLowerCase()))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const userId = String(body?.userId || "").trim();
  if (!userId) return NextResponse.json({ error: "missing_user" }, { status: 400 });

  // ── 1) Utente auth + profilo ────────────────────────────────────────────────
  type AuthUser = { id: string; email?: string; created_at?: string; last_sign_in_at?: string | null; email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> };
  let authUser: AuthUser | null = null;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    authUser = (data?.user as unknown as AuthUser) || null;
  } catch { authUser = null; }

  const { data: profRow } = await admin.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  const prof = (profRow || {}) as J;

  // ── 2) Blob strutture/camere: personale + org possedute ─────────────────────
  const { data: appRow } = await admin.from("app_state").select("data").eq("user_id", userId).maybeSingle();
  const blobs: J[] = [parseBlob(appRow?.data)];

  // Org di cui l'utente è OWNER (attivo).
  const { data: memRows } = await admin.from("memberships").select("org_id,user_id,role,active").eq("user_id", userId);
  const ownedOrgIds: string[] = [];
  for (const m of arr(memRows)) {
    if (m.active === false) continue;
    if (m.role === "owner") ownedOrgIds.push(String(m.org_id || ""));
  }
  for (const oid of ownedOrgIds) {
    if (!oid) continue;
    const { data: os } = await admin.from("org_state").select("data").eq("org_id", oid).maybeSingle();
    blobs.push(parseBlob(os?.data));
  }

  // Unisci structures/units/roomTypes di tutti i blob (dedup per id).
  const structById = new Map<string, J>();
  const unitById = new Map<string, J>();
  const roomTypeById = new Map<string, J>();
  for (const b of blobs) {
    for (const s of arr(b.structures)) { const id = str(s.id); if (id && !structById.has(id)) structById.set(id, s); }
    for (const u of arr(b.units)) { const id = str(u.id); if (id && !unitById.has(id)) unitById.set(id, u); }
    for (const rt of arr(b.roomTypes)) { const id = str(rt.id); if (id && !roomTypeById.has(id)) roomTypeById.set(id, rt); }
  }

  // ── 3) Strutture con camere ─────────────────────────────────────────────────
  interface Room { name: string; roomType: string | null; beds: number; bedConfig: unknown; size: unknown }
  interface Member { id: string; name: string; email: string; phone: string | null }
  interface StructOut { id: string; name: string; city: string; roomCount: number; bedCount: number; rooms: Room[]; members: Member[] }

  const structures: StructOut[] = [];
  const structByIdOut = new Map<string, StructOut>();
  for (const s of structById.values()) {
    const sid = str(s.id);
    const units = Array.from(unitById.values()).filter((u) => str(u.structureId) === sid);
    const rooms: Room[] = units.map((u) => {
      const rt = roomTypeById.get(str(u.roomTypeId));
      const beds = rt ? numOr(rt.beds, 0) : 0;
      return {
        name: str(u.name),
        roomType: rt ? str(rt.name) : null,
        beds,
        bedConfig: (u.bedConfig ?? (rt ? rt.bedConfig : null)) ?? null,
        size: (u.size ?? (rt ? rt.size : null)) ?? null,
      };
    });
    const out: StructOut = {
      id: sid,
      name: str(s.name),
      city: str(s.city),
      roomCount: rooms.length,
      bedCount: rooms.reduce((sum, r) => sum + (r.beds || 0), 0),
      rooms,
      members: [],
    };
    structures.push(out);
    if (sid) structByIdOut.set(sid, out);
  }

  // ── 4) Membri (collaboratori) per struttura ─────────────────────────────────
  const membersOther: Array<Member & { structureName: string }> = [];
  for (const oid of ownedOrgIds) {
    if (!oid) continue;
    // Collaboratori attivi di questa org.
    const { data: ms } = await admin.from("memberships").select("user_id,role,active").eq("org_id", oid);
    const memberIds = arr(ms)
      .filter((m) => m.role === "member" && m.active !== false)
      .map((m) => String(m.user_id || ""))
      .filter(Boolean);
    if (!memberIds.length) continue;

    // Struttura associata all'org (ultima riga org_invites per org_id).
    let inviteStructureId = "";
    let inviteStructureName = "";
    const { data: invs } = await admin.from("org_invites").select("structure_id,structure_name").eq("org_id", oid);
    const invRows = arr(invs);
    if (invRows.length) {
      const last = invRows[invRows.length - 1];
      inviteStructureId = str(last.structure_id);
      inviteStructureName = str(last.structure_name);
    }
    const targetStruct = inviteStructureId ? structByIdOut.get(inviteStructureId) : undefined;

    for (const mid of memberIds) {
      const { data: p } = await admin.from("profiles").select("full_name,email,phone").eq("user_id", mid).maybeSingle();
      const pj = (p || {}) as J;
      const member: Member = { id: mid, name: str(pj.full_name), email: str(pj.email), phone: (pj.phone as string) || null };
      if (targetStruct) targetStruct.members.push(member);
      else membersOther.push({ ...member, structureName: inviteStructureName });
    }
  }

  // ── 5) Abbonamento + fatture Stripe ─────────────────────────────────────────
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const stripe = stripeKey ? new Stripe(stripeKey) : null;
  const stripeCustomerId = (prof.stripe_customer_id as string) || null;

  let subStatus: string | null = (prof.subscription_status as string) || null;
  let periodEnd: string | null = null;
  let cancelAtPeriodEnd = false;
  let monthlyAmount: number | null = null;
  let currency: string | null = null;
  let totalPaid: number | null = null;
  let amountDue: number | null = null;
  interface InvoiceOut { id: string | null; number: string | null; date: string | null; amount: number; currency: string; status: string | null; paid: boolean; pdf: string | null; hostedUrl: string | null; description: string | null }
  let invoices: InvoiceOut[] = [];

  if (stripe && stripeCustomerId) {
    try {
      const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "all", limit: 1 });
      const sub = subs.data[0];
      if (sub) {
        const item = sub.items.data[0];
        const amt = item?.price?.unit_amount ?? null;
        const interval = item?.price?.recurring?.interval;
        monthlyAmount = amt == null ? null : (interval === "year" ? Math.round(amt / 12) : amt) / 100;
        const periodEndUnix = (item as unknown as { current_period_end?: number })?.current_period_end
          ?? (sub as unknown as { current_period_end?: number })?.current_period_end
          ?? null;
        periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;
        cancelAtPeriodEnd = !!sub.cancel_at_period_end;
        subStatus = sub.status;
        currency = item?.price?.currency ?? currency;
      }
    } catch { /* niente abbonamento */ }

    try {
      const invs = await stripe.invoices.list({ customer: stripeCustomerId, limit: 100 });
      let paidSum = 0, dueSum = 0;
      invoices = invs.data.map((i) => {
        paidSum += (i.amount_paid ?? 0) / 100;
        if (i.status === "open" || i.status === "uncollectible") dueSum += (i.amount_remaining ?? i.amount_due ?? 0) / 100;
        if (!currency && i.currency) currency = i.currency.toUpperCase();
        return {
          id: i.id ?? null,
          number: i.number || null,
          date: i.created ? new Date(i.created * 1000).toISOString() : null,
          amount: (i.amount_paid ?? i.amount_due ?? 0) / 100,
          currency: (i.currency || "eur").toUpperCase(),
          status: i.status || null,
          paid: i.status === "paid",
          pdf: i.invoice_pdf || null,
          hostedUrl: i.hosted_invoice_url || null,
          description: i.lines?.data?.[0]?.description || i.number || null,
        };
      });
      // Fatture in ordine di data decrescente (più recenti prima).
      invoices.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      totalPaid = paidSum;
      amountDue = dueSum;
    } catch { /* niente fatture */ }
  }

  // ── 6) Nota interna del back-office ─────────────────────────────────────────
  let note = "";
  let noteUpdatedAt: string | null = null;
  try {
    const { data: n } = await admin.from("admin_customer_notes").select("note,updated_at").eq("user_id", userId).maybeSingle();
    note = (n?.note as string) || "";
    noteUpdatedAt = (n?.updated_at as string) || null;
  } catch { /* nessuna nota */ }

  // ── Risposta ────────────────────────────────────────────────────────────────
  const account = {
    id: userId,
    email: authUser?.email ?? (prof.email as string) ?? null,
    name: (prof.full_name as string) || (authUser?.user_metadata?.full_name as string) || "",
    phone: (prof.phone as string) || (authUser?.user_metadata?.phone as string) || null,
    createdAt: authUser?.created_at ?? (prof.created_at as string) ?? null,
    lastActive: (prof.last_active as string) || authUser?.last_sign_in_at || null,
    emailConfirmed: !!authUser?.email_confirmed_at,
    plan: (prof.plan as string) || null,
    subStatus,
    periodEnd,
    cancelAtPeriodEnd,
    monthlyAmount,
    currency,
    totalPaid,
    amountDue,
    stripeCustomerId,
    structuresCount: structures.length,
    roomsCount: structures.reduce((sum, s) => sum + s.roomCount, 0),
  };

  return NextResponse.json({
    ok: true,
    stripeConfigured: !!stripe,
    account,
    structures,
    membersOther,
    invoices,
    note,
    noteUpdatedAt,
  });
}
