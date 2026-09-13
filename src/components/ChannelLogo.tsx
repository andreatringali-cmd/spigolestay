import type { Channel } from "@/lib/types";

// Marchi OTA ricostruiti in SVG/monogramma (colori ufficiali) per indicare la provenienza
// di una prenotazione. In produzione usare gli asset ufficiali dei partner kit.
// "Bélo" di Airbnb (approssimazione riconoscibile).
const BELO =
  "M12 1.6c-.9 0-1.6.5-2.1 1.5-.4.8-.9 1.9-1.6 3.4-3.9 8.3-4.5 9.8-4.7 10.6-.3 1-.1 2.1.5 3 .8 1.2 2.1 1.9 3.5 1.9 1 0 2-.4 2.9-1.1.6-.5 1.1-1 1.6-1.6.5.6 1 1.1 1.6 1.6.9.7 1.9 1.1 2.9 1.1 1.4 0 2.7-.7 3.5-1.9.6-.9.8-2 .5-3-.2-.8-.8-2.3-4.7-10.6-.7-1.5-1.2-2.6-1.6-3.4-.5-1-1.2-1.5-2.1-1.5zm0 2c.2 0 .4.2.6.6.4.7.8 1.7 1.5 3.2 3.7 8 4.3 9.5 4.5 10.1.1.5 0 1-.3 1.4-.4.6-1.1 1-1.8 1-.5 0-1.1-.2-1.6-.6-.4-.4-.9-.8-1.4-1.4.6-.9 1-1.8 1.3-2.6.3-.9.3-1.8-.1-2.6-.5-1-1.5-1.6-2.6-1.6s-2.1.6-2.6 1.6c-.4.8-.4 1.7-.1 2.6.3.8.7 1.7 1.3 2.6-.5.6-1 1-1.4 1.4-.5.4-1.1.6-1.6.6-.7 0-1.4-.4-1.8-1-.3-.4-.4-.9-.3-1.4.2-.6.8-2.1 4.5-10.1.7-1.5 1.1-2.5 1.5-3.2.2-.4.4-.6.6-.6zm0 8.4c.4 0 .8.3 1 .7.2.4.2.9 0 1.4-.2.5-.5 1-1 1.6-.5-.6-.8-1.1-1-1.6-.2-.5-.2-1 0-1.4.2-.4.6-.7 1-.7z";

export default function ChannelLogo({ channel, size = 14, title }: { channel: Channel; size?: number; title?: string }) {
  const tileStyle = { width: size, height: size, boxShadow: "0 0 0 1px rgba(0,0,0,.14)" } as const;
  const cls = "grid shrink-0 place-items-center overflow-hidden rounded-[3px] bg-white";
  switch (channel) {
    case "booking":
      return <span className={cls} style={tileStyle} title={title ?? "Booking.com"}><span style={{ color: "#003580", fontSize: size * 0.6, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.06em" }}>B.</span></span>;
    case "airbnb":
      return <span className={cls} style={tileStyle} title={title ?? "Airbnb"}><svg width={size * 0.74} height={size * 0.74} viewBox="0 0 24 24" fill="#FF5A5F"><path d={BELO} /></svg></span>;
    case "expedia":
      return <span className={cls} style={tileStyle} title={title ?? "Expedia / Vrbo"}><span style={{ color: "#1B3A6B", fontSize: size * 0.6, fontWeight: 900, lineHeight: 1 }}>E</span></span>;
    case "other":
      return <span className={cls} style={tileStyle} title={title ?? "Altro / OTA"}><span style={{ color: "#D62828", fontSize: size * 0.44, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.04em" }}>OTA</span></span>;
    case "direct":
      /* eslint-disable-next-line @next/next/no-img-element */
      return <span className={cls} style={tileStyle} title={title ?? "Diretta · Xenora"}><img src="/xenora-mark.png" alt="Xenora" width={size} height={size} style={{ width: size * 0.82, height: size * 0.82, objectFit: "contain" }} /></span>;
    default:
      return null;
  }
}
