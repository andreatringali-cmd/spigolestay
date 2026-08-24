import type { ReactNode } from "react";

// Set di icone per le categorie della Prima Nota (stile MoneyPro: glifo su cerchio colorato).
// Stroke = currentColor così eredita il colore della categoria.
const P: Record<string, ReactNode> = {
  bed: <><path d="M3 8v11" /><path d="M3 13h18v6" /><path d="M21 19v-4a3 3 0 0 0-3-3h-7v4" /><circle cx="7" cy="11.5" r="1.4" /></>,
  coffee: <><path d="M4 8h13v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" /><path d="M17 9h2a2 2 0 0 1 0 4h-2" /><path d="M7 3v2M11 3v2M14 3v2" /></>,
  cash: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9v6M18 9v6" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></>,
  percent: <><path d="M19 5 5 19" /><circle cx="7.5" cy="7.5" r="2" /><circle cx="16.5" cy="16.5" r="2" /></>,
  sparkles: <><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M18 14l.7 1.8L20.5 16.5 18.7 17.2 18 19l-.7-1.8L15.5 16.5l1.8-.7z" /></>,
  bolt: <><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></>,
  wrench: <><path d="M15 3a5 5 0 0 0-4.9 6L3 16.2 6.8 20l7.2-7.1A5 5 0 0 0 21 8l-3 3-2.9-.1L15 8z" /></>,
  cart: <><circle cx="9" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /><path d="M3 4h2l2.2 11h10L20 7H6" /></>,
  file: <><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v4h4" /><path d="M9 12h6M9 16h6" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 6a3 3 0 0 1 0 6" /><path d="M18.5 20a5.5 5.5 0 0 0-2.8-4.8" /></>,
  megaphone: <><path d="M3 11v2l12 5V6z" /><path d="M15 8a4 4 0 0 1 0 8" /><path d="M5 18v3" /></>,
  home: <><path d="M3 10.5 12 4l9 6.5" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
  box: <><path d="M3 8l9-5 9 5v8l-9 5-9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  phone: <><path d="M5 3h4l2 5-2 1a11 11 0 0 0 6 6l1-2 5 2v4a1 1 0 0 1-1 1A17 17 0 0 1 4 4a1 1 0 0 1 1-1z" /></>,
  wifi: <><path d="M2.5 8.5a15 15 0 0 1 19 0" /><path d="M5.5 12a10 10 0 0 1 13 0" /><path d="M8.5 15.5a5 5 0 0 1 7 0" /><circle cx="12" cy="19" r="1" /></>,
  droplet: <><path d="M12 3s6 6 6 10a6 6 0 0 1-12 0c0-4 6-10 6-10z" /></>,
  flame: <><path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2.2-4.6C9.4 8.7 10 10 11 10c1.2 0 0-3.5 1-7z" /></>,
  car: <><path d="M3 13l2.2-5.5A2 2 0 0 1 7 6h10a2 2 0 0 1 1.8 1.5L21 13" /><path d="M3 13h18v4H3z" /><circle cx="7" cy="17.5" r="1.3" /><circle cx="17" cy="17.5" r="1.3" /></>,
  plane: <><path d="M21 3 3 11l6.5 2L12 20l2.5-6.5z" /><path d="M21 3 9.5 13" /></>,
  gift: <><rect x="3" y="8" width="18" height="4" /><path d="M5 12v9h14v-9" /><path d="M12 8v13" /><path d="M12 8C10.5 8 9 7.2 9 5.5S12 4.5 12 8c0-3.5 3-2.5 3-1s-1.5 1-3 1z" /></>,
  heart: <><path d="M12 21s-7-4.5-9-9a4.5 4.5 0 0 1 9-2 4.5 4.5 0 0 1 9 2c-2 4.5-9 9-9 9z" /></>,
  briefcase: <><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></>,
  bank: <><path d="M3 9 12 4l9 5" /><path d="M5 9v9M10 9v9M14 9v9M19 9v9" /><path d="M3 20h18" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></>,
  star: <><path d="M12 3l2.6 6 6.4.5-4.9 4 1.5 6.3L12 16.8 6.4 19.8 7.9 13.5 3 9.5l6.4-.5z" /></>,
  tag: <><path d="M3 12V4h8l9 9-8 8z" /><circle cx="7.5" cy="7.5" r="1.2" /></>,
  tv: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M8 21h8M12 6 9 3M12 6l3-3" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" /></>,
  key: <><circle cx="8" cy="8" r="4" /><path d="M11 11l9 9M16.5 16.5 19 14M20 20l1.5-1.5" /></>,
  graduation: <><path d="M2 8l10-4 10 4-10 4z" /><path d="M6 10v5c0 1.4 12 1.4 12 0v-5" /><path d="M22 8v5" /></>,
  health: <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></>,
  paw: <><circle cx="6" cy="10" r="1.6" /><circle cx="10" cy="7" r="1.6" /><circle cx="14" cy="7" r="1.6" /><circle cx="18" cy="10" r="1.6" /><path d="M8 15a4 4 0 0 1 8 0 3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3z" /></>,
  dots: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
};

export const ICON_KEYS = Object.keys(P);

export default function CatIcon({ name, size = 18, className = "" }: { name?: string; size?: number; className?: string }) {
  const inner = (name && P[name]) || P.dots;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {inner}
    </svg>
  );
}
