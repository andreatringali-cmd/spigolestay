// Gestione immagini per il prototipo: ridimensiona con canvas a miniatura e salva in
// una chiave localStorage dedicata (con budget) per non saturare lo store principale.

import { lsGet } from "./publicdata";

const KEY = "spigolestay:images";
const MAX_TOTAL = 3_500_000; // ~3.5 MB complessivi per le immagini

// Riduce un file immagine a JPEG (lato max ~maxDim px) e restituisce una dataURL leggera.
export function downscaleImage(file: File, maxDim = 500, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width >= height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas non disponibile"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Immagine non valida"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Lettura file fallita"));
    reader.readAsDataURL(file);
  });
}

function loadAll(): Record<string, string[]> {
  try { return JSON.parse(lsGet(KEY) || "{}"); } catch { return {}; }
}
export function getImages(entityKey: string): string[] {
  try { return loadAll()[entityKey] ?? []; } catch { return []; }
}
export function setImages(entityKey: string, imgs: string[]): { ok: boolean; error?: string } {
  const all = loadAll();
  if (imgs.length) all[entityKey] = imgs; else delete all[entityKey];
  const payload = JSON.stringify(all);
  if (payload.length > MAX_TOTAL) return { ok: false, error: "Spazio immagini quasi esaurito: rimuovi qualche foto." };
  try { localStorage.setItem(KEY, payload); return { ok: true }; } catch { return { ok: false, error: "Spazio del browser esaurito." }; }
}
