// Google Ads: misurazione delle prenotazioni dirette (conversioni), per struttura.
// Ogni struttura può avere il PROPRIO account Google Ads: in Impostazioni → Google Ads si inseriscono l'ID del tag (AW-…) e l'etichetta della conversione
// (Google Ads → Obiettivi → Conversioni → la conversione → snippet evento: parte dopo la barra di `send_to`). Non sono segreti: compaiono nel codice di ogni pagina che li usa.
// Il tag si carica SOLO dopo il consenso esplicito del visitatore (GDPR): prima non viene caricato nulla e non si impostano cookie.
// Senza ID configurato per la struttura la pagina di prenotazione non carica nulla e non mostra l'avviso cookie.

export interface AdsConfig { id: string; label: string }

const ID_RE = /^AW-\d{6,15}$/;
const LABEL_RE = /^[A-Za-z0-9_-]{8,40}$/;
export const isValidAdsId = (s: unknown): s is string => typeof s === "string" && ID_RE.test(s.trim());
export const isValidAdsLabel = (s: unknown): s is string => typeof s === "string" && LABEL_RE.test(s.trim());

/** Account Google Ads di Spigolehouse. Finché i campi non sono compilati nelle strutture (Impostazioni → Google Ads), le tre strutture di questo account usano questi valori. */
const LEGACY: Record<string, AdsConfig> = (() => {
  const c: AdsConfig = { id: "AW-18509493463", label: "cx6hCPOAmpsdENfpgfpE" };
  return { spigolehouse: c, spigolerooms: c, "central-perk": c };
})();

type StructLike = { googleAdsId?: string; googleAdsLabel?: string };

/** Configurazione di una struttura: l'ID è obbligatorio; l'etichetta no (senza, il tag si carica ma non si inviano conversioni). */
export function adsConfigOf(s: StructLike | undefined | null): AdsConfig | null {
  const id = (s?.googleAdsId ?? "").trim();
  if (!isValidAdsId(id)) return null;
  const label = (s?.googleAdsLabel ?? "").trim();
  return { id, label: isValidAdsLabel(label) ? label : "" };
}

/**
 * Quale account Google Ads vale per il sito pubblico `slug`? Prima quello impostato sulla struttura (la prima che ne ha uno), poi i valori storici di Spigolehouse.
 * Nessuno per gli altri siti: il tag e l'avviso cookie non compaiono.
 */
export function resolveAdsConfig(slug: string | null | undefined, structures: readonly StructLike[]): AdsConfig | null {
  for (const s of structures) { const c = adsConfigOf(s); if (c) return c; }
  return LEGACY[(slug ?? "").trim().toLowerCase()] ?? null;
}

const CONSENT_KEY = "xn-consent-ads"; // "granted" | "denied"

type Gtag = (...args: unknown[]) => void;
declare global { interface Window { dataLayer?: unknown[]; gtag?: Gtag } }

export function getAdsConsent(): "granted" | "denied" | null {
  try { const v = localStorage.getItem(CONSENT_KEY); return v === "granted" || v === "denied" ? v : null; } catch { return null; }
}
export function setAdsConsent(v: "granted" | "denied"): void {
  try { localStorage.setItem(CONSENT_KEY, v); } catch { /* storage non disponibile: la scelta vale solo per questa pagina */ }
}

const configured = new Set<string>();

/** Carica il tag di Google (una sola volta) e lo configura per l'account indicato. Da chiamare solo con il consenso. */
export function loadAdsTag(cfg: AdsConfig): void {
  if (typeof window === "undefined" || !isValidAdsId(cfg?.id)) return;
  if (!window.gtag) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function (...args: unknown[]) { window.dataLayer!.push(args); } as Gtag;
    window.gtag("js", new Date());
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${cfg.id}`;
    document.head.appendChild(s);
  }
  if (!configured.has(cfg.id)) { configured.add(cfg.id); window.gtag("config", cfg.id); }
}

/**
 * Comunica a Google Ads una prenotazione confermata (importo in euro). Una sola volta per account e codice prenotazione (anche se la pagina si ricarica).
 * Non fa nulla senza consenso, senza account/etichetta valide o senza importo valido.
 */
export function trackBookingConversion(cfg: AdsConfig | null, opts: { value: number; transactionId: string }): boolean {
  if (typeof window === "undefined" || !cfg || !isValidAdsId(cfg.id) || !isValidAdsLabel(cfg.label)) return false;
  if (getAdsConsent() !== "granted" || !window.gtag) return false;
  if (!opts.transactionId || !(opts.value >= 0)) return false;
  const key = `xn-ads-conv:${cfg.id}:${opts.transactionId}`;
  try { if (localStorage.getItem(key) || localStorage.getItem(`xn-ads-conv:${opts.transactionId}`)) return false; localStorage.setItem(key, "1"); } catch { /* si procede: Google scarta comunque i duplicati con lo stesso transaction_id */ }
  window.gtag("event", "conversion", { send_to: `${cfg.id}/${cfg.label}`, value: Math.round(opts.value * 100) / 100, currency: "EUR", transaction_id: opts.transactionId });
  return true;
}

/** Estrae ID del tag e/o etichetta da un testo incollato (codice del tag Google o snippet evento di Google Ads). */
export function extractAdsFromText(text: string): { id?: string; label?: string } {
  const t = String(text || "");
  const withLabel = t.match(/(AW-\d{6,15})\s*\/\s*([A-Za-z0-9_-]{8,40})/);
  if (withLabel) return { id: withLabel[1], label: withLabel[2] };
  const idOnly = t.match(/AW-\d{6,15}/);
  if (idOnly) return { id: idOnly[0] };
  const label = t.trim();
  return isValidAdsLabel(label) && label.length >= 12 ? { label } : {};
}
