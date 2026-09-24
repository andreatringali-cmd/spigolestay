import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { estimatedStripeFeeCents } from "@/lib/payments/fee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_KEY = "spigolestay:data:v1";
type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);

// Trova la struttura (con eventuale stripeAccount) tra il personale del proprietario
// e le organizzazioni condivise di cui è membro.
async function findStructure(admin: SupabaseClient, ownerId: string, sid: string): Promise<Json | null> {
  const parse = (data: unknown): Json => { const blob = ((data ?? {}) as Record<string, string>) || {}; try { return JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { return {}; } };
  // 1) ORGANIZZAZIONI CONDIVISE per prime: sono la fonte di verità per le strutture in società
  //    (evita di prendere una copia personale vecchia con lo stripeAccount di test).
  const { data: ms } = await admin.from("memberships").select("org_id").eq("user_id", ownerId);
  let orgSt: Json | null = null;
  for (const m of arr(ms)) {
    const { data: os } = await admin.from("org_state").select("data").eq("org_id", m.org_id as string).maybeSingle();
    const found = arr(parse((os as { data?: unknown } | null)?.data).structures).find((s) => s.id === sid);
    if (found) { orgSt = found; if (found.stripeAccount) return found; }
  }
  // 2) personale
  const { data: row } = await admin.from("app_state").select("data").eq("user_id", ownerId).maybeSingle();
  const perSt = arr(parse((row as { data?: unknown } | null)?.data).structures).find((s) => s.id === sid) || null;
  if (perSt?.stripeAccount) return perSt;
  return orgSt || perSt;
}

// Crea la sessione di pagamento (caparra o totale) sul conto Stripe della struttura.
// Se la struttura non ha Stripe collegato o l'importo è 0 → { payment: false } (il client
// registra la prenotazione senza pagamento online, "paga in struttura").
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  try {
    const b = await req.json().catch(() => ({}));
    const slug = String(b?.slug || "").trim();
    const sid = String(b?.s || b?.structureId || "").trim();
    const rt = String(b?.rt || "").trim();
    const ci = String(b?.ci || "").trim(), co = String(b?.co || "").trim();
    const adults = Math.max(1, parseInt(String(b?.adults ?? "1"), 10) || 1);
    const children = Math.max(0, parseInt(String(b?.children ?? "0"), 10) || 0);
    const total = Math.round(Number(b?.total) || 0);
    const deposit = Math.round(Number(b?.deposit) || 0);
    const note = String(b?.note || "").slice(0, 480);
    const code = String(b?.code || "").slice(0, 40);
    const planName = String(b?.planName || "").slice(0, 60);
    const refundable = b?.refundable ? "1" : "0";
    const cancelDays = String(Math.max(0, parseInt(String(b?.cancelDays ?? "0"), 10) || 0));
    const g = (b?.guest ?? {}) as Record<string, string>;
    const token = String(b?.token || "").slice(0, 80) || (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
    if (!slug || !sid || !rt || !ci || !co) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: site } = await admin.from("public_sites").select("user_id, structure_id").eq("slug", slug).maybeSingle();
    const ownerId = (site?.user_id as string) || "";
    if (!ownerId) return NextResponse.json({ ok: false, error: "site_not_found" }, { status: 404 });

    const st = await findStructure(admin, ownerId, sid);
    const acct = st && typeof st.stripeAccount === "string" ? st.stripeAccount : "";
    const amount = deposit > 0 ? deposit : total; // caparra se prevista, altrimenti totale
    if (!key || !acct || amount <= 0) return NextResponse.json({ ok: true, payment: false, token });

    // Metadata: portano l'intera prenotazione fino alla conferma post-pagamento.
    const meta: Record<string, string> = {
      kind: "book", slug, s: sid, rt, ci, co, ad: String(adults), ch: String(children),
      tot: String(total), dep: String(deposit), note, code, token,
      rpn: planName, ref: refundable, cd: cancelDays,
      gn: `${g.firstName || ""} ${g.lastName || ""}`.trim(), ge: g.email || "", gp: g.phone || "", gc: g.country || "",
    };
    const stripe = new Stripe(key);
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    // "(caparra)" solo se è un acconto PARZIALE; se si paga l'intero importo non è una caparra.
    const isPartial = deposit > 0 && deposit < total;
    const label = `${st?.name || "Prenotazione"} · ${ci} → ${co}${isPartial ? " (caparra)" : ""}`;
    const success = `${origin}/prenota?site=${encodeURIComponent(slug)}&s=${encodeURIComponent(sid)}&paid=1&session_id={CHECKOUT_SESSION_ID}`;
    const cancel = `${origin}/prenota?site=${encodeURIComponent(slug)}&s=${encodeURIComponent(sid)}&canceled=1`;
    // DESTINATION CHARGE: addebito sulla piattaforma, fondi trasferiti alla struttura
    // (i direct charges non sono più supportati per piattaforme nuove con account Express).
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price_data: { currency: "eur", unit_amount: amount * 100, product_data: { name: label } }, quantity: 1 }],
      customer_email: g.email || undefined,
      metadata: meta,
      payment_intent_data: { metadata: meta, transfer_data: { destination: acct, amount: Math.max(0, amount * 100 - estimatedStripeFeeCents(amount * 100)) }, on_behalf_of: acct },
      success_url: success, cancel_url: cancel,
    });
    return NextResponse.json({ ok: true, payment: true, url: session.url, token });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "stripe_error" }, { status: 500 });
  }
}
