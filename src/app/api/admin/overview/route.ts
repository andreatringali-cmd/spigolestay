import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Back-office (super-admin) di Xenora: elenco di TUTTI gli utenti con piano, strutture/camere,
// stato pagamento e scadenze. Accesso riservato: solo le email in ADMIN_EMAILS (default: il titolare).
// Usa la SUPABASE_SERVICE_ROLE_KEY lato server (mai esposta al browser) per leggere auth.users +
// profiles + referrals, e Stripe (se configurato) per stato abbonamento e prossimo rinnovo.

const OWNER_EMAILS = (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

interface Row {
  id: string; email: string | null; name: string; phone: string | null; createdAt: string | null;
  lastSignIn: string | null; lastActive: string | null;
  emailConfirmed: boolean; plan: string | null; structures: number; rooms: number; structureNames: string;
  stripeCustomerId: string | null; subStatus: string | null; periodEnd: string | null;
  cancelAtPeriodEnd: boolean; monthlyAmount: number | null; currency: string | null;
  invitedCount: number; referredByCode: string | null;
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });

  // Identità del chiamante (token Supabase passato dal browser)
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  const caller = who?.user;
  if (whoErr || !caller?.email || !OWNER_EMAILS.includes(caller.email.toLowerCase()))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 1) Utenti auth (paginati)
  type AuthUser = { id: string; email?: string; created_at?: string; last_sign_in_at?: string | null; email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> };
  const users: AuthUser[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    users.push(...(data.users as unknown as AuthUser[]));
    if (data.users.length < 200) break;
  }

  // 2) Profiles
  const { data: profiles } = await admin.from("profiles").select("*");
  const profById = new Map<string, Record<string, unknown>>();
  (profiles || []).forEach((p) => profById.set(p.user_id as string, p as Record<string, unknown>));

  // 3) Referrals (quanti invitati per invitante + chi ha invitato ciascuno)
  const { data: referrals } = await admin.from("referrals").select("*");
  const invitedByInviter = new Map<string, number>();
  const referredBy = new Map<string, string>();
  (referrals || []).forEach((r) => {
    invitedByInviter.set(r.inviter_id as string, (invitedByInviter.get(r.inviter_id as string) || 0) + 1);
    referredBy.set(r.invited_id as string, r.code as string);
  });

  // 4) Stripe (best-effort): stato abbonamento + prossimo rinnovo per cliente
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const stripe = stripeKey ? new Stripe(stripeKey) : null;
  type SInfo = { status: string | null; periodEnd: string | null; cancel: boolean; monthly: number | null; currency: string | null };
  const stripeInfo = new Map<string, SInfo>();
  if (stripe) {
    const custIds = Array.from(new Set((profiles || []).map((p) => p.stripe_customer_id).filter(Boolean))) as string[];
    for (const cid of custIds.slice(0, 300)) {
      try {
        const subs = await stripe.subscriptions.list({ customer: cid, status: "all", limit: 1 });
        const s = subs.data[0];
        if (!s) { stripeInfo.set(cid, { status: null, periodEnd: null, cancel: false, monthly: null, currency: null }); continue; }
        const item = s.items.data[0];
        const amt = item?.price?.unit_amount ?? null;
        const interval = item?.price?.recurring?.interval;
        const monthly = amt == null ? null : (interval === "year" ? Math.round(amt / 12) : amt) / 100;
        // In API recenti il periodo è a livello di item; fallback su eventuale campo legacy della subscription.
        const periodEndUnix = (item as unknown as { current_period_end?: number })?.current_period_end
          ?? (s as unknown as { current_period_end?: number })?.current_period_end
          ?? null;
        stripeInfo.set(cid, {
          status: s.status,
          periodEnd: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
          cancel: !!s.cancel_at_period_end,
          monthly,
          currency: item?.price?.currency ?? null,
        });
      } catch { /* salta questo cliente */ }
    }
  }

  const rows: Row[] = users.map((u) => {
    const p = profById.get(u.id) || {};
    const cid = (p.stripe_customer_id as string) || null;
    const si = cid ? stripeInfo.get(cid) : undefined;
    return {
      id: u.id,
      email: u.email ?? (p.email as string) ?? null,
      name: (p.full_name as string) || (u.user_metadata?.full_name as string) || "",
      phone: (p.phone as string) || (u.user_metadata?.phone as string) || null,
      createdAt: u.created_at ?? null,
      lastSignIn: u.last_sign_in_at ?? null,
      lastActive: (p.last_active as string) || u.last_sign_in_at || null,
      emailConfirmed: !!u.email_confirmed_at,
      plan: (p.plan as string) || null,
      structures: (p.structures_count as number) ?? 0,
      rooms: (p.rooms_count as number) ?? 0,
      structureNames: (p.structure_names as string) || "",
      stripeCustomerId: cid,
      subStatus: si?.status ?? (p.subscription_status as string) ?? null,
      periodEnd: si?.periodEnd ?? null,
      cancelAtPeriodEnd: si?.cancel ?? false,
      monthlyAmount: si?.monthly ?? null,
      currency: si?.currency ?? null,
      invitedCount: invitedByInviter.get(u.id) || 0,
      referredByCode: referredBy.get(u.id) || null,
    };
  });

  // Ordina per data registrazione (più recenti prima)
  rows.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  return NextResponse.json({
    rows,
    stripeConfigured: !!stripe,
    generatedAt: new Date().toISOString(),
  });
}
