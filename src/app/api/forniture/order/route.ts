import { NextResponse } from "next/server";
import Stripe from "stripe";
import { authTenant, isResponse } from "@/lib/invoicing/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VAT_RATE = 22; // IVA forniture

interface ItemIn { productId: string; variantId?: string | null; qty: number; customization?: Record<string, unknown> | null }

// GET /api/forniture/order  → elenco ordini del tenant con righe.
export async function GET(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const { data: orders } = await auth.admin.from("supply_orders").select("*").eq("tenant_id", auth.tenantId).order("created_at", { ascending: false });
  const ids = (orders ?? []).map((o) => o.id);
  const { data: items } = ids.length ? await auth.admin.from("supply_order_items").select("*").in("order_id", ids) : { data: [] as unknown[] };
  return NextResponse.json({ ok: true, orders: orders ?? [], items: items ?? [] });
}

// POST /api/forniture/order  → crea un ordine (bozza o suggerito) e, se pay=true,
// crea la Checkout Session (pagamento alla PIATTAFORMA Xenora) e restituisce l'url.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const body = await req.json().catch(() => ({}));
  const structureId = String(body?.structureId || "").trim();
  const itemsIn = Array.isArray(body?.items) ? (body.items as ItemIn[]) : [];
  const suggestedFor = body?.suggestedFor ? String(body.suggestedFor).slice(0, 20) : null;
  const notes = body?.notes ? String(body.notes).slice(0, 500) : null;
  const pay = body?.pay === true;
  if (!structureId || !itemsIn.length) return NextResponse.json({ error: "missing_params" }, { status: 400 });

  // Prezzi AUTORITATIVI dal catalogo (mai fidarsi del client).
  const productIds = Array.from(new Set(itemsIn.map((i) => i.productId).filter(Boolean)));
  const { data: prods } = await auth.admin.from("supply_products").select("id, sku, name, sale_price_cents, min_order_qty, active").in("id", productIds);
  const byId = new Map((prods ?? []).map((p) => [p.id as string, p]));

  const rows: { product_id: string; variant_id: string | null; qty: number; unit_price_cents: number; customization: Record<string, unknown> | null }[] = [];
  let subtotal = 0;
  for (const it of itemsIn) {
    const p = byId.get(it.productId);
    if (!p || p.active === false) continue;
    const qty = Math.max(Number(p.min_order_qty) || 1, Math.floor(Number(it.qty) || 0));
    if (qty <= 0) continue;
    const unit = Number(p.sale_price_cents) || 0;
    subtotal += unit * qty;
    rows.push({ product_id: it.productId, variant_id: it.variantId || null, qty, unit_price_cents: unit, customization: it.customization ?? null });
  }
  if (!rows.length) return NextResponse.json({ error: "no_valid_items" }, { status: 400 });

  const vat = Math.round(subtotal * VAT_RATE / 100);
  const total = subtotal + vat;
  const status = pay ? "pending_payment" : (suggestedFor ? "draft" : "draft");

  const { data: order, error: oErr } = await auth.admin.from("supply_orders").insert({
    tenant_id: auth.tenantId, structure_id: structureId, status,
    subtotal_cents: subtotal, vat_cents: vat, total_cents: total,
    suggested_for: suggestedFor, notes,
  }).select("id").single();
  if (oErr || !order?.id) return NextResponse.json({ error: "order_failed", message: oErr?.message }, { status: 500 });

  const itemRows = rows.map((r) => ({ ...r, order_id: order.id }));
  const { error: iErr } = await auth.admin.from("supply_order_items").insert(itemRows);
  if (iErr) return NextResponse.json({ error: "items_failed", message: iErr.message }, { status: 500 });

  if (!pay) return NextResponse.json({ ok: true, orderId: order.id, subtotal, vat, total });

  // Pagamento alla piattaforma Xenora (nessun account collegato: l'incasso è di Xenora).
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ ok: true, orderId: order.id, subtotal, vat, total, warning: "stripe_not_configured" });
  try {
    const stripe = new Stripe(key);
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price_data: { currency: "eur", unit_amount: total, product_data: { name: `Forniture Xenora · ordine ${order.id.slice(0, 8)}` } }, quantity: 1 }],
      metadata: { kind: "supply_order", order_id: order.id, tenant_id: auth.tenantId },
      payment_intent_data: { metadata: { kind: "supply_order", order_id: order.id } },
      success_url: `${origin}/forniture?paid=1&order=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/forniture?canceled=1&order=${order.id}`,
    });
    await auth.admin.from("supply_orders").update({ stripe_payment_intent_id: null, updated_at: new Date().toISOString() }).eq("id", order.id);
    return NextResponse.json({ ok: true, orderId: order.id, total, url: session.url });
  } catch (e) {
    return NextResponse.json({ ok: true, orderId: order.id, total, warning: (e as Error)?.message });
  }
}
