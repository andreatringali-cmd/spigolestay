import type { Channel } from "@/lib/types";

// Marchi canale su tessere colorate uniformi (colori ufficiali, glifi bianchi) per indicare la
// provenienza di una prenotazione. In produzione usare gli asset ufficiali dei partner kit.
// "Bélo" di Airbnb (approssimazione riconoscibile).
const BELO =
  "M12 1.6c-.9 0-1.6.5-2.1 1.5-.4.8-.9 1.9-1.6 3.4-3.9 8.3-4.5 9.8-4.7 10.6-.3 1-.1 2.1.5 3 .8 1.2 2.1 1.9 3.5 1.9 1 0 2-.4 2.9-1.1.6-.5 1.1-1 1.6-1.6.5.6 1 1.1 1.6 1.6.9.7 1.9 1.1 2.9 1.1 1.4 0 2.7-.7 3.5-1.9.6-.9.8-2 .5-3-.2-.8-.8-2.3-4.7-10.6-.7-1.5-1.2-2.6-1.6-3.4-.5-1-1.2-1.5-2.1-1.5zm0 2c.2 0 .4.2.6.6.4.7.8 1.7 1.5 3.2 3.7 8 4.3 9.5 4.5 10.1.1.5 0 1-.3 1.4-.4.6-1.1 1-1.8 1-.5 0-1.1-.2-1.6-.6-.4-.4-.9-.8-1.4-1.4.6-.9 1-1.8 1.3-2.6.3-.9.3-1.8-.1-2.6-.5-1-1.5-1.6-2.6-1.6s-2.1.6-2.6 1.6c-.4.8-.4 1.7-.1 2.6.3.8.7 1.7 1.3 2.6-.5.6-1 1-1.4 1.4-.5.4-1.1.6-1.6.6-.7 0-1.4-.4-1.8-1-.3-.4-.4-.9-.3-1.4.2-.6.8-2.1 4.5-10.1.7-1.5 1.1-2.5 1.5-3.2.2-.4.4-.6.6-.6zm0 8.4c.4 0 .8.3 1 .7.2.4.2.9 0 1.4-.2.5-.5 1-1 1.6-.5-.6-.8-1.1-1-1.6-.2-.5-.2-1 0-1.4.2-.4.6-.7 1-.7z";
// Globo (Altro / OTA generica).
const GLOBE = "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2c1.4 0 2.7 2.2 3.3 5.5H8.7C9.3 6.2 10.6 4 12 4zM6.6 9.5C7 6.9 8 4.8 9.3 4.4A8 8 0 0 0 4.6 9.5h2zm-2 2A8 8 0 0 0 4.6 14.5h2c-.1-1-.1-2 0-3H4.6zm2 5h-2A8 8 0 0 0 9.3 19.6C8 19.2 7 17.1 6.6 16.5zM12 20c-1.4 0-2.7-2.2-3.3-5.5h6.6C14.7 17.8 13.4 20 12 20zm-3.5-7.5c-.1-1-.1-2 0-3h7c.1 1 .1 2 0 3h-7zm6.2 7.1c1.3-.4 2.3-2.5 2.7-5.1h2a8 8 0 0 1-4.7 5.1zm2.7-7.1c.1-1 .1-2 0-3h2c.3 1 .3 2 0 3h-2zm-.7-5c-.4-2.6-1.4-4.7-2.7-5.1a8 8 0 0 1 4.7 5.1h-2z";

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
      return <Tile bg="#64748B" t="Altro / OTA"><svg width={size * 0.7} height={size * 0.7} viewBox="0 0 24 24" fill="#fff"><path d={GLOBE} /></svg></Tile>;
    case "direct":
      /* eslint-disable-next-line @next/next/no-img-element */
      return <Tile bg="#fff" t="Diretta · Xenora"><img src="/xenora-mark.png" alt="Xenora" width={size} height={size} style={{ width: size * 0.86, height: size * 0.86, objectFit: "contain" }} /></Tile>;
    default:
      return null;
  }
}
