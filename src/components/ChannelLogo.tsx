import type { Channel } from "@/lib/types";

// Marchi canale su tessere rotonde uniformi (stessa forma per tutti, colori ufficiali, glifi
// bianchi) per indicare la provenienza di una prenotazione. I glifi di Booking.com/Airbnb/Expedia
// sono i marchi ufficiali (via Simple Icons, CC0); HotelBeds non ha un'icona di marca diffusa
// pubblicamente, resta un'approssimazione.
const BOOKING_GLYPH =
  "M24 0H0v24h24ZM8.575 6.563h2.658c2.108 0 3.473 1.15 3.473 2.898 0 1.15-.575 1.82-.91 2.108l-.287.263.335.192c.815.479 1.318 1.389 1.318 2.395 0 1.988-1.51 3.257-3.857 3.257H7.449V7.713c0-.623.503-1.126 1.126-1.15zm1.7 1.868c-.479.024-.694.264-.694.79v1.893h1.676c.958 0 1.294-.743 1.294-1.365 0-.815-.503-1.318-1.318-1.318zm-.096 4.36c-.407.071-.598.31-.598.79v2.251h1.868c.934 0 1.509-.55 1.509-1.533 0-.934-.599-1.509-1.51-1.509zm7.737 2.394c.743 0 1.341.599 1.341 1.342a1.34 1.34 0 0 1-1.341 1.341 1.355 1.355 0 0 1-1.341-1.341c0-.743.598-1.342 1.34-1.342z";
const BELO =
  "M12.001 18.275c-1.353-1.697-2.148-3.184-2.413-4.457-.263-1.027-.16-1.848.291-2.465.477-.71 1.188-1.056 2.121-1.056s1.643.345 2.12 1.063c.446.61.558 1.432.286 2.465-.291 1.298-1.085 2.785-2.412 4.458zm9.601 1.14c-.185 1.246-1.034 2.28-2.2 2.783-2.253.98-4.483-.583-6.392-2.704 3.157-3.951 3.74-7.028 2.385-9.018-.795-1.14-1.933-1.695-3.394-1.695-2.944 0-4.563 2.49-3.927 5.382.37 1.565 1.352 3.343 2.917 5.332-.98 1.085-1.91 1.856-2.732 2.333-.636.344-1.245.558-1.828.609-2.679.399-4.778-2.2-3.825-4.88.132-.345.395-.98.845-1.961l.025-.053c1.464-3.178 3.242-6.79 5.285-10.795l.053-.132.58-1.116c.45-.822.635-1.19 1.351-1.643.346-.21.77-.315 1.246-.315.954 0 1.698.558 2.016 1.007.158.239.345.557.582.953l.558 1.089.08.159c2.041 4.004 3.821 7.608 5.279 10.794l.026.025.533 1.22.318.764c.243.613.294 1.222.213 1.858zm1.22-2.39c-.186-.583-.505-1.271-.9-2.094v-.03c-1.889-4.006-3.642-7.608-5.307-10.844l-.111-.163C15.317 1.461 14.468 0 12.001 0c-2.44 0-3.476 1.695-4.535 3.898l-.081.16c-1.669 3.236-3.421 6.843-5.303 10.847v.053l-.559 1.22c-.21.504-.317.768-.345.847C-.172 20.74 2.611 24 5.98 24c.027 0 .132 0 .265-.027h.372c1.75-.213 3.554-1.325 5.384-3.317 1.829 1.989 3.635 3.104 5.382 3.317h.372c.133.027.239.027.265.027 3.37.003 6.152-3.261 4.802-6.975z";
const EXPEDIA_GLYPH =
  "M19.067 0H4.933A4.94 4.94 0 0 0 0 4.933v14.134A4.932 4.932 0 0 0 4.933 24h14.134A4.932 4.932 0 0 0 24 19.067V4.933C24.01 2.213 21.797 0 19.067 0ZM7.336 19.341c0 .19-.148.337-.337.337h-2.33a.333.333 0 0 1-.337-.337v-2.33c0-.189.148-.336.337-.336H7c.19 0 .337.147.337.337zm12.121-1.486-2.308 2.298c-.169.168-.422.053-.422-.2V9.57l-6.44 6.44a.533.533 0 0 1-.421.17H8.169a.32.32 0 0 1-.338-.338v-1.697c0-.2.053-.316.169-.422l6.44-6.44H4.058c-.253 0-.369-.253-.2-.421l2.297-2.309c.137-.137.285-.232.517-.232H18.15c.854 0 1.539.686 1.539 1.54v11.478c-.01.231-.095.368-.232.516z";

export default function ChannelLogo({ channel, size = 16, title }: { channel: Channel; size?: number; title?: string }) {
  const box = { width: size, height: size } as const;
  const Tile = ({ bg, children, t }: { bg: string; children: React.ReactNode; t: string }) => (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-full" style={{ ...box, backgroundColor: bg, boxShadow: "0 0 0 1px rgba(0,0,0,.10)" }} title={title ?? t}>{children}</span>
  );
  switch (channel) {
    case "booking":
      return <Tile bg="#003580" t="Booking.com"><svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="#fff"><path d={BOOKING_GLYPH} /></svg></Tile>;
    case "airbnb":
      return <Tile bg="#FF385C" t="Airbnb"><svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="#fff"><path d={BELO} /></svg></Tile>;
    case "expedia":
      return <Tile bg="#FFC72C" t="Expedia / Vrbo"><svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="#0A2A66"><path d={EXPEDIA_GLYPH} /></svg></Tile>;
    case "hotelbeds":
      return <Tile bg="#fff" t="HotelBeds"><svg width={size * 0.85} height={size * 0.85} viewBox="0 0 24 24"><rect x="1" y="5.5" width="7" height="7" fill="#A6DED2" /><rect x="1" y="12.5" width="7" height="7" fill="#A21A54" /><text x="10.5" y="18.5" fontFamily="Arial, sans-serif" fontSize="16" fontWeight="800" fill="#14284A">h</text></svg></Tile>;
    case "other":
      return <Tile bg="#5B5F6B" t="Altro / OTA"><svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5l3 2" /></svg></Tile>;
    case "direct":
      /* eslint-disable-next-line @next/next/no-img-element */
      return <Tile bg="#fff" t="Diretta · Xenora"><img src="/xenora-mark.png" alt="Xenora" width={size} height={size} style={{ width: size * 0.8, height: size * 0.8, objectFit: "contain" }} /></Tile>;
    default:
      return null;
  }
}
