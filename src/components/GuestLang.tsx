"use client";

import { useCallback, useEffect, useState } from "react";
import { GUEST_LANGS, GUEST_LANG_KEY, asGuestLang, browserGuestLang, pickGuestUiLang, translate } from "@/lib/guest-i18n";
import { GUEST_DICT } from "@/lib/guest-i18n-dict";
import type { GuestLang } from "@/lib/phone-country";

// Lingua delle pagine pubbliche per l'ospite. `detected` = lingua ricavata dalla prenotazione (scheda → Paese → prefisso del telefono),
// arriva dopo il caricamento della prenotazione; finché non c'è si usa la lingua del browser. La scelta a mano vince su tutto e resta sul telefono.
export function useGuestLang(detected?: string | null) {
  const [stored, setStored] = useState<GuestLang | null>(null);
  const [param, setParam] = useState<GuestLang | null>(null);
  const [browser, setBrowser] = useState<GuestLang | null>(null);
  useEffect(() => {
    try { setStored(asGuestLang(localStorage.getItem(GUEST_LANG_KEY))); } catch {}
    try { setParam(asGuestLang(new URLSearchParams(window.location.search).get("lang"))); } catch {}
    try { setBrowser(browserGuestLang(navigator.languages?.length ? navigator.languages : [navigator.language])); } catch {}
  }, []);
  const lang = pickGuestUiLang({ stored, param, detected, browser });
  useEffect(() => { try { document.documentElement.lang = lang; } catch {} }, [lang]);
  const setLang = useCallback((l: GuestLang) => { setStored(l); try { localStorage.setItem(GUEST_LANG_KEY, l); } catch {} }, []);
  const t = useCallback((s: string, vars?: Record<string, string | number>) => translate(GUEST_DICT, lang, s, vars), [lang]);
  return { lang, setLang, t };
}

// Selettore lingua ben visibile (una riga di pulsanti con bandiera + sigla): sempre a vista in cima alla pagina.
export function GuestLangPicker({ lang, setLang, label }: { lang: GuestLang; setLang: (l: GuestLang) => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1" role="group" aria-label={label}>
      <span className="text-xs font-medium text-dim">🌐 {label}</span>
      <div className="flex flex-wrap gap-1">
        {GUEST_LANGS.map((l) => {
          const on = l.code === lang;
          return (
            <button key={l.code} type="button" onClick={() => setLang(l.code)} aria-pressed={on} title={l.label}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition max-sm:min-h-11 max-sm:min-w-11 max-sm:px-3 ${on ? "border-transparent text-on-focus" : "border-line bg-surface text-txt hover:border-focus"}`}
              style={on ? { backgroundColor: "var(--focus)" } : undefined}>
              <span aria-hidden>{l.flag}</span>{l.short}
            </button>
          );
        })}
      </div>
    </div>
  );
}
