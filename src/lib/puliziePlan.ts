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

// Testo del programma da condividere (WhatsApp/email), ORDINATO PER LAVORO DA FARE: prima i cambi completi, poi gli arrivi, le partenze e i riassetti;
// le camere senza nulla da fare stanno in una riga sola in fondo. Sempre TUTTE le camere della struttura, comprese quelle fuori servizio o con un guasto.
// Niente emoji (WhatsApp Business non le rende sempre). stile "whatsapp": titoli in *grassetto*; stile "plain" (email): niente asterischi.
export type PlanStyle = "whatsapp" | "plain";

const GROUPS: { key: ActionKey; title: string }[] = [
  { key: "turnover", title: "CAMBIO COMPLETO (esce un ospite, ne entra un altro)" },
  { key: "arrivo", title: "DA PREPARARE PER L'ARRIVO" },
  { key: "partenza", title: "DOPO LA PARTENZA" },
  { key: "riassetto", title: "RIASSETTO (ospiti in casa)" },
];

// Ordine naturale delle camere: 1, 2, 3, 10 (non 1, 10, 2).
const byUnit = (a: PlanRoom, b: PlanRoom) => a.unit.name.localeCompare(b.unit.name, "it", { numeric: true, sensitivity: "base" });

export function buildPuliziePlanText(opts: {
  date: string;
  scopedStructures: Structure[];
  rooms: PlanRoom[];
  guests: Guest[];
  notes?: Record<string, string>;
  t?: (s: string) => string;
  style?: PlanStyle;
}): string {
  const { date, scopedStructures, rooms, guests, notes = {}, t = (x: string) => x, style = "whatsapp" } = opts;
  const bold = (x: string) => (style === "whatsapp" ? `*${x}*` : x);
  const guestName = (id: string) => guests.find((g) => g.id === id)?.fullName ?? "";
  const pers = (b: Booking) => `${b.adults + b.children} ${t("pers.")}`;
  const keyOf = (unitId: string) => `${unitId}:${date}`;
  const noteOf = (r: PlanRoom) => { const n = notes[keyOf(r.unit.id)]?.trim(); return n ? ` [${n}]` : ""; };

  const lines: string[] = [`${bold(t("Pulizie di oggi"))} — ${fmtLongIT(date)}`];
  for (const s of scopedStructures) {
    const list = rooms.filter((r) => r.structure.id === s.id).sort(byUnit);
    if (!list.length) continue;
    const todo = list.filter((r) => !r.oos && r.action !== "niente").length;
    lines.push("", `${bold(s.name)} — ${todo} ${todo === 1 ? t("camera da fare") : t("camere da fare")}`);

    for (const g of GROUPS) {
      const grp = list.filter((r) => !r.oos && r.action === g.key);
      if (!grp.length) continue;
      lines.push("", t(g.title));
      for (const r of grp) {
        let row: string;
        if (g.key === "turnover" && r.dep && r.arr) {
          row = `${r.unit.name} — ${t("esce")} ${guestName(r.dep.guestId)} · ${t("entra")} ${guestName(r.arr.guestId)} (${pers(r.arr)}, ${t("fino al")} ${fmtDM(r.arr.checkOut)})`;
        } else if (g.key === "arrivo" && r.arr) {
          row = `${r.unit.name} — ${t("entra")} ${guestName(r.arr.guestId)} (${pers(r.arr)}, ${t("fino al")} ${fmtDM(r.arr.checkOut)})`;
        } else if (g.key === "partenza" && r.dep) {
          row = `${r.unit.name} — ${t("esce")} ${guestName(r.dep.guestId)}`;
        } else {
          const b = r.stay ?? r.arr ?? r.dep;
          row = b ? `${r.unit.name} — ${guestName(b.guestId)} (${pers(b)}, ${t("fino al")} ${fmtDM(b.checkOut)})` : r.unit.name;
        }
        lines.push(`• ${row}${noteOf(r)}${r.oosFrom && r.oosNote ? ` [${r.oosNote}]` : ""}`);
      }
    }

    const oos = list.filter((r) => r.oos);
    if (oos.length) {
      lines.push("", t("FUORI SERVIZIO"));
      for (const r of oos) lines.push(`• ${r.unit.name}${r.oosNote ? ` — ${r.oosNote}` : ""}${noteOf(r)}`);
    }
    const nothing = list.filter((r) => !r.oos && r.action === "niente");
    if (nothing.length) lines.push("", `${t("NIENTE DA FARE")}: ${nothing.map((r) => r.unit.name).join(", ")}`);
  }
  if (lines.length === 1) lines.push("", t("Nessuna pulizia in programma."));
  return lines.join("\n");
}

// Una voce per tipo di lavoro, per il modello WhatsApp "a righe" (ogni riga del modello è una variabile: Meta non ammette a capo DENTRO una variabile, ma il modello li ha già).
// Ogni valore è su una sola riga e mai vuoto (Meta rifiuta le variabili vuote): "nessuna" se non c'è nulla. Per cambi e arrivi si indica anche quante persone entrano (servono per i letti).
export interface PlanFields { cambio: string; arrivi: string; partenze: string; riassetto: string; fuori: string; niente: string }
export function buildPuliziePlanFields(opts: { scopedStructures: Structure[]; rooms: PlanRoom[]; notes?: Record<string, string>; date: string; t?: (s: string) => string }): PlanFields {
  const { scopedStructures, rooms, notes = {}, date, t = (x: string) => x } = opts;
  const ids = new Set(scopedStructures.map((s) => s.id));
  const list = rooms.filter((r) => ids.has(r.structure.id)).sort(byUnit);
  const none = t("nessuna");
  const note = (r: PlanRoom) => { const n = notes[`${r.unit.id}:${date}`]?.trim(); return n ? ` [${n}]` : ""; };
  const join = (rs: PlanRoom[], label: (r: PlanRoom) => string) => (rs.length ? rs.map((r) => `${label(r)}${note(r)}`).join(", ") : none);
  const withPers = (r: PlanRoom) => (r.arr ? `${r.unit.name} (${r.arr.adults + r.arr.children} ${t("pers.")})` : r.unit.name);
  const of = (k: ActionKey) => list.filter((r) => !r.oos && r.action === k);
  return {
    cambio: join(of("turnover"), withPers),
    arrivi: join(of("arrivo"), withPers),
    partenze: join(of("partenza"), (r) => r.unit.name),
    riassetto: join(of("riassetto"), (r) => r.unit.name),
    fuori: join(list.filter((r) => r.oos), (r) => r.unit.name),
    niente: join(of("niente"), (r) => r.unit.name),
  };
}

// Versione BREVE su una riga, per il modello WhatsApp (Meta non permette a capo dentro le variabili): solo i numeri delle camere per tipo di lavoro.
// Il dettaglio con i nomi degli ospiti sta nell'email o nella pagina Pulizie.
export function buildPuliziePlanSummary(opts: {
  scopedStructures: Structure[];
  rooms: PlanRoom[];
  notes?: Record<string, string>;
  date: string;
  t?: (s: string) => string;
}): string {
  const { scopedStructures, rooms, notes = {}, date, t = (x: string) => x } = opts;
  const SHORT: Record<string, string> = { turnover: "cambio completo", arrivo: "arrivo", partenza: "partenza", riassetto: "riassetto" };
  const parts: string[] = [];
  for (const s of scopedStructures) {
    const list = rooms.filter((r) => r.structure.id === s.id).sort(byUnit);
    if (!list.length) continue;
    const seg: string[] = [];
    for (const g of GROUPS) {
      const grp = list.filter((r) => !r.oos && r.action === g.key);
      if (grp.length) seg.push(`${t(SHORT[g.key])}: ${grp.map((r) => { const n = notes[`${r.unit.id}:${date}`]?.trim(); return n ? `${r.unit.name} (${n})` : r.unit.name; }).join(", ")}`);
    }
    const oos = list.filter((r) => r.oos);
    if (oos.length) seg.push(`${t("fuori servizio")}: ${oos.map((r) => r.unit.name).join(", ")}`);
    const nothing = list.filter((r) => !r.oos && r.action === "niente");
    if (nothing.length && seg.length) seg.push(`${t("niente")}: ${nothing.map((r) => r.unit.name).join(", ")}`);
    parts.push(seg.length ? `${s.name} — ${seg.join(" | ")}` : `${s.name} — ${t("nessuna pulizia")}`);
  }
  return parts.join(" // ") || t("Nessuna pulizia in programma.");
}
