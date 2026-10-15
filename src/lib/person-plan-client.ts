"use client";

// Azione del browser: crea su Channex il piano "Per persona" per la camera madre di una tariffa derivata "uso singola" (es. Dus = Deluxe −10%),
// registra il piano e invia i prezzi (1 e 2 ospiti). Lo sconto per 1 ospite è quello della tariffa derivata: non si riscrive da nessuna parte.
import type { RoomType } from "./types";
import { apiPost } from "./invoicing/client";
import { effectiveBase } from "./pricing";
import { readChannexMap } from "./channex-map-sync";
import { registerPersonPlan, singleDiscountFromDerived } from "./person-plan";

const isSingle = (c: RoomType) => c.maxOccupancy === 1 || c.beds === 1 || /dus|singol/i.test(c.name);

/** La tariffa derivata è una "uso singola" con sconto, e la sua madre è collegata a Channex? Ritorna la madre, altrimenti null. */
export function personPlanMother(child: RoomType, roomTypes: RoomType[]): RoomType | null {
  if (!child.deriveFrom || !isSingle(child) || !singleDiscountFromDerived(child)) return null;
  const mother = roomTypes.find((x) => x.id === child.deriveFrom);
  if (!mother) return null;
  return readChannexMap()[mother.structureId]?.rooms?.[mother.id] ? mother : null;
}

/** Crea (o ritrova) il piano «Per persona» su Channex e lo registra. Non invia i prezzi: ci pensa la sincronizzazione. */
export async function ensurePersonPlan(mother: RoomType, child: RoomType, roomTypes: RoomType[]): Promise<{ ok: boolean; text: string }> {
  const discount = singleDiscountFromDerived(child);
  if (!discount) return { ok: false, text: "La tariffa derivata non ha uno sconto rispetto alla madre." };
  try {
    const r = await apiPost<{ ok: boolean; ratePlanId?: string; created?: boolean; error?: string }>("channex/person-plan", { structureId: mother.structureId, roomTypeId: mother.id, baseRate: effectiveBase(mother, roomTypes), mode: discount.mode, value: discount.value });
    if (!r.ok || !r.ratePlanId) return { ok: false, text: r.error || "Channex non ha creato il piano." };
    if (!registerPersonPlan(mother.structureId, mother.id, r.ratePlanId, discount)) return { ok: false, text: "Piano creato su Channex, ma non trovo la camera nella mappa: apri Canali e riprova." };
    return { ok: true, text: "ok" };
  } catch (e) { return { ok: false, text: e instanceof Error ? e.message : "Errore" }; }
}

/** Come ensurePersonPlan, ma invia subito i prezzi e dà all'utente le istruzioni per Channex (usata al salvataggio della tariffa). */
export async function publishSingleOccupancy(mother: RoomType, child: RoomType, roomTypes: RoomType[], sendNow: (structureId: string) => Promise<unknown>): Promise<{ ok: boolean; text: string }> {
  const r = await ensurePersonPlan(mother, child, roomTypes);
  if (!r.ok) return r;
  await sendNow(mother.structureId); // invio completo dei prezzi (passato da chi chiama: evita un import circolare con ChannexAutoSync)
  return { ok: true, text: `Inviato. Su Channex, nella mappatura di bed-and-breakfast.it, scegli il piano «Per persona» per le righe 👤1 e 👤2 di ${mother.name}.` };
}
