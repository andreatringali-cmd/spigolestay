import type { Channel } from "@/lib/types";

// Marchi canale su tessere colorate uniformi (colori ufficiali, glifi bianchi) per indicare la
// provenienza di una prenotazione. In produzione usare gli asset ufficiali dei partner kit.
// "Bélo" di Airbnb (approssimazione riconoscibile).
const BELO =
  "M12 1.6c-.9 0-1.6.5-2.1 1.5-.4.8-.9 1.9-1.6 3.4-3.9 8.3-4.5 9.8-4.7 10.6-.3 1-.1 2.1.5 3 .8 1.2 2.1 1.9 3.5 1.9 1 0 2-.4 2.9-1.1.6-.5 1.1-1 1.6-1.6.5.6 1 1.1 1.6 1.6.9.7 1.9 1.1 2.9 1.1 1.4 0 2.7-.7 3.5-1.9.6-.9.8-2 .5-3-.2-.8-.8-2.3-4.7-10.6-.7-1.5-1.2-2.6-1.6-3.4-.5-1-1.2-1.5-2.1-1.5zm0 2c.2 0 .4.2.6.6.4.7.8 1.7 1.5 3.2 3.7 8 4.3 9.5 4.5 10.1.1.5 0 1-.3 1.4-.4.6-1.1 1-1.8 1-.5 0-1.1-.2-1.6-.6-.4-.4-.9-.8-1.4-1.4.6-.9 1-1.8 1.3-2.6.3-.9.3-1.8-.1-2.6-.5-1-1.5-1.6-2.6-1.6s-2.1.6-2.6 1.6c-.4.8-.4 1.7-.1 2.6.3.8.7 1.7 1.3 2.6-.5.6-1 1-1.4 1.4-.5.4-1.1.6-1.6.6-.7 0-1.4-.4-1.8-1-.3-.4-.4-.9-.3-1.4.2-.6.8-2.1 4.5-10.1.7-1.5 1.1-2.5 1.5-3.2.2-.4.4-.6.6-.6zm0 8.4c.4 0 .8.3 1 .7.2.4.2.9 0 1.4-.2.5-.5 1-1 1.6-.5-.6-.8-1.1-1-1.6-.2-.5-.2-1 0-1.4.2-.4.6-.7 1-.7z";

export default function ChannelLogo({ channel, size = 16, title }: { channel: Channel; size?: number; title?: string }) {
  const box = { width: size, height: size } as const;
  const Tile = ({ bg, children, t }: { bg: string; children: React.ReactNode; t: string }) => (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-md" style={{ ...box, backgroundColor: bg, boxShadow: "0 0 0 1px rgba(0,0,0,.10)" }} title={title ?? t}>{children}</span>
  );
  switch (channel) {
    case "booking":
      return <Tile bg="#003B95" t="Booking.com"><span style={{ color: "#fff", fontSize: size * 0.58, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.06em" }}>B.</span></Tile>;
    case "airbnb":
      return <Tile bg="#FF385C" t="Airbnb"><svg width={size * 0.66} height={size * 0.66} viewBox="0 0 24 24" fill="#fff"><path d={BELO} /></svg></Tile>;
    case "expedia":
      return <Tile bg="#FFC72C" t="Expedia / Vrbo"><svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="#0A2A66"><path d="M2 21l20-9L2 3v6.5l13 2.5-13 2.5z" /></svg></Tile>;
    case "other":
      return <Tile bg="#0E86C7" t="HotelBeds"><svg width={size * 0.72} height={size * 0.72} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5v14" /><path d="M2 10h16a4 4 0 0 1 4 4v5" /><path d="M2 15h20" /><circle cx="7" cy="8" r="1.6" fill="#fff" stroke="none" /></svg></Tile>;
    case "direct":
      /* eslint-disable-next-line @next/next/no-img-element */
      return <Tile bg="#fff" t="Diretta · Xenora"><img src="/xenora-mark.png" alt="Xenora" width={size} height={size} style={{ width: size * 0.86, height: size * 0.86, objectFit: "contain" }} /></Tile>;
    default:
      return null;
  }
}
