"use client";

import ChannelLogo, { ChannelWordmark } from "@/components/ChannelLogo";
import MediaImg from "@/components/MediaImg";
import { useData } from "@/lib/store";
import { directOriginLabel, directOriginOf, type DirectOriginInput } from "@/lib/direct-origin";
import type { Channel, Structure } from "@/lib/types";

type BookingLike = DirectOriginInput & { channel: Channel; structureId?: string };

function initialsOf(name?: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

// Prenotazione dal sito ufficiale: logo della struttura (o, se manca, iniziali su colore identità) in una tessera tonda come gli altri loghi.
function SiteLogo({ structureId, structure, size }: { structureId?: string; structure?: Pick<Structure, "name" | "logo" | "photoColor"> | null; size: number }) {
  const { getStructure } = useData();
  const st = structure ?? (structureId ? getStructure(structureId) : undefined);
  const initials = (
    <span style={{ color: "#fff", fontSize: size * 0.42, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.02em" }}>{initialsOf(st?.name)}</span>
  );
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full"
      style={{ width: size, height: size, backgroundColor: st?.logo ? "#fff" : st?.photoColor || "#4F46E5", boxShadow: "0 0 0 1px rgba(0,0,0,.10)" }}
      title={directOriginLabel("sito", st?.name)}
    >
      {st?.logo
        ? <MediaImg src={st.logo} alt={st.name ?? ""} style={{ width: size * 0.84, height: size * 0.84, objectFit: "contain" }} fallback={initials} />
        : initials}
    </span>
  );
}

/**
 * Logo di una PRENOTAZIONE. Come ChannelLogo, ma per il canale "Diretta" distingue l'origine (vedi lib/direct-origin.ts):
 *  - dal sito ufficiale → logo della struttura; - inserita a mano dal gestionale → logo Xenora.
 * Gli altri canali (OTA, blocchi) restano invariati. `title` vale solo per i canali non diretti (per i diretti il tooltip indica l'origine).
 * `structure` è facoltativo: se manca si cerca per `booking.structureId` nei dati.
 */
export default function BookingChannelLogo({ booking, structure, size = 16, title, name }: { booking: BookingLike; structure?: Pick<Structure, "name" | "logo" | "photoColor"> | null; size?: number; title?: string; name?: string }) {
  const origin = directOriginOf(booking);
  if (origin === "sito") return <SiteLogo structureId={booking.structureId} structure={structure} size={size} />;
  if (origin === "manuale") return <ChannelLogo channel="direct" size={size} title={directOriginLabel("manuale")} />;
  return <ChannelLogo channel={booking.channel} size={size} title={title} name={name} />;
}

// Versione "per intero" (marchio + nome) per elenchi e schede: stessa regola di BookingChannelLogo.
function SiteWordmark({ structureId, structure, height }: { structureId?: string; structure?: Pick<Structure, "name" | "logo" | "photoColor"> | null; height: number }) {
  const { getStructure } = useData();
  const st = structure ?? (structureId ? getStructure(structureId) : undefined);
  const initials = (
    <span style={{ width: height, height, borderRadius: 4, backgroundColor: st?.photoColor || "#4F46E5", color: "#fff", fontSize: height * 0.5, fontWeight: 800, lineHeight: 1, display: "inline-grid", placeItems: "center", flexShrink: 0 }}>{initialsOf(st?.name)}</span>
  );
  return (
    <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-md bg-white px-1.5" style={{ height: height + 6, boxShadow: "0 0 0 1px rgba(0,0,0,.09)", maxWidth: 190 }} title={directOriginLabel("sito", st?.name)}>
      {st?.logo
        ? <MediaImg src={st.logo} alt={st.name ?? ""} style={{ width: height, height, objectFit: "contain", flexShrink: 0 }} fallback={initials} />
        : initials}
      <span className="truncate" style={{ color: "#2B3340", fontSize: Math.round(height * 0.68), fontWeight: 700, lineHeight: 1, letterSpacing: "-0.01em" }}>{st?.name ?? "Sito ufficiale"}</span>
    </span>
  );
}

/** Come ChannelWordmark, ma per il canale "Diretta" sceglie struttura (dal sito ufficiale) o Xenora (inserita a mano). */
export function BookingChannelWordmark({ booking, structure, height = 20, title }: { booking: BookingLike; structure?: Pick<Structure, "name" | "logo" | "photoColor"> | null; height?: number; title?: string }) {
  const origin = directOriginOf(booking);
  if (origin === "sito") return <SiteWordmark structureId={booking.structureId} structure={structure} height={height} />;
  if (origin === "manuale") return <ChannelWordmark channel="direct" height={height} title={directOriginLabel("manuale")} />;
  return <ChannelWordmark channel={booking.channel} height={height} title={title} />;
}
