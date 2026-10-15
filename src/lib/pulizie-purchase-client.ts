"use client";

// Lato browser degli acquisti dell'addetta: riduzione delle foto, caricamento/lettura dello scontrino e registrazione in Prima nota.
// Nel browser non resta nulla: il file va su Storage privato, il movimento su cash_movements (entrambi tramite le route /api/pulizie/*).
import { supabase } from "./supabase";
import { RECEIPT_JPEG_QUALITY, RECEIPT_MAX_SIDE, fitWithin, validateReceiptFile } from "./pulizie-purchase";
import type { PulizieOrder, ReceiptRef } from "./pulizie-addetta";

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const token = supabase ? (await supabase.auth.getSession())?.data.session?.access_token : undefined;
    return token ? { Authorization: `Bearer ${token}` } : null;
  } catch { return null; }
}

/** Foto → JPEG con il lato lungo a 1600 px (qualità 0,72). I PDF e le immagini già piccole restano come sono. */
export async function shrinkReceipt(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  let bmp: ImageBitmap | HTMLImageElement | null = null;
  let revoke = "";
  try {
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch {
      const url = URL.createObjectURL(file); revoke = url;
      bmp = await new Promise<HTMLImageElement>((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ko(new Error("img")); im.src = url; });
    }
    const w = "naturalWidth" in bmp ? bmp.naturalWidth : bmp.width;
    const h = "naturalHeight" in bmp ? bmp.naturalHeight : bmp.height;
    const { width, height } = fitWithin(w, h, RECEIPT_MAX_SIDE);
    if (!width) return file;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height); // PNG trasparenti: sfondo bianco
    ctx.drawImage(bmp, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", RECEIPT_JPEG_QUALITY));
    if (!blob) return file;
    if (blob.size >= file.size && width === w && height === h && file.type === "image/jpeg") return file; // già più leggero di così
    const base = (file.name || "scontrino").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } finally {
    if (revoke) URL.revokeObjectURL(revoke);
    if (bmp && "close" in bmp) bmp.close();
  }
}

export type Uploaded = { ok: true; receipt: ReceiptRef; file: File } | { ok: false; error: string };

/** Riduce (se foto), controlla e carica lo scontrino. */
export async function uploadReceipt(input: File): Promise<Uploaded> {
  let file = input;
  try { file = await shrinkReceipt(input); } catch { return { ok: false, error: "Non riesco a leggere questa foto. Riprova o usa un PDF." }; }
  const v = validateReceiptFile({ type: file.type, size: file.size });
  if (!v.ok) return { ok: false, error: v.error };
  const h = await authHeaders();
  if (!h) return { ok: false, error: "Sessione scaduta: rientra e riprova." };
  try {
    const fd = new FormData(); fd.append("file", file, file.name);
    const r = await fetch("/api/pulizie/receipt", { method: "POST", headers: h, body: fd });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; receipt?: ReceiptRef; message?: string } | null;
    if (!r.ok || !j?.ok || !j.receipt) return { ok: false, error: j?.message || (r.status === 413 ? "Il file è troppo grande." : "Impossibile caricare lo scontrino. Riprova.") };
    return { ok: true, receipt: j.receipt, file };
  } catch { return { ok: false, error: "Non sei connesso: lo scontrino non è stato caricato." }; }
}

/** Toglie dal server un file caricato ma non più usato (scontrino rimosso prima di salvare). Errori ignorati. */
export async function discardReceipt(path: string): Promise<void> {
  const h = await authHeaders();
  if (!h) return;
  try { await fetch(`/api/pulizie/receipt?path=${encodeURIComponent(path)}`, { method: "DELETE", headers: h }); } catch { /* niente */ }
}

/** Apre lo scontrino (URL firmato temporaneo) in una nuova scheda. Restituisce un messaggio d'errore, o null se è andato a buon fine. */
export async function openReceipt(path: string): Promise<string | null> {
  const win = typeof window !== "undefined" ? window.open("", "_blank") : null; // aperta subito: dopo l'attesa il telefono bloccherebbe il popup
  const fail = (m: string) => { try { win?.close(); } catch { /* niente */ } return m; };
  const h = await authHeaders();
  if (!h) return fail("Sessione scaduta: rientra e riprova.");
  try {
    const r = await fetch(`/api/pulizie/receipt?path=${encodeURIComponent(path)}`, { headers: h, cache: "no-store" });
    const j = (await r.json().catch(() => null)) as { url?: string; message?: string } | null;
    if (!r.ok || !j?.url) return fail(j?.message || "Scontrino non disponibile.");
    if (win) win.location.href = j.url; else window.location.assign(j.url);
    return null;
  } catch { return fail("Non sei connesso: impossibile aprire lo scontrino."); }
}

export type CashResult = "done" | "failed" | "retry";
/** Registra l'acquisto in Prima nota. done = fatto (o già presente) · failed = rifiutato dal server (non ritentare) · retry = riprovare più tardi. */
export async function recordPurchase(o: PulizieOrder): Promise<CashResult> {
  const h = await authHeaders();
  if (!h) return "retry";
  try {
    const r = await fetch("/api/pulizie/purchase", {
      method: "POST", headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({ id: o.id, date: o.date, name: o.productName, qty: o.qty, cost: o.cost, structureId: o.structureId, conto: o.payConto }),
    });
    if (r.ok) return "done";
    return r.status === 400 || r.status === 409 ? "failed" : "retry";
  } catch { return "retry"; }
}

/** Toglie dalla Prima nota il movimento di un acquisto eliminato (e il suo scontrino). true = fatto. */
export async function unrecordPurchase(o: PulizieOrder): Promise<boolean> {
  const h = await authHeaders();
  if (!h) return false;
  try {
    const q = `id=${encodeURIComponent(o.id)}${o.receipt?.path ? `&receipt=${encodeURIComponent(o.receipt.path)}` : ""}`;
    const r = await fetch(`/api/pulizie/purchase?${q}`, { method: "DELETE", headers: h });
    return r.ok;
  } catch { return false; }
}
