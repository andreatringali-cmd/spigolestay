// Lingua dell'interfaccia delle PAGINE PUBBLICHE per l'ospite (check-in, gestione prenotazione, pagamento): it · en · fr · de · es.
// Puro (niente React): la parte React è in components/GuestLang.tsx. Il dizionario ha come chiave il testo italiano
// (stesso schema di lib/i18n.tsx): se manca la traduzione resta l'italiano.

import type { GuestLang } from "./phone-country";

export const GUEST_LANGS: { code: GuestLang; flag: string; short: string; label: string }[] = [
  { code: "it", flag: "🇮🇹", short: "IT", label: "Italiano" },
  { code: "en", flag: "🇬🇧", short: "EN", label: "English" },
  { code: "fr", flag: "🇫🇷", short: "FR", label: "Français" },
  { code: "de", flag: "🇩🇪", short: "DE", label: "Deutsch" },
  { code: "es", flag: "🇪🇸", short: "ES", label: "Español" },
];

/** Dove l'ospite ricorda la lingua scelta a mano (solo preferenza di interfaccia, nessun dato personale). */
export const GUEST_LANG_KEY = "xenora:guest-lang";

/** "en-GB" / "FR" / "de_AT" → "en" | "fr" | "de"; non supportata → null. */
export function asGuestLang(v: unknown): GuestLang | null {
  const c = String(v ?? "").trim().slice(0, 2).toLowerCase();
  return GUEST_LANGS.some((l) => l.code === c) ? (c as GuestLang) : null;
}

/**
 * Lingua con cui aprire la pagina. Priorità:
 *  1. scelta a mano dell'ospite (selettore), ricordata sul telefono
 *  2. parametro ?lang= del link
 *  3. lingua ricavata dalla prenotazione (scheda ospite → Paese → prefisso del telefono)
 *  4. lingua del browser
 *  5. italiano
 */
export function pickGuestUiLang(o: { stored?: unknown; param?: unknown; detected?: unknown; browser?: unknown }): GuestLang {
  return asGuestLang(o.stored) ?? asGuestLang(o.param) ?? asGuestLang(o.detected) ?? asGuestLang(o.browser) ?? "it";
}

/** Traduzioni: chiave = testo italiano; valori in ordine [en, fr, de, es]. */
export type GuestDict = Record<string, readonly [string, string, string, string]>;
const IDX: Record<Exclude<GuestLang, "it">, number> = { en: 0, fr: 1, de: 2, es: 3 };

/** Sostituisce {nome} con i valori di `vars` (anche nel testo italiano di partenza). */
export function fillVars(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Testo nella lingua richiesta; italiano o traduzione mancante → il testo italiano. */
export function translate(dict: GuestDict, lang: GuestLang, text: string, vars?: Record<string, string | number>): string {
  if (lang === "it") return fillVars(text, vars);
  const hit = dict[text];
  const out = hit && hit[IDX[lang]] ? hit[IDX[lang]] : text;
  return fillVars(out, vars);
}

/** Locale per date e numeri nella lingua dell'ospite. */
export function dateLocale(lang: GuestLang): string {
  return ({ it: "it-IT", en: "en-GB", fr: "fr-FR", de: "de-DE", es: "es-ES" } as const)[lang];
}

/** Lingua del browser (navigator.language) se è una delle supportate. */
export function browserGuestLang(languages: readonly string[] | undefined): GuestLang | null {
  for (const l of languages ?? []) { const g = asGuestLang(l); if (g) return g; }
  return null;
}
