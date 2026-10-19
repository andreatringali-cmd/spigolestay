"use client";

import { useRef, useState } from "react";
import { useLang, LANGS } from "@/lib/i18n";
import Flag from "./Flag";
import Popover from "./Popover";

// Selettore lingua dell'interfaccia. L'italiano è la lingua di default.
export default function LanguageSwitcher() {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const cur = LANGS.find((l) => l.code === lang) ?? LANGS[0];

  return (
    <div className="relative">
      <button ref={btnRef} onClick={() => setOpen((o) => !o)} title={`Lingua · ${cur.label}`} className="flex items-center rounded-lg border border-line px-2.5 py-2 hover:bg-wash">
        <Flag code={cur.code} className="h-4 w-6" />
      </button>
      <Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)} align="end" width={176} label="Lingua">
          <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Lingua</div>
          {LANGS.map((l) => (
            <button key={l.code} onClick={() => { setLang(l.code); setOpen(false); }} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-wash ${l.code === lang ? "bg-wash" : ""}`}>
              <Flag code={l.code} className="h-3.5 w-5" />
              <span className="flex-1 text-txt">{l.label}</span>
              {l.code === lang && <span className="text-focus">✓</span>}
            </button>
          ))}
      </Popover>
    </div>
  );
}
