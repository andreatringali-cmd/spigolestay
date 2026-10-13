// Google Ads: misurazione delle prenotazioni dirette (conversioni).
// Il tag si carica SOLO dopo il consenso esplicito del visitatore (GDPR): prima non viene caricato nulla e non si impostano cookie.
// Account Google Ads: Spigolehouse (nuovo). L'ID del tag (AW-…) non è un segreto: compare nel codice di ogni pagina che lo usa.
export const ADS_ID = "AW-18509493463";
/** Etichetta della conversione "Prenotazione diretta" (Google Ads → Obiettivi → Conversioni → Prenotazione diretta → snippet evento, parte dopo la barra di `send_to`). Finché è vuota il tag si carica ma non si invia nessuna conversione. */
export const ADS_CONVERSION_LABEL = "";

const CONSENT_KEY = "xn-consent-ads"; // "granted" | "denied"

type Gtag = (...args: unknown[]) => void;
declare global { interface Window { dataLayer?: unknown[]; gtag?: Gtag } }

export function getAdsConsent(): "granted" | "denied" | null {
  try { const v = localStorage.getItem(CONSENT_KEY); return v === "granted" || v === "denied" ? v : null; } catch { return null; }
}
export function setAdsConsent(v: "granted" | "denied"): void {
  try { localStorage.setItem(CONSENT_KEY, v); } catch { /* storage non disponibile: la scelta vale solo per questa pagina */ }
}

/** Carica il tag di Google (una sola volta). Da chiamare solo con il consenso. */
export function loadAdsTag(): void {
  if (typeof window === "undefined" || window.gtag) return;
  window.dataLayer = window.dataLayer || [];
  const gtag: Gtag = function (...args: unknown[]) { window.dataLayer!.push(args); };
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", ADS_ID);
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`;
  document.head.appendChild(s);
}

/**
 * Comunica a Google Ads una prenotazione confermata (importo in euro). Una sola volta per codice prenotazione (anche se la pagina si ricarica).
 * Non fa nulla senza consenso, senza etichetta di conversione o senza importo valido.
 */
export function trackBookingConversion(opts: { value: number; transactionId: string }): boolean {
  if (typeof window === "undefined" || !ADS_CONVERSION_LABEL) return false;
  if (getAdsConsent() !== "granted" || !window.gtag) return false;
  if (!opts.transactionId || !(opts.value >= 0)) return false;
  const key = `xn-ads-conv:${opts.transactionId}`;
  try { if (localStorage.getItem(key)) return false; localStorage.setItem(key, "1"); } catch { /* si procede: Google scarta comunque i duplicati con lo stesso transaction_id */ }
  window.gtag("event", "conversion", { send_to: `${ADS_ID}/${ADS_CONVERSION_LABEL}`, value: Math.round(opts.value * 100) / 100, currency: "EUR", transaction_id: opts.transactionId });
  return true;
}
