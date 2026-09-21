// Carrello Forniture: stato per-viewer in localStorage, condiviso tra il catalogo
// e la scheda prodotto. Ogni scrittura emette un evento così le pagine aperte si aggiornano.
"use client";

export interface CartItem { productId: string; variantId?: string; qty: number; customization?: Record<string, unknown> }

const KEY = "spigolestay:forniture:cart";
const EVT = "forniture-cart-change";

export function cartKey(productId: string, variantId?: string) { return `${productId}::${variantId ?? ""}`; }

export function getCart(): Record<string, CartItem> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, CartItem>; } catch { return {}; }
}

export function setCart(next: Record<string, CartItem>) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage non disponibile */ }
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch { /* niente */ }
}

export function addToCart(productId: string, qty: number, variantId?: string, customization?: Record<string, unknown>) {
  const cart = getCart();
  const k = cartKey(productId, variantId);
  const cur = cart[k]?.qty ?? 0;
  cart[k] = { productId, variantId, qty: Math.max(0, cur + qty), customization: customization ?? cart[k]?.customization };
  if (cart[k].qty <= 0) delete cart[k];
  setCart(cart);
}

export function setQty(productId: string, qty: number, variantId?: string) {
  const cart = getCart();
  const k = cartKey(productId, variantId);
  if (qty <= 0) delete cart[k]; else cart[k] = { ...(cart[k] ?? { productId, variantId }), productId, variantId, qty };
  setCart(cart);
}

export function clearCart() { setCart({}); }

export function onCartChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const h = () => fn();
  window.addEventListener("forniture-cart-change", h);
  window.addEventListener("storage", h);
  return () => { window.removeEventListener("forniture-cart-change", h); window.removeEventListener("storage", h); };
}
