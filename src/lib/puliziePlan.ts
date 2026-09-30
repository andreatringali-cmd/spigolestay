// Logica pura (senza React) del planning pulizie: quali camere fare oggi, azione, carico
// biancheria, e testo da condividere. Condivisa tra la pagina Pulizie (client) e il cron di
// invio automatico (server) — un'unica fonte di verità, per non doverle mantenere allineate a mano.
import { sortUnitsByName } from "@/lib/sortUnits";
import type { Booking, Unit, RoomType, Structure, Guest } from "@/lib/types";

export type ActionKey = "turnover" | "arrivo" | "partenza" | "riassetto" | "niente";
export const ACT_LABEL: Record<ActionKey, string> = {
  turnover: "Partenza + Arrivo",
  arrivo: "Arrivo",
  partenza: "Partenza",
  riassetto: "Riassetto",
  niente: "Niente",
};

export interface PlanRoom {
  unit: Unit;
  structure: Structure;
  typeName: string;
  oos: boolean;
  oosFrom: boolean;
  oosNote?: string;
  action: ActionKey;
  dep?: Booking;
  arr?: Booking;
  stay?: Booking;
}

export interface PlanCounts { turnover: number; arrivo: number; partenza: number; riassetto: number }
export interface PlanLinen { changeRooms: number; matr: number; sing: number; federe: number; towels: number; mats: number }

export function computePuliziePlan(opts: {
  date: string;
  structures: Structure[];
  units: Unit[];
  roomTypes: RoomType[];
  bookings: Booking[];
}): { rooms: PlanRoom[]; toClean: PlanRoom[]; counts: PlanCounts; linen: PlanLinen } {
  const { date, structures, units, roomTypes, bookings } = opts;
  const active = bookings.filter((b) => b.status !== "cancelled");
  const activeGuests = active.filter((b) => b.channel !== "blocked");
  const blockedNow = active.filter((b) => b.channel === "blocked" && b.checkIn <= date && date < b.checkOut);

  const planFor = (unitId: string) => {
    const dep = activeGuests.find((b) => b.unitId === unitId && b.checkOut === date);
    const arr = activeGuests.find((b) => b.unitId === unitId && b.checkIn === date);
    const stay = activeGuests.find((b) => b.unitId === unitId && b.checkIn < date && date < b.checkOut);
    let action: ActionKey = "niente";
    if (dep && arr) action = "turnover";
    else if (dep) action = "partenza";
    else if (arr) action = "arrivo";
    else if (stay) action = "riassetto";
    return { action, dep, arr, stay };
  };

  const rooms: PlanRoom[] = structures.flatMap((s) => {
    const su = units.filter((u) => u.structureId === s.id);
    const tps = roomTypes.filter((rt) => rt.structureId === s.id);
    const ordered = [
      ...tps.flatMap((rt) => sortUnitsByName(su.filter((u) => u.roomTypeId === rt.id))),
      ...sortUnitsByName(su.filter((u) => !tps.some((rt) => rt.id === u.roomTypeId))),
    ];
    return ordered.map((u) => {
      const oosBlock = blockedNow.find((b) => b.unitId === u.id);
      const plan = planFor(u.id);
      // "Fuori servizio" vince solo se non c'è nulla da fare quel giorno (vedi pulizie/page.tsx).
      const isOosToday = (!!u.outOfService || !!oosBlock) && plan.action === "niente";
      return {
        unit: u,
        structure: s,
        typeName: roomTypes.find((x) => x.id === u.roomTypeId)?.name ?? "",
        oos: isOosToday,
        oosFrom: !isOosToday && !!oosBlock,
        oosNote: oosBlock?.note,
        ...plan,
      };
    });
  });

  const toClean = rooms.filter((r) => !r.oos && r.action !== "niente");
  const counts: PlanCounts = {
    turnover: rooms.filter((r) => r.action === "turnover").length,
    arrivo: rooms.filter((r) => r.action === "arrivo").length,
    partenza: rooms.filter((r) => r.action === "partenza").length,
    riassetto: rooms.filter((r) => r.action === "riassetto").length,
  };

  const linen: PlanLinen = (() => {
    let matr = 0, sing = 0, guestsN = 0, changeRooms = 0, mats = 0;
    for (const r of toClean) {
      const beds = roomTypes.find((x) => x.id === r.unit.roomTypeId)?.beds ?? 1;
      if (r.action !== "riassetto") { changeRooms++; matr += beds >= 2 ? 1 : 0; sing += beds >= 2 ? beds - 2 : beds; }
      if (r.arr) mats++;
      const p = r.arr ?? r.stay ?? r.dep;
      guestsN += p ? p.adults + p.children : 0;
    }
    return { changeRooms, matr, sing, federe: matr * 2 + sing, towels: guestsN, mats };
  })();

  return { rooms, toClean, counts, linen };
}

const fmtDM = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
export const fmtLongIT = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" });

// Testo del programma da condividere (WhatsApp/email) — sempre TUTTE le camere della struttura,
// comprese quelle fuori servizio/con un guasto; niente emoji (WhatsApp Business non le rende sempre).
export function buildPuliziePlanText(opts: {
  date: string;
  scopedStructures: Structure[];
  rooms: PlanRoom[];
  guests: Guest[];
  notes?: Record<string, string>;
  t?: (s: string) => string;
}): string {
  const { date, scopedStructures, rooms, guests, notes = {}, t = (x: string) => x } = opts;
  const guestName = (id: string) => guests.find((g) => g.id === id)?.fullName ?? "";
  const keyOf = (unitId: string) => `${unitId}:${date}`;

  const lines: string[] = [`*${t("Pulizie di oggi")}* — ${fmtLongIT(date)}`];
  for (const s of scopedStructures) {
    const list = rooms.filter((r) => r.structure.id === s.id);
    if (!list.length) continue;
    lines.push("", `*${s.name}*`);
    for (const r of list) {
      const note = notes[keyOf(r.unit.id)]?.trim();
      const suffix = note ? ` [${note}]` : "";
      if (r.oos) {
        lines.push(`• ${r.unit.name}: ${t("Fuori servizio")}${r.oosNote ? ` — ${r.oosNote}` : ""}${suffix}`);
      } else if (r.action === "turnover" && r.dep && r.arr) {
        lines.push(`• ${r.unit.name}: ${t("PARTENZA + ARRIVO — parte")} ${guestName(r.dep.guestId)} (${r.dep.adults + r.dep.children} ${t("persone")}), ${t("poi arriva")} ${guestName(r.arr.guestId)} (${r.arr.adults + r.arr.children} ${t("persone")}, ${fmtDM(r.arr.checkIn)}→${fmtDM(r.arr.checkOut)})${suffix}`);
      } else {
        const p = r.arr ?? r.dep ?? r.stay;
        const io = p ? ` (${fmtDM(p.checkIn)}→${fmtDM(p.checkOut)}, ${p.adults + p.children} ${t("persone")})` : "";
        const who = p ? ` — ${guestName(p.guestId)}` : "";
        const oosNote = r.oosFrom && r.oosNote ? ` [${r.oosNote}]` : "";
        lines.push(`• ${r.unit.name}: ${t(ACT_LABEL[r.action])}${who}${io}${suffix}${oosNote}`);
      }
    }
  }
  if (lines.length === 1) lines.push("", t("Nessuna pulizia in programma."));
  return lines.join("\n");
}
