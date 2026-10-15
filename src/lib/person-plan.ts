// Piano tariffario "Per persona" su Channex: prezzo diverso per 1 ospite, solo per i portali che lo accettano (es. bed-and-breakfast.it).
// Qui sta la parte del browser: registra il piano creato su Channex nella mappa e nel modello tariffe, così ChannexAutoSync ne invia i prezzi
// (con una chiamata SEPARATA da quella dei prezzi normali). Le altre OTA non sono collegate a questo piano e non cambiano.
import { parseRateModel, RATEMODEL_KEY, type SingleDiscount } from "./rate-model";
import { CHX_MAP_KEY, readChannexMap } from "./channex-map-sync";
import type { RoomType } from "./types";

export const PERSON_PLAN_ID = "pp";
export const PERSON_PLAN_TITLE = "Per persona";

/** Sconto per 1 ospite ricavato dalla tariffa derivata "uso singola" (es. Dus = Deluxe −10%): null se non è uno sconto. */
export function singleDiscountFromDerived(child: Pick<RoomType, "deriveMode" | "deriveValue">): SingleDiscount | null {
  const v = child.deriveValue ?? 0;
  if (!(v < 0)) return null;
  return { mode: child.deriveMode === "amount" ? "eur" : "pct", value: Math.abs(v) };
}

/** La tipologia ha già il piano "Per persona" registrato nella mappa locale? */
export function hasPersonPlan(structureId: string, roomTypeId: string): boolean {
  const room = readChannexMap()[structureId]?.rooms?.[roomTypeId];
  return !!room?.ratePlans?.some((p) => p.id === PERSON_PLAN_ID);
}

/** Registra il piano appena creato (o trovato) su Channex e lo sconto per 1 ospite. Ritorna false se la tipologia non è nella mappa. */
export function registerPersonPlan(structureId: string, roomTypeId: string, ratePlanId: string, discount: SingleDiscount): boolean {
  try {
    const map = readChannexMap();
    const room = map[structureId]?.rooms?.[roomTypeId];
    if (!room) return false;
    room.ratePlans = [...(room.ratePlans ?? []).filter((p) => p.id !== PERSON_PLAN_ID), { id: PERSON_PLAN_ID, ratePlanId, perPerson: true, occupancy: 2 }];
    localStorage.setItem(CHX_MAP_KEY, JSON.stringify(map));
    const cfg = parseRateModel(localStorage.getItem(RATEMODEL_KEY));
    cfg.enabled = true;
    cfg.plans[roomTypeId] = [...(cfg.plans[roomTypeId] ?? []).filter((p) => p.id !== PERSON_PLAN_ID), { id: PERSON_PLAN_ID, name: PERSON_PLAN_TITLE, adjPct: 0, adjEur: 0 }];
    cfg.single[roomTypeId] = discount;
    localStorage.setItem(RATEMODEL_KEY, JSON.stringify(cfg));
    return true;
  } catch { return false; }
}
