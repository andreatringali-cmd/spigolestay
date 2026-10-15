"use client";

// Azione del browser: crea su Channex il piano "Per persona" per la camera madre di una tariffa derivata "uso singola" (es. Dus = Deluxe −10%),
// registra il piano e invia i prezzi (1 e 2 ospiti). Lo sconto per 1 ospite è quello della tariffa derivata: non si riscrive da nessuna parte.
import type { RoomType } from "./types";
import { apiPost } from "./invoicing/client";
import { effectiveBase } from "./pricing";
import { readChannexMap } from "./channex-map-sync";
import { hasPersonPlan, registerPersonPlan, singleDiscountFromDerived } from "./person-plan";
import { forceFullSync } from "@/components/ChannexAutoSync";

const isSingle = (c: RoomType) => c.maxOccupancy === 1 || c.beds === 1 || /dus|singol/i.test(c.name);

/** La tariffa derivata è una "uso singola" con sconto, e la sua madre è collegata a Channex? Ritorna la madre, altrimenti null. */
export function personPlanMother(child: RoomType, roomTypes: RoomType[]): RoomType | null {
  if (!child.deriveFrom || !isSingle(child) || !singleDiscountFromDerived(child)) return null;
  const mother = roomTypes.find((x) => x.id === child.deriveFrom);
  if (!mother) return null;
  return readChannexMap()[mother.structureId]?.rooms?.[mother.id] ? mother : null;
}

export const personPlanDone = (child: RoomType, mother: RoomType) => hasPersonPlan(mother.structureId, mother.id) && !!child;

export async function publishSingleOccupancy(mother: RoomType, child: RoomType, roomTypes: RoomType[]): Promise<{ ok: boolean; text: string }> {
  const discount = singleDiscountFromDerived(child);
  if (!discount) return { ok: false, text: "La tariffa derivata non ha uno sconto rispetto alla madre." };
  try {
    const r = await apiPost<{ ok: boolean; ratePlanId?: string; created?: boolean; error?: string }>("channex/person-plan", { structureId: mother.structureId, roomTypeId: mother.id, baseRate: effectiveBase(mother, roomTypes), mode: discount.mode, value: discount.value });
    if (!r.ok || !r.ratePlanId) return { ok: false, text: r.error || "Channex non ha creato il piano." };
    if (!registerPersonPlan(mother.structureId, mother.id, r.ratePlanId, discount)) return { ok: false, text: "Piano creato su Channex, ma non trovo la camera nella mappa: apri Canali e riprova." };
    await forceFullSync(mother.structureId);
    return { ok: true, text: `Fatto. Su Channex, nella mappatura di bed-and-breakfast.it, scegli il piano «Per persona» per le righe 👤1 e 👤2 di ${mother.name}.` };
  } catch (e) { return { ok: false, text: e instanceof Error ? e.message : "Errore" }; }
}
