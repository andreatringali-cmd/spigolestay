"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/invoicing/client";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";
import { forecastConsumption, estimateStock, stockState, reorderQty, type StockState } from "@/lib/forniture/forecast";
import { useConfirm } from "@/components/ConfirmProvider";
import { productImage } from "@/lib/forniture/image";
import { getCart, setQty as cartSetQty, clearCart, onCartChange, addToCart, type CartItem } from "@/lib/forniture/cart";

interface Category { id: string; slug: string; name: string; sort_order: number; phase: number }
interface Product {
  id: string; category_id: string | null; sku: string; name: string; description?: string; unit?: string;
  pack_size: number; sale_price_cents: number; min_order_qty: number; customizable: boolean; customization_type: string;
  consumption_per_arrival: number; consumption_per_guest_night: number; active: boolean; phase: number; image_url?: string | null;
}
interface Variant { id: string; product_id: string; name: string; value: string }
interface Rule { product_id: string; enabled: boolean; safety_stock: number; horizon_days: number }
interface Stock { product_id: string; qty_on_hand: number; updated_at?: string | null }
interface StockRow { qty: number; at: string | null }
interface OrderRow { id: string; structure_id: string; status: string; subtotal_cents?: number; vat_cents?: number; total_cents: number; suggested_for?: string | null; delivery_date?: string | null; created_at: string; updated_at?: string | null }
interface OrderItem { id: string; order_id: string; product_id: string; qty: number; unit_price_cents: number }

const c = (n: number) => eur(n / 100);
const ORDER_OPEN = ["paid", "processing", "shipped"];
const STATUS_LABEL: Record<string, string> = {
  draft: "Bozza", pending_payment: "Da pagare", paid: "Pagato", processing: "In lavorazione",
  shipped: "Spedito", delivered: "Consegnato", cancelled: "Annullato",
};

export default function ForniturePage() {
  const router = useRouter();
  const ask = useConfirm();
  const { structures, bookings, activeStructureId } = useData();
  const [tab, setTab] = useState<"catalogo" | "scorte" | "riordino" | "ordini">("catalogo");
  const [cats, setCats] = useState<Category[]>([]);
  const [prods, setProds] = useState<Product[]>([]);
  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [stockRows, setStockRows] = useState<Record<string, StockRow>>({});
  const [onlyLow, setOnlyLow] = useState(false);
  const [orderFilter, setOrderFilter] = useState("all");
  const [openOrder, setOpenOrder] = useState<string>("");
  const [orderItems, setOrderItems] = useState<Record<string, OrderItem[]>>({});
  const [invoiced, setInvoiced] = useState<Record<string, boolean>>({});
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [localStruct, setLocalStruct] = useState("");
  const [horizon, setHorizon] = useState(30);
  const [msg, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [catFilter, setCatFilter] = useState<string>("");

  // Con "Tutte le strutture" serve sceglierne una (checkout/riordino/scorte sono per singola struttura): niente ripiego silenzioso sulla prima.
  const structId = activeStructureId !== "all" ? activeStructureId : localStruct;

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      const [cRes, pRes] = await Promise.all([
        supabase.from("supply_categories").select("*").order("sort_order"),
        supabase.from("supply_products").select("*"),
      ]);
      setCats((cRes.data as Category[]) ?? []);
      setProds((pRes.data as Product[]) ?? []);
    })();
    loadOrders();
    setCart(getCart());
    return onCartChange(() => setCart(getCart()));
  }, []);

  // Regole di riordino e scorte sono PER STRUTTURA: si ricaricano al cambio della struttura selezionata.
  useEffect(() => {
    let alive = true;
    setRules({}); setStockRows({});
    (async () => {
      if (!supabase || !structId) return;
      const [ruRes, stRes] = await Promise.all([
        supabase.from("supply_reorder_rules").select("product_id, enabled, safety_stock, horizon_days").eq("structure_id", structId),
        supabase.from("supply_stock_levels").select("product_id, qty_on_hand, updated_at").eq("structure_id", structId),
      ]);
      if (!alive) return;
      const rr: Record<string, Rule> = {}; for (const r of (ruRes.data ?? []) as Rule[]) rr[r.product_id] = r; setRules(rr);
      const ss: Record<string, StockRow> = {}; for (const s of (stRes.data ?? []) as Stock[]) ss[s.product_id] = { qty: Number(s.qty_on_hand) || 0, at: s.updated_at ? String(s.updated_at).slice(0, 10) : null }; setStockRows(ss);
    })();
    return () => { alive = false; };
  }, [structId]);

  const loadOrders = async () => {
    try {
      if (!supabase) return;
      const { data } = await supabase.from("supply_orders").select("id, structure_id, status, subtotal_cents, vat_cents, total_cents, suggested_for, delivery_date, created_at, updated_at").order("created_at", { ascending: false });
      setOrders((data as OrderRow[]) ?? []);
      // Quali ordini sono già stati registrati come fattura passiva (numero documento FOR-xxxxxxxx).
      const { data: docs } = await supabase.from("purchase_documents").select("doc_number").like("doc_number", "FOR-%");
      const m: Record<string, boolean> = {}; for (const d of (docs ?? []) as { doc_number: string | null }[]) if (d.doc_number) m[d.doc_number] = true;
      setInvoiced(m);
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

  const today = new Date().toISOString().slice(0, 10);
  const fcBookings = useMemo(() => bookings.map((b) => ({ structureId: b.structureId, checkIn: b.checkIn, checkOut: b.checkOut, status: b.status, adults: b.adults, children: b.children })), [bookings]);

  // Scorte: giacenza contata + consumo stimato dalle prenotazioni dalla data del conteggio.
  const stockInfo = useMemo(() => {
    const out: { p: Product; counted: number; at: string | null; min: number; estimated: number; consumed: number; dailyRate: number; coverage: number | null; state: StockState }[] = [];
    if (!structId) return out;
    for (const p of activeProds) {
      const hasStock = !!stockRows[p.id]; const min = Number(rules[p.id]?.safety_stock) || 0;
      const consumable = p.consumption_per_arrival > 0 || p.consumption_per_guest_night > 0;
      if (!consumable && !hasStock && min <= 0) continue;
      const row = stockRows[p.id];
      const e = estimateStock({ bookings: fcBookings, structureId: structId, product: p, counted: row?.qty ?? 0, countedAtISO: row?.at ?? null, todayISO: today, horizonDays: horizon });
      out.push({ p, counted: row?.qty ?? 0, at: row?.at ?? null, min, estimated: e.estimated, consumed: e.consumed, dailyRate: e.dailyRate, coverage: e.coverageDays, state: stockState(e.estimated, min, hasStock || min > 0) });
    }
    return out;
  }, [structId, activeProds, stockRows, rules, fcBookings, today, horizon]);
  const lowRows = useMemo(() => stockInfo.filter((r) => r.state === "low" || r.state === "out"), [stockInfo]);

  const saveStock = async (p: Product, qty: number) => {
    if (!supabase || !structId) return;
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const nowIso = new Date().toISOString();
    const { error } = await supabase.from("supply_stock_levels").upsert({ tenant_id: uid, structure_id: structId, product_id: p.id, qty_on_hand: qty, updated_at: nowIso }, { onConflict: "structure_id,product_id" });
    if (error) { setMsg(`Salvataggio scorta non riuscito: ${error.message}`); return; }
    setStockRows((prev) => ({ ...prev, [p.id]: { qty, at: nowIso.slice(0, 10) } }));
  };
  const saveMin = async (p: Product, min: number) => {
    if (!supabase || !structId) return;
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const cur = rules[p.id];
    const row = { tenant_id: uid, structure_id: structId, product_id: p.id, enabled: cur?.enabled ?? false, safety_stock: min, horizon_days: cur?.horizon_days ?? horizon };
    const { error } = await supabase.from("supply_reorder_rules").upsert(row, { onConflict: "structure_id,product_id" });
    if (error) { setMsg(`Salvataggio soglia non riuscito: ${error.message}`); return; }
    setRules((prev) => ({ ...prev, [p.id]: { product_id: p.id, enabled: row.enabled, safety_stock: min, horizon_days: row.horizon_days } }));
  };
  // Aggiunge al carrello i prodotti sotto soglia, con quantità che coprono l'orizzonte + soglia.
  const addLowToCart = () => {
    let n = 0;
    for (const r of lowRows) {
      const q = reorderQty({ estimated: r.estimated, min: r.min, dailyRate: r.dailyRate, horizonDays: horizon, packSize: r.p.pack_size, minOrderQty: r.p.min_order_qty });
      if (q > 0) { addToCart(r.p.id, q); n++; }
    }
    setMsg(n ? `${n} prodotti aggiunti al carrello: controlla le quantità e conferma l'ordine.` : "Nessuna quantità da ordinare.");
    if (n) setTab("catalogo");
  };

  const reorderLines = useMemo(() => {
    if (!structId) return [];
    const enabledRules = Object.values(rules).filter((r) => r.enabled).map((r) => ({ product_id: r.product_id, enabled: true, safety_stock: r.safety_stock, horizon_days: horizon }));
    return forecastConsumption({
      structureId: structId, today, horizonDays: horizon,
      bookings: fcBookings,
      products: activeProds.map((p) => ({ id: p.id, pack_size: p.pack_size, consumption_per_arrival: p.consumption_per_arrival, consumption_per_guest_night: p.consumption_per_guest_night })),
      rules: enabledRules,
      stock: stockInfo.map((r) => ({ product_id: r.p.id, qty_on_hand: r.estimated })),
    });
  }, [structId, rules, horizon, fcBookings, today, activeProds, stockInfo]);

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

  const shownOrders = useMemo(() => orders.filter((o) => (activeStructureId === "all" || o.structure_id === activeStructureId) && (orderFilter === "all" || o.status === orderFilter)), [orders, activeStructureId, orderFilter]);
  const orderStats = useMemo(() => {
    const scoped = orders.filter((o) => activeStructureId === "all" || o.structure_id === activeStructureId);
    const yr = String(new Date().getFullYear());
    const spent = scoped.filter((o) => ["paid", "processing", "shipped", "delivered"].includes(o.status) && o.created_at.startsWith(yr)).reduce((a, o) => a + o.total_cents, 0);
    return { spent, open: scoped.filter((o) => ORDER_OPEN.includes(o.status)).length, drafts: scoped.filter((o) => o.status === "draft").length, pending: scoped.filter((o) => o.status === "pending_payment").length };
  }, [orders, activeStructureId]);
  const docNumberOf = (o: OrderRow) => `FOR-${o.id.slice(0, 8).toUpperCase()}`;
  const structOf = (id: string) => structures.find((x) => x.id === id)?.name ?? "—";

  const toggleOrder = async (o: OrderRow) => {
    if (openOrder === o.id) { setOpenOrder(""); return; }
    setOpenOrder(o.id);
    if (!supabase || orderItems[o.id]) return;
    const { data } = await supabase.from("supply_order_items").select("id, order_id, product_id, qty, unit_price_cents").eq("order_id", o.id);
    setOrderItems((prev) => ({ ...prev, [o.id]: (data ?? []) as OrderItem[] }));
  };
  const fetchItems = async (orderId: string): Promise<OrderItem[]> => {
    if (orderItems[orderId]) return orderItems[orderId];
    if (!supabase) return [];
    const { data } = await supabase.from("supply_order_items").select("id, order_id, product_id, qty, unit_price_cents").eq("order_id", orderId);
    const list = (data ?? []) as OrderItem[];
    setOrderItems((prev) => ({ ...prev, [orderId]: list }));
    return list;
  };
  const orderToCart = async (o: OrderRow) => {
    const items = await fetchItems(o.id);
    let n = 0;
    for (const it of items) { if (prodById(it.product_id)?.active) { addToCart(it.product_id, it.qty); n++; } }
    setMsg(n ? `${n} prodotti dell'ordine rimessi nel carrello.` : "Nessun prodotto ancora disponibile a catalogo.");
    if (n) setTab("catalogo");
  };
  const deleteDraft = async (o: OrderRow) => {
    if (!supabase || o.status !== "draft") return;
    if (!(await ask({ message: "Eliminare questa bozza d'ordine?", danger: true, confirmLabel: "Elimina" }))) return;
    await supabase.from("supply_order_items").delete().eq("order_id", o.id);
    const { error } = await supabase.from("supply_orders").delete().eq("id", o.id).eq("status", "draft");
    if (error) { setMsg(error.message); return; }
    setMsg("Bozza eliminata."); loadOrders();
  };
  // Consegna: carica a magazzino le quantità dell'ordine sopra la giacenza stimata del momento
  // (così il consumo trascorso dal conteggio precedente non va perso) e chiude l'ordine.
  const receiveOrder = async (o: OrderRow) => {
    if (!supabase || !ORDER_OPEN.includes(o.status)) return;
    if (!(await ask({ title: "Segna come consegnato", message: `Confermi la consegna dell'ordine? Le quantità verranno caricate a magazzino per ${structOf(o.structure_id)}.`, confirmLabel: "Consegnato e carica" }))) return;
    setBusy(true); setMsg("");
    try {
      const items = await fetchItems(o.id);
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const { data: cur } = await supabase.from("supply_stock_levels").select("product_id, qty_on_hand, updated_at").eq("structure_id", o.structure_id);
      const by: Record<string, Stock> = {}; for (const r of (cur ?? []) as Stock[]) by[r.product_id] = r;
      const add: Record<string, number> = {}; for (const it of items) add[it.product_id] = (add[it.product_id] ?? 0) + it.qty;
      const nowIso = new Date().toISOString();
      const rows = Object.entries(add).map(([pid, q]) => {
        const p = prodById(pid); const r = by[pid];
        const est = p ? estimateStock({ bookings: fcBookings, structureId: o.structure_id, product: p, counted: Number(r?.qty_on_hand) || 0, countedAtISO: r?.updated_at ? String(r.updated_at).slice(0, 10) : null, todayISO: today, horizonDays: horizon }).estimated : (Number(r?.qty_on_hand) || 0);
        return { tenant_id: uid, structure_id: o.structure_id, product_id: pid, qty_on_hand: est + q, updated_at: nowIso };
      });
      if (rows.length) { const { error } = await supabase.from("supply_stock_levels").upsert(rows, { onConflict: "structure_id,product_id" }); if (error) throw new Error(error.message); }
      const { error: e2 } = await supabase.from("supply_orders").update({ status: "delivered", delivery_date: today, updated_at: nowIso }).eq("id", o.id);
      if (e2) throw new Error(e2.message);
      setMsg("Ordine consegnato: scorte aggiornate."); await loadOrders();
      if (o.structure_id === structId) {
        const { data } = await supabase.from("supply_stock_levels").select("product_id, qty_on_hand, updated_at").eq("structure_id", structId);
        const ss: Record<string, StockRow> = {}; for (const s2 of (data ?? []) as Stock[]) ss[s2.product_id] = { qty: Number(s2.qty_on_hand) || 0, at: s2.updated_at ? String(s2.updated_at).slice(0, 10) : null }; setStockRows(ss);
      }
    } catch (e) { setMsg(e instanceof Error ? e.message : "errore"); }
    finally { setBusy(false); }
  };
  // Registra l'ordine pagato come documento in Fatture passive (una sola volta per ordine).
  const orderToInvoice = async (o: OrderRow) => {
    if (!supabase) return;
    const docNum = docNumberOf(o);
    if (invoiced[docNum]) return;
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const { data: dup } = await supabase.from("purchase_documents").select("id").eq("doc_number", docNum).limit(1);
    if (dup && dup.length) { setInvoiced((p2) => ({ ...p2, [docNum]: true })); setMsg("Già registrato in Fatture passive."); return; }
    const taxable = o.subtotal_cents ?? Math.round(o.total_cents / 1.22);
    const vat = o.vat_cents ?? o.total_cents - taxable;
    const when = (o.delivery_date || o.updated_at || o.created_at).slice(0, 10);
    const { error } = await supabase.from("purchase_documents").insert({
      tenant_id: uid, structure_id: o.structure_id, supplier_name: "Xenora Forniture", doc_number: docNum, doc_date: o.created_at.slice(0, 10), doc_type: "ricevuta", category: "Forniture",
      taxable_cents: taxable, vat_cents: vat, total_cents: o.total_cents, paid: true, paid_at: when, payment_method: "Carta", source: "forniture", notes: `Ordine Forniture ${o.id.slice(0, 8)} del ${new Date(o.created_at).toLocaleDateString("it-IT")}`,
    });
    if (error) { setMsg(error.message); return; }
    setInvoiced((p2) => ({ ...p2, [docNum]: true })); setMsg("Ordine registrato in Fatture passive (categoria Forniture).");
  };
  const exportOrdersCsv = () => {
    const head = ["Data", "Struttura", "Tipo", "Stato", "Imponibile", "IVA", "Totale", "Consegna"];
    const q = (x: unknown) => `"${String(x ?? "").replace(/"/g, '""')}"`;
    const rows = shownOrders.map((o) => [new Date(o.created_at).toLocaleDateString("it-IT"), structOf(o.structure_id), o.suggested_for ? `Suggerito ${o.suggested_for}` : "Manuale", STATUS_LABEL[o.status] ?? o.status, ((o.subtotal_cents ?? 0) / 100).toFixed(2), ((o.vat_cents ?? 0) / 100).toFixed(2), (o.total_cents / 100).toFixed(2), o.delivery_date ?? ""].map(q).join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ordini-forniture.csv"; a.click(); URL.revokeObjectURL(a.href);
  };

  const reorderable = activeProds.filter((p) => p.consumption_per_arrival > 0 || p.consumption_per_guest_night > 0);
  const shownCats = cats.filter((cat) => activeProds.some((p) => p.category_id === cat.id) && (!catFilter || cat.id === catFilter));

  return (
    <>
      <PageHeader title="Forniture" subtitle="Il negozio delle tue strutture: consumabili e cortesia, con riordino suggerito dagli arrivi" />

      {msg && <div className="mb-4 rounded-lg border border-line bg-wash px-3 py-2 text-sm font-medium text-txt">{msg}</div>}

      {structId && lowRows.length > 0 && tab !== "scorte" && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--warn)", backgroundColor: "color-mix(in srgb, var(--warn) 10%, transparent)" }}>
          <span className="font-semibold text-txt">{lowRows.length} {lowRows.length === 1 ? "prodotto sotto" : "prodotti sotto"} la soglia minima</span>
          <span className="min-w-0 flex-1 truncate text-dim">{lowRows.slice(0, 4).map((r) => r.p.name).join(", ")}{lowRows.length > 4 ? "…" : ""}</span>
          <button onClick={() => { setOnlyLow(true); setTab("scorte"); }} className="rounded-lg border border-line bg-surface px-3 py-1 text-xs font-semibold text-txt hover:bg-wash">Vedi scorte</button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {(["catalogo", "scorte", "riordino", "ordini"] as const).map((tk) => (
            <button key={tk} onClick={() => setTab(tk)} className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize transition ${tab === tk ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{tk}{tk === "scorte" && lowRows.length > 0 && <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "var(--warn)", color: "#fff" }}>{lowRows.length}</span>}</button>
          ))}
        </div>
        {activeStructureId === "all" && (
          <select value={localStruct} onChange={(e) => setLocalStruct(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt">
            <option value="">Scegli la struttura…</option>
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

      {tab === "scorte" && (
        <div>
          {!structId && <div className="mb-3 rounded-lg border border-line bg-wash px-3 py-2 text-sm text-dim">Scegli una struttura dal menu accanto alle schede: le scorte sono separate per struttura.</div>}
          {structId && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[["Prodotti monitorati", String(stockInfo.filter((r) => r.state !== "none").length), "var(--txt)"], ["Sotto soglia", String(stockInfo.filter((r) => r.state === "low").length), lowRows.some((r) => r.state === "low") ? "var(--warn)" : "var(--ok)"], ["Esauriti", String(stockInfo.filter((r) => r.state === "out").length), stockInfo.some((r) => r.state === "out") ? "var(--err)" : "var(--ok)"], ["Valore giacenza stimata", c(Math.round(stockInfo.reduce((a, r) => a + r.estimated * (r.p.sale_price_cents / Math.max(1, r.p.pack_size)), 0))), "var(--dim)"]].map(([l, v, col]) => (
                  <div key={l} className="flex min-h-[78px] flex-col justify-center rounded-xl border border-line bg-surface p-3 shadow-sm">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{l}</div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums" style={{ color: col }}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-dim"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Solo sotto soglia</label>
                <label className="text-sm text-dim">Copertura su</label>
                <select value={horizon} onChange={(e) => setHorizon(parseInt(e.target.value))} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt">
                  <option value={30}>30 giorni</option><option value={60}>60 giorni</option><option value={90}>90 giorni</option>
                </select>
                <button onClick={addLowToCart} disabled={lowRows.length === 0} className="ml-auto rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">Aggiungi i sotto soglia al carrello ({lowRows.length})</button>
              </div>
              <Card className="mb-3 !p-0 overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs text-dim">
                    <th className="px-3 py-2">Prodotto</th><th className="px-3 py-2 text-right">Giacenza contata</th><th className="px-3 py-2 text-right">Stima oggi</th>
                    <th className="px-3 py-2 text-right">Soglia minima</th><th className="px-3 py-2 text-right">Copertura</th><th className="px-3 py-2">Stato</th>
                  </tr></thead>
                  <tbody>
                    {stockInfo.filter((r) => !onlyLow || r.state === "low" || r.state === "out").map((r) => {
                      const col = r.state === "out" ? "var(--err)" : r.state === "low" ? "var(--warn)" : r.state === "ok" ? "var(--ok)" : "var(--faint)";
                      const label = r.state === "out" ? "Esaurito" : r.state === "low" ? "Sotto soglia" : r.state === "ok" ? "Ok" : "Non monitorato";
                      return (
                        <tr key={r.p.id} className="border-b border-line/60">
                          <td className="px-3 py-2"><div className="font-semibold text-txt">{r.p.name}</div><div className="text-[11px] text-faint">{catName(r.p.category_id)} · conf. {r.p.pack_size} {r.p.unit || "pz"}</div></td>
                          <td className="px-3 py-2 text-right">
                            <input key={`q-${r.p.id}-${r.counted}`} type="number" min={0} step="any" defaultValue={stockRows[r.p.id] ? r.counted : ""} placeholder="—" onBlur={(e) => { const v = e.target.value.trim(); if (v === "") return; const n = Math.max(0, Number(v.replace(",", "."))); if (Number.isFinite(n) && (!stockRows[r.p.id] || n !== r.counted)) saveStock(r.p, n); }} className="w-20 rounded border border-line bg-surface px-1.5 py-1 text-right font-mono text-xs" />
                            {r.at && <div className="mt-0.5 text-[10px] text-faint">al {new Date(r.at).toLocaleDateString("it-IT")}</div>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{stockRows[r.p.id] ? <><span className="font-bold text-txt">{r.estimated}</span>{r.consumed > 0 && <div className="text-[10px] text-faint">−{r.consumed} dal conteggio</div>}</> : "—"}</td>
                          <td className="px-3 py-2 text-right">
                            <input key={`m-${r.p.id}-${r.min}`} type="number" min={0} step="any" defaultValue={r.min || ""} placeholder="0" onBlur={(e) => { const n = Math.max(0, Number((e.target.value || "0").replace(",", "."))); if (Number.isFinite(n) && n !== r.min) saveMin(r.p, n); }} className="w-20 rounded border border-line bg-surface px-1.5 py-1 text-right font-mono text-xs" />
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{r.state === "none" ? "—" : r.coverage == null ? "∞" : `${r.coverage} gg`}</td>
                          <td className="px-3 py-2"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${col} 16%, transparent)`, color: col }}>{label}</span></td>
                        </tr>
                      );
                    })}
                    {stockInfo.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-dim">Nessun prodotto con consumo previsto.</td></tr>}
                  </tbody>
                </table>
              </Card>
              <p className="text-[11px] leading-relaxed text-faint">La giacenza contata è il valore che inserisci tu (inventario fisico). La stima di oggi sottrae il consumo previsto dalle prenotazioni (arrivi e ospiti per notte, come da consumi del prodotto) trascorso dalla data del conteggio: è una stima, ricontare ogni tanto la rende affidabile. Alla consegna di un ordine le quantità vengono caricate automaticamente.</p>
            </>
          )}
        </div>
      )}

      {tab === "riordino" && (
        <div>
          {!structId && <div className="mb-3 rounded-lg border border-line bg-wash px-3 py-2 text-sm text-dim">Scegli una struttura dal menu accanto alle schede: regole di riordino e scorte sono separate per struttura.</div>}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="text-sm text-dim">Orizzonte</label>
            <select value={horizon} onChange={(e) => setHorizon(parseInt(e.target.value))} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt">
              <option value={30}>30 giorni</option><option value={60}>60 giorni</option><option value={90}>90 giorni</option>
            </select>
            <span className="text-xs text-faint">Attiva la regola sui prodotti che vuoi riordinare; il fabbisogno tiene conto della giacenza stimata e della soglia minima (impostabile in Scorte).</span>
          </div>

          <Card className="mb-4 !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-dim">
                <th className="px-3 py-2">Prodotto</th><th className="px-3 py-2">Regola</th><th className="px-3 py-2 text-right">Soglia min.</th>
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
        <div>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Speso nell'anno", c(orderStats.spent), "var(--txt)"], ["In corso", String(orderStats.open), "var(--dim)"], ["Da pagare", String(orderStats.pending), orderStats.pending > 0 ? "var(--warn)" : "var(--dim)"], ["Bozze", String(orderStats.drafts), "var(--dim)"]].map(([l, v, col]) => (
              <div key={l} className="flex min-h-[78px] flex-col justify-center rounded-xl border border-line bg-surface p-3 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{l}</div>
                <div className="mt-1 font-mono text-xl font-bold tabular-nums" style={{ color: col }}>{v}</div>
              </div>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select value={orderFilter} onChange={(e) => setOrderFilter(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt">
              <option value="all">Tutti gli stati</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button onClick={exportOrdersCsv} disabled={shownOrders.length === 0} className="ml-auto rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-40">Esporta CSV</button>
          </div>
          <Card className="!p-0 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-dim">
                <th className="px-3 py-2">Data</th><th className="px-3 py-2">Struttura</th><th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Stato</th><th className="px-3 py-2 text-right">Totale</th>
              </tr></thead>
              <tbody>
                {shownOrders.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-dim">Nessun ordine.</td></tr>}
                {shownOrders.map((o) => (
                  <Fragment key={o.id}>
                    <tr onClick={() => toggleOrder(o)} className="cursor-pointer border-b border-line/60 hover:bg-wash">
                      <td className="px-3 py-2 text-xs">{new Date(o.created_at).toLocaleDateString("it-IT")}</td>
                      <td className="px-3 py-2 text-xs">{structOf(o.structure_id)}</td>
                      <td className="px-3 py-2 text-xs">{o.suggested_for ? `Suggerito ${o.suggested_for}` : "Manuale"}</td>
                      <td className="px-3 py-2 text-xs"><span className="rounded-full bg-wash px-2 py-0.5 font-semibold text-dim">{STATUS_LABEL[o.status] ?? o.status}</span>{o.delivery_date && o.status === "delivered" && <span className="ml-2 text-[10px] text-faint">il {new Date(o.delivery_date).toLocaleDateString("it-IT")}</span>}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-txt">{c(o.total_cents)}</td>
                    </tr>
                    {openOrder === o.id && (
                      <tr className="border-b border-line/60 bg-wash/40">
                        <td colSpan={5} className="px-3 py-3">
                          {!orderItems[o.id] ? <div className="text-xs text-dim">Carico le righe…</div> : (
                            <div className="mb-3 space-y-1">
                              {orderItems[o.id].map((it) => (
                                <div key={it.id} className="flex items-center gap-3 text-xs">
                                  <span className="min-w-0 flex-1 truncate font-semibold text-txt">{prodById(it.product_id)?.name ?? "Prodotto non più a catalogo"}</span>
                                  <span className="font-mono text-dim">{it.qty} × {c(it.unit_price_cents)}</span>
                                  <span className="w-20 text-right font-mono text-txt">{c(it.qty * it.unit_price_cents)}</span>
                                </div>
                              ))}
                              <div className="flex justify-end gap-4 border-t border-line pt-1 text-[11px] text-dim"><span>Imponibile {c(o.subtotal_cents ?? 0)}</span><span>IVA {c(o.vat_cents ?? 0)}</span><span className="font-bold text-txt">Totale {c(o.total_cents)}</span></div>
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <button onClick={() => orderToCart(o)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Riordina (riporta nel carrello)</button>
                            {ORDER_OPEN.includes(o.status) && <button onClick={() => receiveOrder(o)} disabled={busy} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">Segna consegnato e carica a magazzino</button>}
                            {["paid", "processing", "shipped", "delivered"].includes(o.status) && (invoiced[docNumberOf(o)]
                              ? <span className="text-xs text-faint">Registrato in Fatture passive ({docNumberOf(o)})</span>
                              : <button onClick={() => orderToInvoice(o)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Registra in Fatture passive</button>)}
                            {o.status === "draft" && <button onClick={() => deleteDraft(o)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-faint hover:text-[color:var(--err)]">Elimina bozza</button>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  );
}
