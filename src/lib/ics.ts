// Motore ICS / iCal condiviso: parsing dell'export Octorate + import idempotente.
// Usato sia dall'importazione a file (pagina Importa) sia dalla sincronizzazione in sola
// lettura da URL iCal (pagina Canali). In produzione questo sarà lato server.

import type { Booking, Channel, RoomType, Unit } from "./types";

export type IcsEvent = {
  uid: string; guest: string; checkIn: string; checkOut: string;
  blocked: boolean; channelText: string; note: string; room: string;
  total?: number; adults?: number;
};

// ── Helper date/numeri/canali ──
export function toISO(s: string): string {
  s = (s || "").trim(); if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) { let [, d, mo, y] = m; if (y.length === 2) y = "20" + y; return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; }
  const dt = new Date(s); return isNaN(+dt) ? "" : dt.toISOString().slice(0, 10);
}
export function toNum(s: string): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(String(s).replace(/[^0-9,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return isNaN(n) ? undefined : n;
}
// Riconosce il canale dal testo Octorate (SUMMARY): booking_xml, expedia, octoevo (=diretta),
// hotelBeds/agoda/hostelworld… (=Altro/OTA). Sconosciuto → diretta.
export function toChannel(s: string): Channel {
  s = (s || "").toLowerCase();
  if (s.includes("booking")) return "booking";                 // booking_xml
  if (s.includes("airbnb")) return "airbnb";
  if (s.includes("expedia") || s.includes("vrbo") || s.includes("homeaway")) return "expedia";
  if (/hotel\s*beds|hotelbeds|agoda|hostelworld|despegar|hotusa|hrs|roiback|veturis|dingus|jumbotour|restel|welcomebeds|bedsonline/.test(s)) return "other";
  if (s.includes("octoevo") || s.includes("octobook") || s.includes("diret") || s.includes("direct") || s.includes("wubook")) return "direct";
  return "direct";
}
export const normName = (x: string) => (x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ── Parsing ICS / iCal ──
function icsUnescape(s: string) { return (s || "").replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim(); }
function icsDate(v: string) { const m = v.match(/(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ""; }
function addDay(iso: string) { if (!iso) return ""; const d = new Date(iso + "T00:00:00Z"); if (isNaN(+d)) return iso; d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

export function parseICS(text: string): IcsEvent[] {
  text = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, ""); // unfold righe continuate
  const out: IcsEvent[] = [];
  const blocks = text.split(/BEGIN:VEVENT/i).slice(1);
  for (const b of blocks) {
    const body = "\n" + b.split(/END:VEVENT/i)[0];
    const get = (re: RegExp) => { const m = body.match(re); return m ? icsUnescape(m[1]) : ""; };
    const dts = body.match(/\nDTSTART[^:\n]*:([0-9TZ]+)/i), dte = body.match(/\nDTEND[^:\n]*:([0-9TZ]+)/i);
    const summary = get(/\nSUMMARY:(.*)/i), desc = get(/\nDESCRIPTION:(.*)/i), loc = get(/\nLOCATION:(.*)/i);
    const orgCn = get(/\nORGANIZER[^:\n]*?CN=([^:\n]*):/i);
    const uid = get(/\nUID:(.*)/i);
    // Date: preferisci il "Period : gg/mm/aaaa - gg/mm/aaaa" della DESCRIPTION (check-out reale);
    // altrimenti DTSTART e DTEND+1 (in Octorate DTEND è l'ultima notte, non la partenza).
    const per = desc.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    const ci = per ? toISO(per[1]) : (dts ? icsDate(dts[1]) : "");
    const co = per ? toISO(per[2]) : (dte ? addDay(icsDate(dte[1])) : "");
    if (!ci && !co) continue;
    const blob = (summary + " " + desc + " " + loc).toLowerCase();
    const blocked = /closed|not available|non disponibil|bloccat|blocked|unavailable|outoforder|out.?of.?order|fuori.?servizio|maintenance|manutenzione/.test(blob);
    let guest = orgCn;
    if (!guest && !blocked) guest = summary.split(/\s*\|\s*|\s+Camera\b/i)[0].trim();
    const totm = desc.match(/Total\s*:?\s*€?\s*([0-9]+(?:[.,][0-9]+)?)/i) || (desc + " " + summary).match(/€\s?([0-9.,]+)/);
    const pax = summary.match(/(\d+)\s*pax/i);
    out.push({ uid, guest: blocked ? "" : guest, checkIn: ci, checkOut: co, blocked, channelText: summary, note: desc || summary, room: loc, total: totm ? toNum(totm[1]) : undefined, adults: pax ? +pax[1] : undefined });
  }
  return out;
}

// ── Import idempotente ──
export interface IcsImportCtx {
  bookings: Booking[]; units: Unit[]; roomTypes: RoomType[];
  addGuest: (g: { fullName?: string }) => string;
  addBooking: (b: Omit<Booking, "id">) => void;
  updateBooking: (id: string, patch: Partial<Booking>) => void;
  deleteBooking: (id: string) => void;
  addRoomType: (rt: { structureId: string; name: string; beds: number; basePrice: number }) => string;
  addUnit: (u: { structureId: string; roomTypeId: string; name: string }) => string;
  t: (s: string) => string;
}
export interface IcsImportOpts {
  structureId: string;
  includeBlocked?: boolean;
  replacePrev?: boolean;              // file: true (sostituisci import precedenti). sync: false (aggiorna per UID)
  targetUnit?: string;               // "" = auto per tipologia; altrimenti id camera specifica
  roomMap?: Record<string, string>;  // nome camera ICS -> id tipologia o "__new__"; assente = auto-match per nome
  source?: "ICS" | "CSV" | string;   // etichetta provenienza per la nota
}

export function importIcsEvents(events: IcsEvent[], opts: IcsImportOpts, ctx: IcsImportCtx): { created: number; updated: number } {
  const { structureId, includeBlocked = false, replacePrev = false, targetUnit = "", roomMap = {}, source = "ICS" } = opts;
  const { bookings, units, roomTypes, addGuest, addBooking, updateBooking, deleteBooking, addRoomType, addUnit, t } = ctx;

  // Solo prenotazioni con date valide e almeno 1 notte (scarta gli eventi a 0 notti).
  const list = (includeBlocked ? events : events.filter((e) => !e.blocked))
    .filter((e) => e.checkIn && e.checkOut && e.checkIn < e.checkOut)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  const forced = targetUnit ? units.find((u) => u.id === targetUnit && u.structureId === structureId) : null;

  // Sostituisci import precedenti (solo file): elimina le prenotazioni già importate per non duplicarle.
  const del = replacePrev
    ? bookings.filter((b) => (forced ? b.unitId === forced.id : b.structureId === structureId) && (b.extId || (b.note || "").includes("Importato da")))
    : [];
  const delIds = new Set(del.map((b) => b.id));
  del.forEach((b) => deleteBooking(b.id));

  const fallbackName = t("Camere importate");
  // Posti letto dedotti dal numero massimo di ospiti (pax) visto per quella camera nel file.
  const maxPaxByRoom: Record<string, number> = {};
  list.forEach((e) => { const k = (e.room || "").trim() || "—"; maxPaxByRoom[k] = Math.max(maxPaxByRoom[k] || 0, Math.round(e.adults ?? 0)); });
  const bedsFor = (roomName: string) => Math.max(2, maxPaxByRoom[(roomName || "").trim() || "—"] || 2);
  const typeCache: Record<string, string> = {};
  const resolveType = (roomName: string) => {
    const key = (roomName || "").trim() || "—";
    if (typeCache[key]) return typeCache[key];
    const chosen = roomMap[key];
    const mkName = (roomName || "").replace(/\s*\|\s*/g, " ").trim().slice(0, 40) || fallbackName;
    let id: string;
    if (chosen && chosen !== "__new__") id = chosen;
    else if (chosen === "__new__") id = addRoomType({ structureId, name: mkName, beds: bedsFor(roomName), basePrice: 0 });
    else {
      // Nessuna scelta esplicita (sync automatica): abbina alla tipologia col nome più simile, altrimenti creala.
      const sn = normName(roomName);
      const sRooms = roomTypes.filter((rt) => rt.structureId === structureId);
      const hit = sn ? (sRooms.find((rt) => normName(rt.name) === sn) || sRooms.find((rt) => { const rn = normName(rt.name); return !!rn && (sn.includes(rn) || rn.includes(sn)); })) : undefined;
      id = hit ? hit.id : addRoomType({ structureId, name: mkName, beds: bedsFor(roomName), basePrice: 0 });
    }
    typeCache[key] = id; return id;
  };

  // Assegnazione camere fisiche con bin-packing: riusa le esistenti, ne crea quante servono
  // per le sovrapposizioni → nessuna prenotazione finisce in overbooking.
  const slots: Record<string, { unitId: string; last: string }[]> = {};
  units.filter((u) => u.structureId === structureId).forEach((u) => {
    const last = bookings.filter((b) => b.unitId === u.id && !delIds.has(b.id)).reduce((mx, b) => (b.checkOut > mx ? b.checkOut : mx), "0000-00-00");
    (slots[u.roomTypeId] ||= []).push({ unitId: u.id, last });
  });
  const assignUnit = (typeId: string, ci: string, co: string) => {
    const arr = (slots[typeId] ||= []);
    let s = arr.find((x) => x.last <= ci);
    if (!s) { const id = addUnit({ structureId, roomTypeId: typeId, name: `${t("Camera")} ${arr.length + 1}` }); s = { unitId: id, last: "0000-00-00" }; arr.push(s); }
    s.last = co; return s.unitId;
  };

  // Idempotenza: le prenotazioni già presenti con lo stesso UID vengono AGGIORNATE (mai duplicate),
  // preservando l'eventuale camera assegnata a mano (unitId non viene sovrascritto).
  const byExt = new Map<string, string>();
  if (!replacePrev) bookings.forEach((b) => { if (b.extId && !delIds.has(b.id)) byExt.set(b.extId, b.id); });

  let created = 0, updated = 0;
  list.forEach((e) => {
    const typeId = forced ? forced.roomTypeId : resolveType(e.room);
    const patch = {
      roomTypeId: typeId,
      channel: e.blocked ? ("blocked" as const) : toChannel(e.channelText),
      checkIn: e.checkIn, checkOut: e.checkOut, adults: Math.max(1, Math.round(e.adults ?? 2)),
      ...(e.total !== undefined ? { total: e.total } : {}),
    };
    if (e.uid && byExt.has(e.uid)) { updateBooking(byExt.get(e.uid)!, forced ? { ...patch, unitId: forced.id } : patch); updated++; return; }
    const unitId = forced ? forced.id : assignUnit(typeId, e.checkIn, e.checkOut);
    const guestId = addGuest({ fullName: e.guest || (e.blocked ? t("Non disponibile") : t("Ospite (da ICS)")) });
    addBooking({
      structureId, unitId, guestId, status: "confirmed", children: 0, ...patch,
      extId: e.uid || undefined,
      note: (t(`Importato da ${source}`) + (!e.blocked && e.note ? " · " + e.note : "")).slice(0, 280),
    });
    created++;
  });
  return { created, updated };
}
