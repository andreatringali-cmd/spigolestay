// Copia "da un'altra struttura" nella Guida ospiti.
// Whitelist: si copiano SOLO i testi (content), le traduzioni già fatte (i18n) e, a richiesta,
// la TV (tv) e il messaggio di benvenuto (inviteMsg). Tutto il resto resta della struttura di destinazione:
// id, nome, città, indirizzo, contatti, WiFi (+QR), orari, link, branding, social, tipologie camere.
// I codici serratura non stanno mai nella guida (localStorage "spigolestay:roomaccess"): non possono finire nel patch.

export interface GuideCopySource {
  content?: unknown;
  i18n?: unknown;
  tv?: unknown;
  inviteMsg?: string;
}

export interface GuideCopyOptions {
  tv?: boolean;
  inviteMsg?: boolean;
}

export interface GuideCopyPatch {
  content?: unknown;
  i18n?: unknown;
  tv?: unknown;
  inviteMsg?: string;
}

/** Copia profonda di dati JSON (la guida è serializzabile: viene già salvata come JSON). */
const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/**
 * Calcola il patch da applicare alla guida di destinazione partendo da quella sorgente.
 * `dst` non viene letto né modificato: serve solo per tenere la firma simmetrica e per eventuali estensioni.
 * Il patch contiene solo chiavi presenti nella sorgente; content/i18n/tv sono copie profonde.
 */
export function copyGuideContent(src: GuideCopySource, _dst?: unknown, opts: GuideCopyOptions = {}): GuideCopyPatch {
  const patch: GuideCopyPatch = {};
  if (src.content !== undefined) patch.content = clone(src.content);
  // Le traduzioni vanno sempre insieme ai testi: senza, partirebbe la ri-traduzione.
  patch.i18n = src.i18n !== undefined && src.content !== undefined ? clone(src.i18n) : {};
  if (opts.tv && src.tv !== undefined) patch.tv = clone(src.tv);
  if (opts.inviteMsg && typeof src.inviteMsg === "string" && src.inviteMsg.trim()) patch.inviteMsg = src.inviteMsg;
  return patch;
}

/** Vero se la sorgente ha dei testi da copiare. */
export const canCopyGuide = (src?: GuideCopySource | null): boolean => !!src && src.content !== undefined && src.content !== null;

/** Vero se i testi contengono davvero qualcosa (non solo lo scaffold vuoto): stessa logica di "hasRealContent" della pagina. */
export function guideHasText(content: unknown): boolean {
  const c = content as {
    home?: { welcomeTitle?: string; welcomeSub?: string; welcome?: string[] };
    sections?: { intro?: string; photos?: unknown[]; amenities?: unknown[]; items?: { h?: string; p?: string; list?: unknown[] }[]; steps?: { h?: string; p?: string }[] }[];
  } | null | undefined;
  if (!c) return false;
  const h = c.home;
  if (h && (h.welcomeTitle?.trim() || h.welcomeSub?.trim() || (h.welcome ?? []).join("").trim())) return true;
  return (c.sections ?? []).some((s) =>
    !!s.intro?.trim() || !!s.photos?.length || !!s.amenities?.length ||
    !!s.items?.some((it) => it.h?.trim() || it.p?.trim() || (it.list?.length ?? 0) > 0) ||
    !!s.steps?.some((st) => st.h?.trim() || st.p?.trim()));
}
