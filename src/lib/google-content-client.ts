// Invio automatico dei dati della struttura per Google Hotel: parte da solo quando si salva la scheda struttura (se la struttura è collegata ai portali).
// Nessun pulsante dedicato: la scheda struttura è l'unico posto dove si compila. L'esito dell'ultimo invio si ricorda nel browser per mostrarlo nella scheda.
import type { Structure, RoomType } from "@/lib/types";
import { apiPost } from "@/lib/invoicing/client";
import { readChannexMap } from "@/lib/channex-map-sync";
import type { StructureContent } from "@/lib/channex-content";

const RESULT_KEY = "spigolestay:google-content-result";
export interface GoogleSyncResult { at: number; ok: boolean; problems: { label: string; detail?: string; debug?: string }[] }

export function contentOfStructure(s: Structure, roomTypes: readonly RoomType[]): StructureContent {
  const maxGuests = Math.max(2, ...roomTypes.filter((r) => r.structureId === s.id).map((r) => r.maxOccupancy ?? r.beds ?? 2));
  return {
    name: s.name, description: s.description, type: s.type, city: s.city, address: [s.address, s.streetNumber].filter(Boolean).join(" ") || undefined, postalCode: s.postalCode,
    country: s.country, phone: s.phone, email: s.email, lat: s.lat, lng: s.lng, services: s.services, checkInFrom: s.checkInFrom, checkInTo: s.checkInTo, checkOutBy: s.checkOutBy,
    smoking: s.smoking, pets: s.pets, minAge: s.minAge, cancelPolicy: s.cancelPolicy, maxGuests, currency: s.currency,
  };
}

export const googlePropertyOf = (structureId: string): string => readChannexMap()[structureId]?.propertyId ?? "";

export function lastGoogleResult(structureId: string): GoogleSyncResult | null {
  try { const m = JSON.parse(localStorage.getItem(RESULT_KEY) || "{}"); return m[structureId] ?? null; } catch { return null; }
}
function remember(structureId: string, r: GoogleSyncResult) {
  try { const m = JSON.parse(localStorage.getItem(RESULT_KEY) || "{}"); m[structureId] = r; localStorage.setItem(RESULT_KEY, JSON.stringify(m)); window.dispatchEvent(new Event("spigolestay:google-result")); } catch { /* storage non disponibile */ }
}

/** Invia i dati della struttura (se è collegata). Mai lancia: l'esito si ricorda e si può leggere con lastGoogleResult. */
export async function pushStructureContent(s: Structure, roomTypes: readonly RoomType[]): Promise<GoogleSyncResult | null> {
  const propertyId = googlePropertyOf(s.id);
  if (!propertyId) return null;
  try {
    const j = await apiPost<{ ok: boolean; steps?: { label: string; ok: boolean; detail?: string; debug?: string }[] }>("channex/property-content", { action: "sync", propertyId, content: contentOfStructure(s, roomTypes) });
    const res: GoogleSyncResult = { at: Date.now(), ok: !!j.ok, problems: (j.steps ?? []).filter((x) => !x.ok).map((x) => ({ label: x.label, detail: x.detail, debug: x.debug })) };
    remember(s.id, res);
    return res;
  } catch (e) {
    const res: GoogleSyncResult = { at: Date.now(), ok: false, problems: [{ label: "Invio", detail: "Non sono riuscito a inviare i dati: riprova tra poco.", debug: e instanceof Error ? e.message : undefined }] };
    remember(s.id, res);
    return res;
  }
}
