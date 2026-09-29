// ============================================================
//  Helper condivisi dell'anteprima XenoraBook (lista + scheda struttura).
//  Il catalogo è SEMPRE reale: viene letto dall'API pubblica
//  /api/xenorabook/listings (tabella Supabase public_sites), mai da un
//  dataset finto. Qui restano solo i tipi condivisi e i pezzi puramente
//  grafici (segnaposto quando una struttura non ha ancora caricato foto).
// ============================================================
import type { ReactElement } from "react";
import type { ListingRoom, XenoraBookListing } from "@/app/api/xenorabook/listings/route";

export type { ListingRoom, XenoraBookListing };
export type Listing = XenoraBookListing;
export type Room = ListingRoom;

export const stars = (n: number) => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));

// Segnaposto onesto (skyline + arco, colorato per hue) per una struttura che non
// ha ancora caricato foto vere: MAI spacciato per una fotografia reale.
export function StructImg({ hue, initial, className }: { hue: number; initial: string; className?: string }): ReactElement {
  const h2 = (hue + 28) % 360; const id = `sb${hue}`;
  return (
    <svg viewBox="0 0 400 300" className={className ?? "h-full w-full object-cover"} preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={`hsl(${hue},46%,58%)`} /><stop offset="1" stopColor={`hsl(${h2},42%,44%)`} /></linearGradient></defs>
      <rect width="400" height="300" fill={`url(#${id})`} />
      <g fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M96 210 v-70 a56 56 0 0 1 112 0 v70" /><path d="M150 210 v-42 a26 26 0 0 1 52 0 v42" />
        <path d="M232 210 v-96 l58 -34 v130" /><line x1="70" y1="212" x2="318" y2="212" />
      </g>
      <circle cx="316" cy="70" r="20" fill="#fff" fillOpacity="0.9" />
      <text x="316" y="77" textAnchor="middle" fontFamily="Georgia,serif" fontSize="22" fontWeight="700" fill={`hsl(${hue},46%,40%)`}>{initial}</text>
    </svg>
  );
}

// Foto reale se disponibile, altrimenti il segnaposto onesto sopra.
export function ListingImage({ src, hue, initial, className }: { src?: string | null; hue: number; initial: string; className?: string }): ReactElement {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={className ?? "h-full w-full object-cover"} />;
  }
  return <StructImg hue={hue} initial={initial} className={className} />;
}
