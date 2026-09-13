// Costruisce il link della guida ospite a partire da una prenotazione.
//  - p = struttura, c = camera, g = nome ospite, pk = parcheggio (1/0)
//  - k = codici della camera (dai codici per camera in localStorage "spigolestay:roomaccess"),
//        filtrati in base al parcheggio della prenotazione, primi 3 (cancello-porta-porta2).
// I codici NON stanno nella guida pubblica: viaggiano solo nel link personale dell'ospite.

import { supabase } from "@/lib/supabase";

type RoomCode = { label?: string; value?: string; cond?: "always" | "parking" | "noparking" };

// Accorcia un link ospite (guida `/guida/...` o self check-in `/checkin...`) in `origin/g/<code>`
// salvando la parte lunga su Supabase. Se Supabase non c'è o va in errore, ritorna il link originale.
const SL_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export async function shortenLink(fullUrl: string): Promise<string> {
  try {
    if (!supabase || typeof window === "undefined") return fullUrl;
    const u = new URL(fullUrl);
    const target = u.pathname + u.search; // es. /guida/index.html?... oppure /checkin?b=...
    if (!target.startsWith("/guida/") && !target.startsWith("/checkin")) return fullUrl;
    let code = "";
    for (let i = 0; i < 6; i++) code += SL_ALPHABET[Math.floor(Math.random() * SL_ALPHABET.length)];
    const { error } = await supabase.from("short_links").insert({ code, target });
    if (error) return fullUrl;
    return `${u.origin}/g/${code}`;
  } catch { return fullUrl; }
}
// Alias storico (guida).
export const shortenGuideLink = shortenLink;

export function unitCodesForBooking(unitId: string | null | undefined, hasParking: boolean): string {
  let codes: RoomCode[] = [];
  try {
    const ra = JSON.parse(localStorage.getItem("spigolestay:roomaccess") || "{}");
    const raw = unitId ? ra[unitId] : null;
    if (Array.isArray(raw)) codes = raw as RoomCode[];
  } catch { /* niente codici */ }
  return codes
    .filter((c) => (c.cond === "parking" ? hasParking : c.cond === "noparking" ? !hasParking : true))
    .slice(0, 3)
    .map((c) => (c.value || "").trim())
    .join("-")
    .replace(/-+$/g, "");
}

// Messaggio di benvenuto che accompagna il link della guida.
// Legge il testo personalizzato della struttura (guide.inviteMsg) da localStorage; altrimenti usa un default.
// Segnaposto: {nome} = nome ospite, {link} = link guida, {struttura} = nome struttura.
export const DEFAULT_INVITE_MSG = "Buongiorno {nome}, siamo lieti di accogliervi! 🌿\nA seguire trovate la guida che vi permetterà di accedere alla struttura e vivere al meglio il soggiorno (check-in, WiFi, consigli e contatti):\n\n👉 {link}\n\nPer qualsiasi cosa siamo a disposizione. A presto!\n— {struttura}";

export function guideMessage(structureId: string, opts: { name?: string; link: string; structureName?: string }): string {
  let tpl = DEFAULT_INVITE_MSG;
  try {
    const guides = JSON.parse(localStorage.getItem("spigolestay:guides") || "{}");
    const g = guides[structureId];
    if (g && typeof g.inviteMsg === "string" && g.inviteMsg.trim()) tpl = g.inviteMsg;
  } catch { /* usa il default */ }
  const first = (opts.name || "").trim().split(/\s+/)[0] || "";
  let out = tpl.replace(/\{nome\}/g, first).replace(/\{struttura\}/g, opts.structureName || "").replace(/\{link\}/g, opts.link);
  if (!tpl.includes("{link}")) out = out.trimEnd() + "\n\n" + opts.link;
  return out.replace(/\n?—\s*$/,"").trimEnd(); // se la firma {struttura} è vuota, togli il trattino finale
}

// Codici (etichetta + valore) di una camera, filtrati per parcheggio — per il link di gruppo.
export function codesListForRoom(unitId: string | null | undefined, hasParking: boolean): { l: string; v: string }[] {
  let codes: RoomCode[] = [];
  try {
    const ra = JSON.parse(localStorage.getItem("spigolestay:roomaccess") || "{}");
    const raw = unitId ? ra[unitId] : null;
    if (Array.isArray(raw)) codes = raw as RoomCode[];
  } catch { /* niente codici */ }
  return codes
    .filter((c) => (c.cond === "parking" ? hasParking : c.cond === "noparking" ? !hasParking : true))
    .map((c) => ({ l: (c.label || "").trim(), v: (c.value || "").trim() }))
    .filter((c) => c.v);
}

// Link UNICO per una prenotazione di GRUPPO (2+ camere): mostra tutte le camere e, nella guida,
// i codici di ciascuna camera (parametro kr). Un solo link da mandare all'unico numero del gruppo.
export function buildGroupGuestLink(opts: {
  structureId: string;
  guestName?: string;
  rooms: { unitId?: string | null; unitCode?: string; parking?: boolean }[];
}): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const p = new URLSearchParams();
  p.set("p", opts.structureId);
  const roomCodes = opts.rooms.map((r) => (r.unitCode || "").trim()).filter(Boolean);
  if (roomCodes.length) p.set("c", roomCodes.join(","));
  const kr = opts.rooms
    .filter((r) => (r.unitCode || "").trim())
    .map((r) => ({ r: (r.unitCode || "").trim(), c: codesListForRoom(r.unitId, !!r.parking) }));
  if (kr.some((x) => x.c.length)) p.set("kr", JSON.stringify(kr));
  p.set("pk", opts.rooms.some((r) => r.parking) ? "1" : "0");
  if (opts.guestName?.trim()) p.set("g", opts.guestName.trim());
  return `${base}/guida/index.html?${p.toString()}`;
}

export function buildGuestLink(opts: {
  structureId: string;
  unitId?: string | null;
  unitCode?: string;   // numero/codice camera mostrato all'ospite (es. "4")
  guestName?: string;
  parking?: boolean;
  docsUrl?: string;    // portale documenti (facoltativo)
}): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const p = new URLSearchParams();
  p.set("p", opts.structureId);
  if (opts.unitCode?.trim()) p.set("c", opts.unitCode.trim());
  const has = !!opts.parking;
  const k = unitCodesForBooking(opts.unitId, has);
  if (k.replace(/-/g, "")) p.set("k", k);
  p.set("pk", has ? "1" : "0");
  if (opts.docsUrl?.trim()) p.set("d", opts.docsUrl.trim());
  if (opts.guestName?.trim()) p.set("g", opts.guestName.trim());
  return `${base}/guida/index.html?${p.toString()}`;
}
