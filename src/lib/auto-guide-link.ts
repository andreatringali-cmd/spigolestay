// Link PERSONALE della guida ospiti costruito sul server (cron dei messaggi automatici), con gli stessi parametri del link che l'host
// copia a mano dalla chat (vedi lib/guestlink.ts: p=struttura, c=camera, k/kr=codici, pk=parcheggio, g=ospite). Funzioni pure, nessun window.
// I codici viaggiano solo nel link personale dell'ospite, come per l'invio manuale. I codici per camera stanno in "spigolestay:roomaccess".

type RoomCode = { label?: string; value?: string; cond?: "always" | "parking" | "noparking" };
export interface GuideRoom { unitId?: string | null; unitCode?: string; parking?: boolean }

/** Codici di una camera filtrati per parcheggio: `roomAccess` è il JSON (o l'oggetto) di "spigolestay:roomaccess". */
export function roomCodes(roomAccess: unknown, unitId: string | null | undefined, hasParking: boolean): { l: string; v: string }[] {
  let ra: unknown = roomAccess;
  if (typeof ra === "string") { try { ra = JSON.parse(ra); } catch { ra = null; } }
  const raw = unitId && ra && typeof ra === "object" ? (ra as Record<string, unknown>)[unitId] : null;
  const codes: RoomCode[] = Array.isArray(raw) ? (raw as RoomCode[]) : [];
  return codes
    .filter((c) => (c.cond === "parking" ? hasParking : c.cond === "noparking" ? !hasParking : true))
    .map((c) => ({ l: (c.label || "").trim(), v: (c.value || "").trim() }))
    .filter((c) => c.v);
}

/** Link della guida per una prenotazione (1 camera) o di gruppo (2+ camere). `origin` senza barra finale. */
export function buildGuideUrl(o: { origin: string; structureId: string; guestName?: string; rooms: GuideRoom[]; roomAccess?: unknown }): string {
  const p = new URLSearchParams();
  p.set("p", o.structureId);
  const name = (o.guestName || "").trim();
  if (o.rooms.length > 1) {
    const withCode = o.rooms.filter((r) => (r.unitCode || "").trim());
    if (withCode.length) p.set("c", withCode.map((r) => (r.unitCode || "").trim()).join(","));
    const kr = withCode.map((r) => ({ r: (r.unitCode || "").trim(), c: roomCodes(o.roomAccess, r.unitId, !!r.parking) }));
    if (kr.some((x) => x.c.length)) p.set("kr", JSON.stringify(kr));
    p.set("pk", o.rooms.some((r) => r.parking) ? "1" : "0");
  } else {
    const r = o.rooms[0] ?? {};
    const code = (r.unitCode || "").trim();
    if (code) p.set("c", code);
    const k = roomCodes(o.roomAccess, r.unitId, !!r.parking).slice(0, 3).map((c) => c.v).join("-").replace(/-+$/g, "");
    if (k.replace(/-/g, "")) p.set("k", k);
    p.set("pk", r.parking ? "1" : "0");
  }
  if (name) p.set("g", name);
  return `${o.origin.replace(/\/+$/, "")}/guida/index.html?${p.toString()}`;
}

/** Numero da mostrare per scrivere alla struttura su WhatsApp: WhatsApp della struttura, altrimenti il telefono; vuoto se manca. */
export const structureWhatsapp = (st: { whatsapp?: unknown; phone?: unknown }): string => {
  const v = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  return v(st.whatsapp) || v(st.phone);
};
/** Se il numero non c'è, il messaggio dice comunque qualcosa di sensato ("scriveteci su WhatsApp (questo numero)"). */
export const WHATSAPP_FALLBACK: Record<string, string> = { it: "questo numero", en: "this number", fr: "ce numéro", de: "diese Nummer", es: "este número" };
