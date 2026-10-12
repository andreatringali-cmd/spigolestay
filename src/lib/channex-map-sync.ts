// Mappatura Channex ↔ Xenora salvata nel browser (localStorage) e come tenerla allineata al server.
// L'invio automatico di prezzi e disponibilità (ChannexAutoSync) e il controllo delle nuove prenotazioni lavorano SOLO sulle strutture presenti in questa mappa:
// se manca (browser nuovo, dati cancellati, pagina Canali mai aperta) non parte nulla. Per questo la si rilegge dal server da sola.
import type { ChxStructMap } from "@/lib/channex-ari";
import { apiPost } from "@/lib/invoicing/client";

export const CHX_MAP_KEY = "spigolestay:channexmap";
const CHECKED_KEY = "spigolestay:channexmap-checked";

/** Una struttura abbinata, come la restituisce /api/channex/relink. */
export interface LinkedStructure { structureId: string; propertyId: string; roomsMap?: Record<string, string>; ratePlans?: Record<string, string> }

/** Unisce l'esito del server alla mappa locale: ratePlanId serve per inviare i PREZZI; i piani tariffari extra già mappati si conservano. */
export function mergeRelink(prev: Record<string, ChxStructMap>, linked: LinkedStructure[]): Record<string, ChxStructMap> {
  const next: Record<string, ChxStructMap> = { ...prev };
  for (const l of linked) {
    const rooms: NonNullable<ChxStructMap["rooms"]> = {};
    for (const [chxRt, xid] of Object.entries(l.roomsMap || {})) {
      rooms[xid] = { roomTypeId: chxRt, ratePlanId: l.ratePlans?.[chxRt] };
      const old = prev[l.structureId]?.rooms?.[xid];
      if (old?.ratePlans?.length && old.roomTypeId === chxRt) rooms[xid] = { ...old };
    }
    next[l.structureId] = { propertyId: l.propertyId, rooms, at: new Date().toISOString() };
  }
  return next;
}

export function readChannexMap(): Record<string, ChxStructMap> {
  try { return JSON.parse(localStorage.getItem(CHX_MAP_KEY) || "{}"); } catch { return {}; }
}

/** La mappatura locale ha almeno una struttura con property e camere? */
export const hasLinkedStructures = (m: Record<string, ChxStructMap>): boolean => Object.values(m).some((x) => x?.propertyId && x?.rooms && Object.keys(x.rooms).length > 0);

/** Rilegge la mappatura dal server, al massimo una volta ogni `minIntervalMs` per browser. Ritorna true se la mappa locale è stata aggiornata. */
export async function refreshChannexMap(minIntervalMs: number): Promise<boolean> {
  try {
    const last = Number(localStorage.getItem(CHECKED_KEY) || 0);
    if (Date.now() - last < minIntervalMs) return false;
    localStorage.setItem(CHECKED_KEY, String(Date.now()));
    const j = await apiPost<{ ok: boolean; linked?: LinkedStructure[] }>("channex/relink", {});
    if (!j.ok || !j.linked?.length) return false;
    localStorage.setItem(CHX_MAP_KEY, JSON.stringify(mergeRelink(readChannexMap(), j.linked)));
    return true;
  } catch { return false; }
}
