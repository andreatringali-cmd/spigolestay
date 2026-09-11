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
