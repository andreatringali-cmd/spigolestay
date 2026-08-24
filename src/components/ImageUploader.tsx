"use client";

import { useEffect, useRef, useState } from "react";
import { downscaleImage, getImages, setImages } from "@/lib/images";

// Caricamento immagini con anteprima: ridimensiona a miniatura e salva (persistente).
export default function ImageUploader({ entityKey, max = 6 }: { entityKey: string; max?: number }) {
  const [imgs, setImgs] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setImgs(getImages(entityKey)); }, [entityKey]);

  const persist = (next: string[]) => { const r = setImages(entityKey, next); if (!r.ok) { setErr(r.error ?? "Errore"); return false; } setImgs(next); setErr(""); return true; };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setErr("");
    let next = [...imgs];
    for (const f of Array.from(files)) {
      if (next.length >= max) { setErr(`Massimo ${max} immagini.`); break; }
      if (!f.type.startsWith("image/")) continue;
      try { next = [...next, await downscaleImage(f)]; } catch { setErr("Immagine non valida."); }
    }
    persist(next);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const remove = (i: number) => persist(imgs.filter((_, j) => j !== i));
  const makeCover = (i: number) => { if (i === 0) return; const n = [...imgs]; const [x] = n.splice(i, 1); n.unshift(x); persist(n); };

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {imgs.map((src, i) => (
          <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="h-full w-full object-cover" />
            {i === 0 && <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white">Copertina</span>}
            <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/40 opacity-0 transition group-hover:opacity-100">
              {i !== 0 && <button onClick={() => makeCover(i)} className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-black" title="Rendi copertina">★</button>}
              <button onClick={() => remove(i)} className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--err)]">Elimina</button>
            </div>
          </div>
        ))}
        {imgs.length < max && (
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="grid aspect-square place-items-center rounded-lg border border-dashed border-line text-faint transition hover:bg-wash hover:text-focus disabled:opacity-50">
            {busy ? <span className="text-xs">…</span> : <span className="text-center text-xs leading-tight">＋<br />Carica</span>}
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      {err && <p className="mt-1.5 text-[11px] text-[color:var(--err)]">{err}</p>}
      <p className="mt-1 text-[11px] text-faint">Le immagini vengono ridotte a miniatura e salvate nel browser. La prima è la copertina.</p>
    </div>
  );
}
