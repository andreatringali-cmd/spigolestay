// Etichette delle pagine di pagamento Stripe nella lingua dell'ospite (puro). Le sessioni Checkout sono intestate alla piattaforma ma lette
// dall'ospite: "Soggiorno", "notti", "Rif." e "caparra" devono essere nella sua lingua, non sempre in italiano.
export type PayLang = "it" | "en" | "fr" | "de" | "es";
export const PAY_LANGS: PayLang[] = ["it", "en", "fr", "de", "es"];

const L: Record<PayLang, { stay: string; night: string; nights: string; ref: string; deposit: string; balance: string; cityTax: string }> = {
  it: { stay: "Soggiorno", night: "notte", nights: "notti", ref: "Rif.", deposit: "caparra", balance: "Saldo soggiorno", cityTax: "Tassa di soggiorno" },
  en: { stay: "Stay", night: "night", nights: "nights", ref: "Ref.", deposit: "deposit", balance: "Stay balance", cityTax: "City tax" },
  fr: { stay: "Séjour", night: "nuit", nights: "nuits", ref: "Réf.", deposit: "acompte", balance: "Solde du séjour", cityTax: "Taxe de séjour" },
  de: { stay: "Aufenthalt", night: "Nacht", nights: "Nächte", ref: "Ref.", deposit: "Anzahlung", balance: "Restbetrag Aufenthalt", cityTax: "Kurtaxe" },
  es: { stay: "Estancia", night: "noche", nights: "noches", ref: "Ref.", deposit: "depósito", balance: "Saldo de la estancia", cityTax: "Tasa turística" },
};

export const asPayLang = (v: unknown): PayLang | undefined => (typeof v === "string" && (PAY_LANGS as string[]).includes(v) ? (v as PayLang) : undefined);
export const payLabels = (lang?: PayLang) => L[lang ?? "it"];
export const nightsLabel = (n: number, lang?: PayLang) => `${n} ${n === 1 ? L[lang ?? "it"].night : L[lang ?? "it"].nights}`;
