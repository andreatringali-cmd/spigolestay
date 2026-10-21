// Divisione del blocco dati locale tra stato personale e strutture condivise (org). Logica PURA estratta da authsync.tsx (nessun cambiamento di comportamento) per poterla provare con i test.
type DataObj = Record<string, unknown>;
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
export const EMPTY_ORG_DATA = (): DataObj => ({ structures: [], roomTypes: [], units: [], bookings: [], guests: [], rateOverrides: {} });

// Divide il blob dati per organizzazione. Ritorna il sottoinsieme personale + una mappa orgId→sottoinsieme.
export function splitByOrg(d: DataObj): { personal: DataObj; orgs: Map<string, DataObj> } {
  const orgByStruct = new Map<string, string>();
  for (const s of arr(d.structures) as { id?: string; orgId?: string }[]) if (s?.id && s.orgId) orgByStruct.set(s.id, s.orgId);
  const structByRt = new Map<string, string>();
  for (const rt of arr(d.roomTypes) as { id?: string; structureId?: string }[]) if (rt?.id && rt.structureId) structByRt.set(rt.id, rt.structureId);
  const orgOfStruct = (sid?: string | null) => (sid && orgByStruct.get(sid)) || null;
  const orgOfRt = (rtId?: string | null) => orgOfStruct(rtId ? structByRt.get(rtId) : null);

  const personal: DataObj = { ...d, structures: [], roomTypes: [], units: [], bookings: [], guests: [], rateOverrides: {} };
  const orgs = new Map<string, DataObj>();
  const orgOf = (o: string | null): DataObj => { if (!o) return personal; if (!orgs.has(o)) orgs.set(o, EMPTY_ORG_DATA()); return orgs.get(o)!; };

  for (const s of arr(d.structures) as { orgId?: string }[]) (orgOf(s?.orgId || null).structures as unknown[]).push(s);
  for (const rt of arr(d.roomTypes) as { structureId?: string }[]) (orgOf(orgOfStruct(rt?.structureId)).roomTypes as unknown[]).push(rt);
  for (const u of arr(d.units) as { structureId?: string }[]) (orgOf(orgOfStruct(u?.structureId)).units as unknown[]).push(u);
  // prenotazioni per struttura; raccogli gli ospiti citati dalle prenotazioni condivise
  const orgGuestIds = new Map<string, Set<string>>();
  for (const b of arr(d.bookings) as { structureId?: string; guestId?: string }[]) {
    const o = orgOfStruct(b?.structureId);
    (orgOf(o).bookings as unknown[]).push(b);
    if (o && b?.guestId) { if (!orgGuestIds.has(o)) orgGuestIds.set(o, new Set()); orgGuestIds.get(o)!.add(b.guestId); }
  }
  // ospiti: TUTTI restano nel personale; quelli citati da prenotazioni org vengono ANCHE copiati nell'org (nome visibile all'altro socio)
  personal.guests = arr(d.guests);
  const guestsById = new Map<string, unknown>();
  for (const g of arr(d.guests) as { id?: string }[]) if (g?.id) guestsById.set(g.id, g);
  for (const [o, ids] of orgGuestIds) { const gl: unknown[] = []; for (const id of ids) { const g = guestsById.get(id); if (g) gl.push(g); } (orgs.get(o) ?? orgOf(o)).guests = gl; }
  // rateOverrides: chiave "roomTypeId|ISO" → org del roomType; chiavi senza "|" → personale
  const ro = (d.rateOverrides && typeof d.rateOverrides === "object") ? d.rateOverrides as Record<string, number> : {};
  for (const [k, v] of Object.entries(ro)) {
    const rtId = k.includes("|") ? k.split("|")[0] : "";
    const o = rtId ? orgOfRt(rtId) : null;
    (orgOf(o).rateOverrides as Record<string, number>)[k] = v;
  }
  // Propaga le lapidi di cancellazione a OGNI org: così cancellare una prenotazione/ospite
  // condiviso viene scritto anche in org_state e non "risorge" dalla copia dell'organizzazione.
  const del = (d._deleted && typeof d._deleted === "object") ? d._deleted : {};
  for (const od of orgs.values()) od._deleted = del;
  return { personal, orgs };
}
