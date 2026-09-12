// Costruisce il link della guida ospite a partire da una prenotazione.
//  - p = struttura, c = camera, g = nome ospite, pk = parcheggio (1/0)
//  - k = codici della camera (dai codici per camera in localStorage "spigolestay:roomaccess"),
//        filtrati in base al parcheggio della prenotazione, primi 3 (cancello-porta-porta2).
// I codici NON stanno nella guida pubblica: viaggiano solo nel link personale dell'ospite.

type RoomCode = { label?: string; value?: string; cond?: "always" | "parking" | "noparking" };

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
