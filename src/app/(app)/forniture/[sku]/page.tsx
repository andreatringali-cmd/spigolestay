"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { eur } from "@/lib/format";
import { PageHeader, Card } from "@/components/ui";
import Icon from "@/components/Icon";
import { productImage } from "@/lib/forniture/image";
import { addToCart } from "@/lib/forniture/cart";

interface Category { id: string; slug: string; name: string }
interface Product {
  id: string; category_id: string | null; sku: string; name: string; description?: string; unit?: string;
  pack_size: number; sale_price_cents: number; min_order_qty: number; customizable: boolean; customization_type: string;
  customization_min_qty: number; lead_time_days: number; active: boolean; image_url?: string | null;
}
interface Variant { id: string; product_id: string; name: string; value: string }

const c = (n: number) => eur(n / 100);
const CUSTOM_LABEL: Record<string, string> = { label: "etichetta personalizzata", print: "stampa personalizzata", embroidery: "ricamo personalizzato", none: "" };

export default function ProductPage() {
  const router = useRouter();
  const params = useParams();
  const sku = String((params as { sku?: string }).sku || "");
  const [p, setP] = useState<Product | null>(null);
  const [cat, setCat] = useState<Category | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [variantId, setVariantId] = useState<string>("");
  const [qty, setQty] = useState<number>(1);
  const [logo, setLogo] = useState<string>("");     // dataURL anteprima logo
  const [custText, setCustText] = useState<string>("");
  const [added, setAdded] = useState(false);

  useEffect(() => {
    (async () => {
      if (!supabase || !sku) { setLoading(false); return; }
      const { data: prod } = await supabase.from("supply_products").select("*").eq("sku", sku).maybeSingle();
      if (!prod) { setLoading(false); return; }
      setP(prod as Product);
      setQty(Math.max(1, (prod as Product).min_order_qty));
      const [{ data: ca }, { data: vs }] = await Promise.all([
        supabase.from("supply_categories").select("id, slug, name").eq("id", (prod as Product).category_id).maybeSingle(),
        supabase.from("supply_variants").select("*").eq("product_id", (prod as Product).id),
      ]);
      setCat((ca as Category) ?? null);
      setVariants((vs as Variant[]) ?? []);
      if (vs && vs.length) setVariantId((vs as Variant[])[0].id);
      setLoading(false);
    })();
  }, [sku]);

  const minQty = useMemo(() => {
    if (!p) return 1;
    return p.customizable && p.customization_min_qty > 0 ? Math.max(p.min_order_qty, p.customization_min_qty) : Math.max(1, p.min_order_qty);
  }, [p]);

  const onLogo = (f?: File) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return; // max 2MB anteprima
    const r = new FileReader(); r.onload = () => setLogo(String(r.result || "")); r.readAsDataURL(f);
  };

  const add = () => {
    if (!p) return;
    const q = Math.max(minQty, qty);
    const customization = p.customizable ? { type: p.customization_type, text: custText || undefined, logo: logo || undefined } : undefined;
    addToCart(p.id, q, variantId || undefined, customization);
    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
  };

  if (loading) return (<><PageHeader title="Forniture" /><div className="text-sm text-dim">Carico…</div></>);
  if (!p) return (<><PageHeader title="Prodotto non trovato" /><button onClick={() => router.push("/forniture")} className="text-sm font-semibold text-focus">← Torna al catalogo</button></>);

  const img = productImage(p, cat?.slug);
  const customLabel = CUSTOM_LABEL[p.customization_type] || "personalizzabile";

  return (
    <>
      <button onClick={() => router.push("/forniture")} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-dim hover:text-txt"><Icon name="chevron" size={14} style={{ transform: "rotate(180deg)" }} /> Catalogo</button>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* immagine */}
        <div>
          <div className="overflow-hidden rounded-2xl border border-line bg-wash">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt={p.name} className="aspect-[4/3] w-full object-cover" />
          </div>
          {p.customizable && logo && (
            <Card className="mt-3">
              <div className="text-xs font-semibold text-dim">Anteprima {customLabel}</div>
              <div className="mt-2 flex items-center gap-3">
                <div className="grid h-16 w-24 place-items-center rounded-lg border border-line bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logo} alt="logo" className="max-h-12 max-w-[80px] object-contain" />
                </div>
                <div className="text-xs text-dim">Il tuo logo verrà applicato in {customLabel} sul prodotto.{custText ? ` Testo: “${custText}”.` : ""}</div>
              </div>
            </Card>
          )}
        </div>

        {/* dettagli */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-faint">{cat?.name}</div>
          <h1 className="mt-1 text-2xl font-bold text-txt">{p.name}</h1>
          <div className="mt-2 font-mono text-2xl font-bold text-txt">{c(p.sale_price_cents)}</div>
          {p.description && <p className="mt-3 text-sm leading-relaxed text-dim">{p.description}</p>}

          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-line bg-surface px-3 py-2"><div className="text-faint">Confezione</div><div className="font-semibold text-txt">{p.pack_size} {p.unit || "pz"}</div></div>
            <div className="rounded-lg border border-line bg-surface px-3 py-2"><div className="text-faint">Ordine minimo</div><div className="font-semibold text-txt">{minQty} {p.unit || "pz"}</div></div>
            {p.lead_time_days > 0 && <div className="rounded-lg border border-line bg-surface px-3 py-2"><div className="text-faint">Consegna</div><div className="font-semibold text-txt">~{p.lead_time_days} giorni</div></div>}
            {p.customizable && <div className="rounded-lg border border-line bg-surface px-3 py-2"><div className="text-faint">Personalizzazione</div><div className="font-semibold text-txt capitalize">{customLabel}</div></div>}
          </div>

          {variants.length > 0 && (
            <div className="mt-4">
              <label className="text-xs font-semibold text-dim">{variants[0].name.charAt(0).toUpperCase() + variants[0].name.slice(1)}</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {variants.map((v) => (
                  <button key={v.id} onClick={() => setVariantId(v.id)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${variantId === v.id ? "border-focus bg-focus text-white" : "border-line text-txt hover:bg-wash"}`}>{v.value}</button>
                ))}
              </div>
            </div>
          )}

          {p.customizable && (
            <Card className="mt-4">
              <div className="text-sm font-semibold text-txt">Personalizza</div>
              <div className="mt-2 space-y-2">
                <div>
                  <label className="text-xs text-dim">Logo (PNG/JPG, max 2MB)</label>
                  <input type="file" accept="image/*" onChange={(e) => onLogo(e.target.files?.[0])} className="mt-1 block w-full text-xs" />
                </div>
                {(p.customization_type === "label" || p.customization_type === "print") && (
                  <div>
                    <label className="text-xs text-dim">Testo (opzionale)</label>
                    <input value={custText} onChange={(e) => setCustText(e.target.value)} maxLength={40} placeholder="es. Benvenuti a Spigolehouse" className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt" />
                  </div>
                )}
                <div className="text-[11px] text-faint">Personalizzazione con quantità minima {minQty} {p.unit || "pz"}.</div>
              </div>
            </Card>
          )}

          <div className="mt-5 flex items-center gap-3">
            <div className="flex items-center rounded-lg border border-line">
              <button onClick={() => setQty((q) => Math.max(minQty, q - Math.max(1, p.min_order_qty)))} className="px-3 py-2 text-lg text-dim hover:text-txt">−</button>
              <input type="number" min={minQty} step={Math.max(1, p.min_order_qty)} value={qty} onChange={(e) => setQty(parseInt(e.target.value) || minQty)} className="w-20 border-x border-line bg-surface px-2 py-2 text-center text-sm" />
              <button onClick={() => setQty((q) => q + Math.max(1, p.min_order_qty))} className="px-3 py-2 text-lg text-dim hover:text-txt">+</button>
            </div>
            <button onClick={add} className="flex-1 rounded-lg bg-focus px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90">
              {added ? "Aggiunto ✓" : `Aggiungi · ${c(p.sale_price_cents * Math.max(minQty, qty))}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
