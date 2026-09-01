"use client";

import { useState } from "react";
import { PALETTES, STRUCTS, applyPalette, applyStruct, getSavedStyle } from "@/lib/appstyle";

// Scelta stile (palette colori + struttura box) da mostrare nelle Impostazioni.
// Applica live su tutta l'app e persiste la scelta.
export default function StyleChooser() {
  const saved = typeof window !== "undefined" ? getSavedStyle() : { pal: 0, str: 0 };
  const [pal, setPal] = useState(saved.pal);
  const [str, setStr] = useState(saved.str);

  const pickPal = (i: number) => { applyPalette(i); setPal(i); };
  const pickStr = (i: number) => { applyStruct(i); setStr(i); };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Colori</div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {PALETTES.map((p, i) => (
            <button key={p.name} onClick={() => pickPal(i)} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${pal === i ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_8%,transparent)] text-txt" : "border-line text-dim hover:bg-wash"}`}>
              <span className="flex shrink-0 gap-0.5">
                {p.swatch.map((c, j) => <span key={j} className="h-4 w-4 rounded" style={{ background: c, border: "1px solid rgba(0,0,0,.08)" }} />)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              {pal === i && <span className="text-focus">✓</span>}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Struttura box</div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {STRUCTS.map((s, i) => (
            <button key={s.name} onClick={() => pickStr(i)} className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs transition ${str === i ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_8%,transparent)] text-txt" : "border-line text-dim hover:bg-wash"}`}>
              <span className="truncate font-medium">{s.name}</span>
              {str === i && <span className="text-focus">✓</span>}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-faint">La scelta si applica subito a tutta l&apos;app e resta salvata.</p>
    </div>
  );
}
