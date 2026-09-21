"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/invoicing/client";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";
import { forecastConsumption } from "@/lib/forniture/forecast";
import { productImage } from "@/lib/forniture/image";
import { getCart, setQty as cartSetQty, clearCart, onCartChange, type CartItem } from "@/lib/forniture/cart";

interface Category { id: string; slug: string; name: string; sort_order: number; phase: number }
interface Product {
  id: string; category_id: string | null; sku: string; name: string; description?: string; unit?: string;
  pack_size: number; sale_price_cents: number; min_order_qty: number; customizable: boolean; customization_type: string;
  consumption_per_arrival: number; consumption_per_guest_night: number; active: boolean; phase: number; image_url?: string | null;
}
interface Variant { id: string; product_id: string; name: string; value: string }
interface Rule { product_id: string; enabled: boolean; safety_stock: number; horizon_days: number }
interface Stock { product_id: string; qty_on_hand: number }
interface OrderRow { id: string; structure_id: string; status: string; total_cents: number; suggested_for?: string | null; created_at: string }

const c = (n: number) => eur(n / 100);
const STATUS_LABEL: Record<string, string> = {
  draft: "Bozza", pending_payment: "Da pagare", paid: "Pagato", processing: "In lavorazione",
  shipped: "Spedito", delivered: "Consegnato", cancelled: "Annullato",
};

export default function ForniturePage() {
  const router = useRouter();
  const { structures, bookings, activeStructureId } = useData();
  const [tab, setTab] = useState<"catalogo" | "riordino" | "ordini">("catalogo");
  const [cats, setCats] = useState<Category[]>([]);
  const [prods, setProds] = useState<Product[]>([]);
  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [stock, setStock] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [localStruct, setLocalStruct] = useState("");
  const [horizon, setHorizon] = useState(30);
  const [msg, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [catFilter, setCatFilter] = useState<string>("");

  const structId = activeStructureId !== "all" ? activeStructureId : (localStruct || structures[0]?.id || "");

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      const [cRes, pRes, ruRes, stRes] = await Promise.all([
        supabase.from("supply_categories").select("*").order("sort_order"),
        supabase.from("supply_products").select("*"),
        supabase.from("supply_reorder_rules").select("product_id, enabled, safety_stock, horizon_days"),
        supabase.from("supply_stock_levels").select("product_id, qty_on_hand"),
      ]);
      setCats((cRes.data as Category[]) ?? []);
      setProds((pRes.data as Product[]) ?? []);
      const rr: Record<string, Rule> = {}; for (const r of (ruRes.data ?? []) as Rule[]) rr[r.product_id] = r; setRules(rr);
      const ss: Record<string, number> = {}; for (const s of (stRes.data ?? []) as Stock[]) ss[s.product_id] = Number(s.qty_on_hand) || 0; setStock(ss);
    })();
    loadOrders();
    setCart(getCart());
    return onCartChange(() => setCart(getCart()));
  }, []);

  const loadOrders = async () => {
    try {
      if (!supabase) return;
      const { data } = await supabase.from("supply_orders").select("id, structure_id, status, total_cents, suggested_for, created_at").order("created_at", { ascending: false });
      setOrders((data as OrderRow[]) ?? []);
    } catch { /* niente */ }
  };

  // Ritorno da Stripe.
  useEffect(() => {
    const u = new URL(window.location.href);
    const paid = u.searchParams.get("paid"); const order = u.searchParams.get("order"); const sid = u.searchParams.get("session_id");
    if (paid === "1" && order && sid) {
      apiPost("forniture/confirm", { order, session_id: sid }).then(() => { setMsg("Pagamento ricevuto ✓ ordine confermato"); clearCart(); loadOrders(); })
        .catch((e) => setMsg(e instanceof Error ? e.message : "errore conferma"))
        .finally(() => window.history.replaceState({}, "", "/forniture"));
    } else if (u.searchParams.get("canceled") === "1") {
      setMsg("Pagamento annullato."); window.history.replaceState({}, "", "/forniture");
    }
  }, []);

  const activeProds = useMemo(() => prods.filter((p) => p.active), [prods]);
  const catBySlug = (id: string | null) => cats.find((x) => x.id === id);
  const catName = (id: string | null) => catBySlug(id)?.name ?? "Altro";
  const prodById = (id: string) => prods.find((p) => p.id === id);

  const cartLines = Object.values(cart).filter((x) => x.qty > 0);
  const cartTotals = useMemo(() => {
    let sub = 0;
    for (const l of cartLines) { const p = prodById(l.productId); if (p) sub += p.sale_price_cents * l.qty; }
    const vat = Math.round(sub * 0.22); return { sub, vat, tot: sub + vat };
  }, [cart, prods]);

  const checkout = async (pay: boolean) => {
    if (!structId) { setMsg("Seleziona una struttura."); return; }
    if (!cartLines.length) { setMsg("Il carrello è vuoto."); return; }
    setBusy(true); setMsg("");
    try {
      const items = cartLines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty, customization: l.customization }));
      const j = await apiPost<{ ok: boolean; url?: string; orderId?: string }>("forniture/order", { structureId: structId, items, pay });
      if (pay && j.url) { window.location.href = j.url; return; }
      setMsg("Ordine salvato in bozza ✓"); clearCart(); loadOrders();
    } catch (e) { setMsg(e instanceof Error ? e.message : "errore"); }
    finally { setBusy(false); }
  };

  const toggleRule = async (p: Product, enabled: boolean) => {
    if (!supabase || !structId) return;
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const row = { tenant_id: uid, structure_id: structId, product_id: p.id, enabled, safety_stock: rules[p.id]?.safety_stock ?? 0, horizon_days: horizon };
    await supabase.from("supply_reorder_rules").upsert(row, { onConflict: "structure_id,product_id" });
    setRules((prev) => ({ ...prev, [p.id]: { product_id: p.id, enabled, safety_stock: prev[p.id]?.safety_stock ?? 0, horizon_days: horizon } }));
  };

  const reorderLines = useMemo(() => {
    if (!structId) return [];
    const enabledRules = Object.values(rules).filter((r) => r.enabled).map((r) => ({ product_id: r.product_id, enabled: true, safety_stock: r.safety_stock, horizon_days: horizon }));
    return forecastConsumption({
      structureId: structId, today: new Date().toISOString().slice(0, 10), horizonDays: horizon,
      bookings: bookings.map((b) => ({ structureId: b.structureId, checkIn: b.checkIn, checkOut: b.checkOut, status: b.status, adults: b.adults, children: b.children })),
      products: activeProds.map((p) => ({ id: p.id, pack_size: p.pack_size, consumption_per_arrival: p.consumption_per_arrival, consumption_per_guest_night: p.consumption_per_guest_night })),
      rules: enabledRules,
      stock: Object.entries(stock).map(([product_id, qty_on_hand]) => ({ product_id, qty_on_hand })),
    });
  }, [structId, rules, horizon, bookings, activeProds, stock]);

  const createSuggested = async () => {
    if (!reorderLines.length) { setMsg("Nessun fabbisogno previsto."); return; }
    setBusy(true); setMsg("");
    try {
      const items = reorderLines.map((l) => ({ productId: l.product_id, qty: l.qty }));
      const month = new Date().toISOString().slice(0, 7);
      await apiPost("forniture/order", { structureId: structId, items, suggestedFor: month });
      setMsg("Ordine suggerito creato in bozza ✓"); loadOrders(); setTab("ordini");
    } catch (e) { setMsg(e instanceof Error ? e.message : "errore"); }
    finally { setBusy(false); }
  };

  const reorderable = activeProds.filter((p) => p.consumption_per_arrival > 0 || p.consumption_per_guest_night > 0);
  const shownCats = cats.filter((cat) => activeProds.some((p) => p.category_id === cat.id) && (!catFilter || cat.id === catFilter));

  return (
    <>
      <PageHeader title="Forniture" subtitle="Il negozio delle tue strutture: consumabili e cortesia, con riordino suggerito dagli arrivi" />

      {msg && <div className="mb-4 rounded-lg border border-line bg-wash px-3 py-2 text-sm font-medium text-txt">{msg}</div>}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {(["catalogo", "riordino", "ordini"] as const).map((tk) => (
            <button key={tk} onClick={() => setTab(tk)} className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize transition ${tab === tk ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{tk}</button>
          ))}
        </div>
        {activeStructureId === "all" && (
          <select value={localStruct} onChange={(e) => setLocalStruct(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt">
            <option value="">Struttura…</option>
            {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {tab === "catalogo" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            {/* filtro categorie */}
            <div className="mb-4 flex flex-wrap gap-2">
              <button onClick={() => setCatFilter("")} className={`rounded-full px-3 py-1 text-xs font-semibold ${!catFilter ? "bg-focus text-white" : "border border-line text-dim hover:bg-wash"}`}>Tutte</button>
              {cats.filter((cat) => activeProds.some((p) => p.category_id === cat.id)).map((cat) => (
                <button key={cat.id} onClick={() => setCatFilter(cat.id)} className={`rounded-full px-3 py-1 text-xs font-semibold ${catFilter === cat.id ? "bg-focus text-white" : "border border-line text-dim hover:bg-wash"}`}>{cat.name}</button>
              ))}
            </div>

            {shownCats.map((cat) => (
              <div key={cat.id} className="mb-6">
                <SectionTitle>{cat.name}</SectionTitle>
                <div className="mt-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {activeProds.filter((p) => p.category_id === cat.id).map((p) => (
                    <button key={p.id} onClick={() => router.push(`/forniture/${p.sku}`)} className="group overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-wash">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={productImage(p, cat.slug)} alt={p.name} className="h-full w-full object-cover transition group-hover:scale-[1.03]" loading="lazy" />
                        {p.customizable && <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">Personalizzabile</span>}
                      </div>
                      <div className="p-3">
                        <div className="text-sm font-bold text-txt">{p.name}</div>
                        {p.description && <div className="mt-0.5 line-clamp-2 text-xs text-dim">{p.description}</div>}
                        <div className="mt-2 flex items-center justify-between">
                          <span className="font-mono text-sm font-bold text-txt">{c(p.sale_price_cents)}</span>
                          <span className="text-[11px] text-faint">conf. {p.pack_size} {p.unit || "pz"}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* carrello */}
          <div>
            <Card className="sticky top-4">
              <div className="flex items-center gap-2 text-sm font-bold text-txt"><Icon name="box" size={16} /> Carrello {cartLines.length > 0 && <span className="ml-auto rounded-full bg-focus px-2 py-0.5 text-[11px] text-white">{cartLines.length}</span>}</div>
              {cartLines.length === 0 ? (
                <div className="mt-3 text-xs text-dim">Apri un prodotto e aggiungilo al carrello.</div>
              ) : (
                <div className="mt-3 space-y-2">
                  {cartLines.map((l) => {
                    const p = prodById(l.productId); if (!p) return null;
                    return (
                      <div key={`${l.productId}::${l.variantId ?? ""}`} className="flex items-center gap-2 text-xs">
                        <div className="min-w-0 flex-1"><div className="truncate font-semibold text-txt">{p.name}</div>{l.customization?.text ? <div className="truncate text-faint">✎ {String(l.customization.text)}</div> : null}</div>
                        <input type="number" min={0} step={p.min_order_qty} value={l.qty} onChange={(e) => cartSetQty(l.productId, parseInt(e.target.value) || 0, l.variantId)} className="w-16 rounded border border-line bg-surface px-1.5 py-1 text-right" />
                        <span className="w-16 text-right font-mono">{c(p.sale_price_cents * l.qty)}</span>
                      </div>
                    );
                  })}
                  <div className="mt-2 border-t border-line pt-2 text-xs">
                    <div className="flex justify-between text-dim"><span>Imponibile</span><span className="font-mono">{c(cartTotals.sub)}</span></div>
                    <div className="flex justify-between text-dim"><span>IVA 22%</span><span className="font-mono">{c(cartTotals.vat)}</span></div>
                    <div className="mt-1 flex justify-between text-sm font-bold text-txt"><span>Totale</span><span className="font-mono">{c(cartTotals.tot)}</span></div>
                  </div>
                  <button onClick={() => checkout(true)} disabled={busy} className="mt-2 w-full rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">Paga con Stripe</button>
                  <button onClick={() => checkout(false)} disabled={busy} className="w-full rounded-lg border border-line px-3 py-2 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-40">Salva come bozza</button>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === "riordino" && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="text-sm text-dim">Orizzonte</label>
            <select value={horizon} onChange={(e) => setHorizon(parseInt(e.target.value))} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt">
              <option value={30}>30 giorni</option><option value={60}>60 giorni</option><option value={90}>90 giorni</option>
            </select>
            <span className="text-xs text-faint">Attiva la regola sui prodotti che vuoi riordinare automaticamente.</span>
          </div>

          <Card className="mb-4 !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-dim">
                <th className="px-3 py-2">Prodotto</th><th className="px-3 py-2">Regola</th><th className="px-3 py-2 text-right">Scorta</th>
                <th className="px-3 py-2 text-right">Fabbisogno</th><th className="px-3 py-2 text-right">Da ordinare</th>
              </tr></thead>
              <tbody>
                {reorderable.map((p) => {
                  const line = reorderLines.find((l) => l.product_id === p.id);
                  const r = rules[p.id];
                  return (
                    <tr key={p.id} className="border-b border-line/60">
                      <td className="px-3 py-2"><div className="font-semibold text-txt">{p.name}</div><div className="text-[11px] text-faint">{catName(p.category_id)}</div></td>
                      <td className="px-3 py-2">
                        <label className="inline-flex cursor-pointer items-center gap-2">
                          <input type="checkbox" checked={!!r?.enabled} onChange={(e) => toggleRule(p, e.target.checked)} />
                          <span className="text-xs text-dim">{r?.enabled ? "Attiva" : "Off"}</span>
                        </label>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{r?.safety_stock ?? 0}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{line ? line.need : (r?.enabled ? 0 : "—")}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-txt">{line ? `${line.qty} ${p.unit || "pz"}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <button onClick={createSuggested} disabled={busy || !reorderLines.length} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">
            Crea ordine suggerito ({reorderLines.length} prodotti)
          </button>
        </div>
      )}

      {tab === "ordini" && (
        <Card className="!p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-dim">
              <th className="px-3 py-2">Data</th><th className="px-3 py-2">Struttura</th><th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Stato</th><th className="px-3 py-2 text-right">Totale</th>
            </tr></thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-dim">Nessun ordine.</td></tr>}
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-line/60">
                  <td className="px-3 py-2 text-xs">{new Date(o.created_at).toLocaleDateString("it-IT")}</td>
                  <td className="px-3 py-2 text-xs">{structures.find((s) => s.id === o.structure_id)?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{o.suggested_for ? `Suggerito ${o.suggested_for}` : "Manuale"}</td>
                  <td className="px-3 py-2 text-xs"><span className="rounded-full bg-wash px-2 py-0.5 font-semibold text-dim">{STATUS_LABEL[o.status] ?? o.status}</span></td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-txt">{c(o.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
