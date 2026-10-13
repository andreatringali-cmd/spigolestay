"use client";

// Avviso cookie per le pagine pubbliche di prenotazione: chiede il consenso alla misurazione pubblicitaria (Google Ads) e, solo se accettato, carica il tag.
// Scelta salvata nel browser; "Rifiuta" non carica nulla. Nessun cookie di marketing viene impostato prima del consenso.
import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { getAdsConsent, setAdsConsent, loadAdsTag, adsAllowedHere } from "@/lib/ads";

const EVENT = "xn-consent-change";
const subscribe = (cb: () => void) => { window.addEventListener(EVENT, cb); return () => window.removeEventListener(EVENT, cb); };

export default function AdsConsent() {
  // "ssr" sul server (e al primo disegno): non si mostra nulla finché il browser non ha letto la scelta salvata.
  const choice = useSyncExternalStore(subscribe, () => (adsAllowedHere() ? getAdsConsent() ?? "none" : "off"), () => "ssr");
  useEffect(() => { if (choice === "granted") loadAdsTag(); }, [choice]);
  if (choice !== "none") return null; // già scelto, sito non di questo account ("off") o non ancora letto dal browser
  const pick = (v: "granted" | "denied") => { setAdsConsent(v); window.dispatchEvent(new Event(EVENT)); };
  return (
    <div role="dialog" aria-label="Cookie" className="fixed inset-x-3 bottom-3 z-[60] mx-auto flex max-w-xl flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-sm shadow-xl sm:flex-row sm:items-center">
      <p className="flex-1 text-[13px] leading-snug text-dim">
        Usiamo un cookie di Google Ads per capire quali annunci portano prenotazioni. Lo attiviamo solo se acconsenti. <Link href="/cookie" className="font-semibold text-focus underline">Cookie policy</Link>
      </p>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => pick("denied")} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Rifiuta</button>
        <button onClick={() => pick("granted")} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">Accetta</button>
      </div>
    </div>
  );
}
