"use client";

import { useEffect, useRef, useState } from "react";
import { useLang, LANGS } from "@/lib/i18n";
import Flag from "./Flag";

// Selettore lingua dell'interfaccia. L'italiano è la lingua di default.
export default function LanguageSwitcher() {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const cur = LANGS.find((l) => l.code === lang) ?? LANGS[0];

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title={`Lingua · ${cur.label}`} className="flex items-center rounded-lg border border-line px-2.5 py-2 hover:bg-wash">
        <Flag code={cur.code} className="h-4 w-6" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-xl">
          <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Lingua</div>
          {LANGS.map((l) => (
            <button key={l.code} onClick={() => { setLang(l.code); setOpen(false); }} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-wash ${l.code === lang ? "bg-wash" : ""}`}>
              <Flag code={l.code} className="h-3.5 w-5" />
              <span className="flex-1 text-txt">{l.label}</span>
              {l.code === lang && <span className="text-focus">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
