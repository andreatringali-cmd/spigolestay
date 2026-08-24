// Colore rappresentativo della bandiera per paese (per i grafici "provenienza").
export const FLAG_COLOR: Record<string, string> = {
  IT: "#009246", Italia: "#009246", US: "#3C3B6E", CH: "#D52B1E", DE: "#111111", ES: "#C60B1E",
  BE: "#E1A100", SE: "#006AA7", PL: "#DC143C", NL: "#FF6200", AT: "#ED2939", FR: "#0055A4", GB: "#012169",
  PT: "#006600", IE: "#169B62", DK: "#C60C30", NO: "#BA0C2F", FI: "#003580", GR: "#0D5EAF",
};
export const flagColor = (c: string) => FLAG_COLOR[c] ?? "var(--focus)";

// Gradiente CSS che riproduce la bandiera (per le colonne "provenienza").
// Le bandiere con croci/stelle (GB, US, CH, SE…) usano il colore pieno come fallback.
const IT_G = "linear-gradient(90deg,#009246 0 33.34%,#fff 33.34% 66.67%,#CE2B37 66.67%)";
export const FLAG_GRADIENT: Record<string, string> = {
  IT: IT_G, Italia: IT_G,
  FR: "linear-gradient(90deg,#0055A4 0 33.34%,#fff 33.34% 66.67%,#EF4135 66.67%)",
  DE: "linear-gradient(180deg,#000 0 33.34%,#DD0000 33.34% 66.67%,#FFCE00 66.67%)",
  ES: "linear-gradient(180deg,#AA151B 0 25%,#F1BF00 25% 75%,#AA151B 75%)",
  NL: "linear-gradient(180deg,#AE1C28 0 33.34%,#fff 33.34% 66.67%,#21468B 66.67%)",
  AT: "linear-gradient(180deg,#ED2939 0 33.34%,#fff 33.34% 66.67%,#ED2939 66.67%)",
  BE: "linear-gradient(90deg,#2D2926 0 33.34%,#FDDA24 33.34% 66.67%,#EF3340 66.67%)",
  PL: "linear-gradient(180deg,#fff 0 50%,#DC143C 50%)",
  IE: "linear-gradient(90deg,#169B62 0 33.34%,#fff 33.34% 66.67%,#FF883E 66.67%)",
  PT: "linear-gradient(90deg,#006600 0 40%,#FF0000 40%)",
};
export const flagGradient = (c: string) => FLAG_GRADIENT[c] ?? "";

// Nomi paese (in italiano) → codice ISO, per quando la provenienza è un nome e non un codice.
const NAME_TO_CC: Record<string, string> = {
  Italia: "IT", Germania: "DE", Francia: "FR", Spagna: "ES", "Regno Unito": "GB", Inghilterra: "GB",
  "Stati Uniti": "US", Olanda: "NL", "Paesi Bassi": "NL", Polonia: "PL", Svizzera: "CH", Austria: "AT",
  Belgio: "BE", Svezia: "SE", Portogallo: "PT", Irlanda: "IE", Danimarca: "DK", Norvegia: "NO",
  Finlandia: "FI", Grecia: "GR",
};
// Codice/nome paese → bandiera emoji (indicatori regionali). Ignoto → bandiera bianca.
export const flagEmoji = (c: string): string => {
  const cc = (NAME_TO_CC[c] || c || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "🏳️";
  return String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 - 65 + ch.charCodeAt(0)));
};
