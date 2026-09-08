import type { ReactNode } from "react";

// Servizi/dotazioni → icona lineare MONOCROMATICA (stroke = colore corrente). Nome come tooltip.
// Condiviso tra il mini-sito pubblico e il motore prenotazioni.
export function amenityIcon(name: string) {
  const s = (name || "").toLowerCase();
  const ico = (inner: ReactNode) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{inner}</svg>;
  if (s.includes("wi") || s.includes("internet")) return ico(<><path d="M5 12.5a10 10 0 0 1 14 0" /><path d="M8.5 15.5a5 5 0 0 1 7 0" /><circle cx="12" cy="18.5" r=".6" /></>);
  if (s.includes("condizion") || s.includes("aria") || s.includes("clima")) return ico(<><path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" /></>);
  if (s.includes("riscald")) return ico(<><path d="M12 3c2.5 3 4 4.5 4 7a4 4 0 0 1-8 0c0-1.2.5-2.2 1.5-3.2" /></>);
  if (s.includes("bollit") || s.includes("kettle") || s.includes("teiera")) return ico(<><path d="M6 9h10l1 3a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5l1-3z" /><path d="M16 10l3-2" /><path d="M9 9V7a2 2 0 0 1 4 0v2" /></>);
  if (s.includes("cortesia") || s.includes("kit") || s.includes("toilet") || s.includes("sapone") || s.includes("bagnoschiuma")) return ico(<><path d="M12 3l1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4z" /><circle cx="17.5" cy="16.5" r="1.3" /></>);
  if (s.includes("parch") || s.includes("garage")) return ico(<><circle cx="12" cy="12" r="9" /><path d="M10 16.5V8h3a2.5 2.5 0 0 1 0 5h-3" /></>);
  if (s.includes("colaz")) return ico(<><path d="M4 6h11v3a5.5 5.5 0 0 1-11 0z" /><path d="M15 7h2.5a2 2 0 0 1 0 4H15" /><path d="M5 20h9" /></>);
  if (s.includes("caff")) return ico(<><path d="M6 8h9v4a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z" /><path d="M15 9h2a2 2 0 0 1 0 4h-2" /><path d="M6 20h10" /></>);
  if (s.includes("tv") || s.includes("televis")) return ico(<><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8" /></>);
  if (s.includes("vasca") || s.includes("jacuzzi") || s.includes("idromass")) return ico(<><path d="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" /><path d="M8 12V7.5a1.6 1.6 0 0 1 3.2 0" /><path d="M6.5 19l-1 2M17.5 19l1 2" /></>);
  if (s.includes("bagno") || s.includes("doccia") || s.includes("wc")) return ico(<><path d="M4 12h16" /><path d="M6 12V7a3 3 0 0 1 6 0" /><path d="M8 16v2M12 16v2M16 16v2" /></>);
  if (s.includes("piscin") || s.includes("mare")) return ico(<><path d="M3 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0" /><path d="M3 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0" /></>);
  if (s.includes("animal") || s.includes("pet")) return ico(<><circle cx="8" cy="9" r="1.3" /><circle cx="16" cy="9" r="1.3" /><circle cx="6" cy="13" r="1.3" /><circle cx="18" cy="13" r="1.3" /><path d="M12 12c-2.8 0-4.5 1.8-4.5 3.6A2.4 2.4 0 0 0 10 18h4a2.4 2.4 0 0 0 2.5-2.4c0-1.8-1.7-3.6-4.5-3.6z" /></>);
  if (s.includes("cucin") || s.includes("cottura")) return ico(<><path d="M4 10h16" /><path d="M6 10v6a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-6" /><path d="M9 10V6M12 10V6M15 10V6" /></>);
  if (s.includes("frigo") || s.includes("minibar")) return ico(<><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M6 11h12M10 6v2M10 14v3" /></>);
  if (s.includes("balcon") || s.includes("terraz")) return ico(<><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M12 4v16M4 12h16" /></>);
  if (s.includes("giardin")) return ico(<><path d="M12 21v-7" /><path d="M12 14c-4 0-6-3-6-6 4 0 6 3 6 6z" /><path d="M12 12c0-3 2-5 6-5 0 3-2 5-6 5z" /></>);
  if (s.includes("asciugacapelli") || s.includes("phon") || s.includes("fon")) return ico(<><path d="M3 8h11a3 3 0 1 0-3-3" /><path d="M3 12h13a3 3 0 1 1-3 3" /><path d="M9 12l-1 6" /></>);
  if (s.includes("cassaforte") || s.includes("safe")) return ico(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
  if (s.includes("ascensore") || s.includes("lift")) return ico(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M12 7l-2 3h4zM12 17l-2-3h4z" /></>);
  if (s.includes("lavatric")) return ico(<><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="13" r="4" /><path d="M8 6h.01M11 6h.01" /></>);
  if (s.includes("culla") || s.includes("bamb") || s.includes("bimb")) return ico(<><circle cx="12" cy="7" r="3" /><path d="M6 20a6 6 0 0 1 12 0" /></>);
  if (s.includes("non fumat")) return ico(<><circle cx="12" cy="12" r="9" /><path d="M6 12h9" /><path d="M5.5 5.5l13 13" /></>);
  if (s.includes("scrivania") || s.includes("lavoro")) return ico(<><rect x="5" y="6" width="14" height="9" rx="1" /><path d="M3 18h18" /></>);
  if (s.includes("asciugam") || s.includes("bianche") || s.includes("letto")) return ico(<><path d="M3 18V9M3 13h18v5M21 13v5" /><path d="M6 13v-2a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>);
  return ico(<><path d="M5 12l5 5L20 7" /></>);
}
