import type { Channel } from "@/lib/types";

// Marchi canale su tessere rotonde uniformi (stessa forma per tutti, colori ufficiali, glifi
// bianchi) per indicare la provenienza di una prenotazione. Airbnb usa il marchio ufficiale
// (via Simple Icons, CC0); Expedia è una resa semplificata del marchio (quadrato giallo con freccia blu scuro);
// Booking.com resta la sigla "B." (il logo ufficiale a dimensioni piccole risultava poco leggibile); HotelBeds:
// marchio ufficiale non verificato, resa neutra (sigla) finché non si carica il file ufficiale.
const BELO =
  "M12.001 18.275c-1.353-1.697-2.148-3.184-2.413-4.457-.263-1.027-.16-1.848.291-2.465.477-.71 1.188-1.056 2.121-1.056s1.643.345 2.12 1.063c.446.61.558 1.432.286 2.465-.291 1.298-1.085 2.785-2.412 4.458zm9.601 1.14c-.185 1.246-1.034 2.28-2.2 2.783-2.253.98-4.483-.583-6.392-2.704 3.157-3.951 3.74-7.028 2.385-9.018-.795-1.14-1.933-1.695-3.394-1.695-2.944 0-4.563 2.49-3.927 5.382.37 1.565 1.352 3.343 2.917 5.332-.98 1.085-1.91 1.856-2.732 2.333-.636.344-1.245.558-1.828.609-2.679.399-4.778-2.2-3.825-4.88.132-.345.395-.98.845-1.961l.025-.053c1.464-3.178 3.242-6.79 5.285-10.795l.053-.132.58-1.116c.45-.822.635-1.19 1.351-1.643.346-.21.77-.315 1.246-.315.954 0 1.698.558 2.016 1.007.158.239.345.557.582.953l.558 1.089.08.159c2.041 4.004 3.821 7.608 5.279 10.794l.026.025.533 1.22.318.764c.243.613.294 1.222.213 1.858zm1.22-2.39c-.186-.583-.505-1.271-.9-2.094v-.03c-1.889-4.006-3.642-7.608-5.307-10.844l-.111-.163C15.317 1.461 14.468 0 12.001 0c-2.44 0-3.476 1.695-4.535 3.898l-.081.16c-1.669 3.236-3.421 6.843-5.303 10.847v.053l-.559 1.22c-.21.504-.317.768-.345.847C-.172 20.74 2.611 24 5.98 24c.027 0 .132 0 .265-.027h.372c1.75-.213 3.554-1.325 5.384-3.317 1.829 1.989 3.635 3.104 5.382 3.317h.372c.133.027.239.027.265.027 3.37.003 6.152-3.261 4.802-6.975z";

export default function ChannelLogo({ channel, size = 16, title }: { channel: Channel; size?: number; title?: string }) {
  const box = { width: size, height: size } as const;
  const Tile = ({ bg, children, t }: { bg: string; children: React.ReactNode; t: string }) => (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-full" style={{ ...box, backgroundColor: bg, boxShadow: "0 0 0 1px rgba(0,0,0,.10)" }} title={title ?? t}>{children}</span>
  );
  switch (channel) {
    case "booking":
      return <Tile bg="#003B95" t="Booking.com"><span style={{ color: "#fff", fontSize: size * 0.58, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.06em" }}>B.</span></Tile>;
    case "airbnb":
      return <Tile bg="#FF385C" t="Airbnb"><svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="#fff"><path d={BELO} /></svg></Tile>;
    case "expedia":
      return <Tile bg="#FEC84C" t="Expedia / Vrbo"><svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="#202843" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 18 18 6" /><path d="M8.5 6H18v9.5" /></svg></Tile>;
    case "hotelbeds":
      return <Tile bg="#E8EBF0" t="HotelBeds"><span style={{ color: "#2B3340", fontSize: size * 0.46, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.05em" }}>hb</span></Tile>;
    case "other":
      return <Tile bg="#5B5F6B" t="Altro / OTA"><svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5l3 2" /></svg></Tile>;
    case "direct":
      /* eslint-disable-next-line @next/next/no-img-element */
      return <Tile bg="#fff" t="Diretta · Xenora"><img src="/xenora-mark.png" alt="Xenora" width={size} height={size} style={{ width: size * 0.8, height: size * 0.8, objectFit: "contain" }} /></Tile>;
    default:
      return null;
  }
}

// Logo PER INTERO del canale (marchio con il nome, non la sola icona rotonda): per Booking.com, Airbnb, Expedia, HotelBeds
// e per le prenotazioni dirette Xenora (logo completo con la farfalla). Su fondo bianco, leggibile anche in tema scuro.
export function ChannelWordmark({ channel, height = 20, title }: { channel: Channel; height?: number; title?: string }) {
  const fs = Math.round(height * 0.78);
  const base = { fontSize: fs, lineHeight: 1, fontWeight: 800, letterSpacing: "-0.035em", whiteSpace: "nowrap" } as const;
  const chip = (t: string, children: React.ReactNode) => (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-1.5" style={{ height: height + 6, boxShadow: "0 0 0 1px rgba(0,0,0,.09)" }} title={title ?? t}>{children}</span>
  );
  switch (channel) {
    case "booking":
      return chip("Booking.com", <span style={{ ...base, color: "#003B95" }}>Booking<span style={{ color: "#009FE3" }}>.com</span></span>);
    case "airbnb":
      return chip("Airbnb", <><svg width={height * 0.8} height={height * 0.8} viewBox="0 0 24 24" fill="#FF385C" aria-hidden><path d={BELO} /></svg><span style={{ ...base, color: "#FF385C", letterSpacing: "-0.045em" }}>airbnb</span></>);
    case "expedia":
      return chip("Expedia / Vrbo", <><span aria-hidden style={{ width: height * 0.95, height: height * 0.95, borderRadius: height * 0.24, background: "#FEC84C", display: "inline-grid", placeItems: "center", flexShrink: 0 }}><svg width={height * 0.6} height={height * 0.6} viewBox="0 0 24 24" fill="none" stroke="#202843" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 18 18 6" /><path d="M8.5 6H18v9.5" /></svg></span><span style={{ ...base, color: "#202843" }}>Expedia</span></>);
    case "hotelbeds":
      return chip("HotelBeds", <span style={{ ...base, color: "#2B3340" }}>hotelbeds</span>);
    case "other":
      return chip("Altro / OTA", <span style={{ ...base, fontSize: Math.round(fs * 0.85), color: "#5B5F6B" }}>OTA</span>);
    case "direct":
      /* eslint-disable-next-line @next/next/no-img-element */
      return <span className="inline-flex shrink-0 items-center rounded-md bg-white px-1.5" style={{ height: height + 6, boxShadow: "0 0 0 1px rgba(0,0,0,.09)" }} title={title ?? "Diretta · Xenora"}><img src="/xenora-logo.png" alt="Xenora" style={{ height: height, width: "auto", objectFit: "contain" }} /></span>;
    default:
      return null;
  }
}
