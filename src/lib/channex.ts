// ============================================================
//  Client API Channex (server-side)
//  - La chiave sta SOLO nelle env di Vercel (CHANNEX_API_KEY), mai nel codice/client.
//  - Base URL configurabile: default staging (ambiente di prova).
//    Staging:    https://staging.channex.io/api/v1
//    Produzione: https://secure.channex.io/api/v1  (imposta CHANNEX_API_URL quando andrai live)
//  - Autenticazione Channex: header "user-api-key".
// ============================================================

const BASE = process.env.CHANNEX_API_URL || "https://staging.channex.io/api/v1";
const KEY = process.env.CHANNEX_API_KEY || "";

export const channexEnabled = () => !!KEY;
export const channexBase = () => BASE;

export interface ChannexResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

// Chiamata generica all'API Channex. Non logga mai la chiave.
export async function channex<T = unknown>(path: string, init?: RequestInit): Promise<ChannexResult<T>> {
  if (!KEY) return { ok: false, status: 0, error: "CHANNEX_API_KEY non configurata" };
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "user-api-key": KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = undefined;
    try { json = text ? JSON.parse(text) : undefined; } catch { /* non-JSON */ }
    if (!res.ok) {
      const msg = (json && typeof json === "object" && "errors" in json) ? JSON.stringify((json as { errors: unknown }).errors) : (text.slice(0, 300) || res.statusText);
      return { ok: false, status: res.status, error: msg };
    }
    return { ok: true, status: res.status, data: json as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "errore di rete" };
  }
}

// Elenco proprietà (usato per il test connessione).
export async function listProperties() {
  return channex<{ data: { id: string; attributes?: { title?: string } }[] }>("/properties");
}

type Created = { data?: { id?: string } };

// ── Creazione (usata dalla sincronizzazione Xenora → Channex) ──
export interface SyncProperty {
  title: string; currency?: string; country?: string; city?: string; address?: string;
  email?: string; phone?: string; latitude?: string; longitude?: string; logo_url?: string; website?: string;
}
export async function createProperty(p: SyncProperty) {
  return channex<Created>("/properties", {
    method: "POST",
    body: JSON.stringify({ property: {
      title: p.title,
      currency: p.currency || "EUR",
      country: p.country || "IT",
      timezone: "Europe/Rome",
      property_type: "hotel",
      city: p.city || undefined, address: p.address || undefined,
      email: p.email || undefined, phone: p.phone || undefined,
      latitude: p.latitude || undefined, longitude: p.longitude || undefined,
      // Channex accetta solo URL http(s) validi: logo caricato (data:/relativo) e siti non-URL vengono omessi.
      logo_url: (p.logo_url && /^https?:\/\/\S+$/i.test(p.logo_url)) ? p.logo_url : undefined,
      website: (p.website && /^https?:\/\/\S+$/i.test(p.website)) ? p.website : undefined,
    } }),
  });
}

export interface SyncRoom { title: string; count: number; occAdults: number; occChildren?: number; defaultOccupancy?: number }
export async function createRoomType(propertyId: string, r: SyncRoom) {
  return channex<Created>("/room_types", {
    method: "POST",
    body: JSON.stringify({ room_type: {
      property_id: propertyId,
      title: r.title,
      count_of_rooms: Math.max(1, r.count),
      occ_adults: Math.max(1, r.occAdults),
      occ_children: r.occChildren ?? 0,
      occ_infants: 0,
      default_occupancy: r.defaultOccupancy ?? Math.max(1, r.occAdults),
      room_kind: "room",
    } }),
  });
}

export async function createRatePlan(propertyId: string, roomTypeId: string, opts: { title?: string; occupancy: number; rate: number; currency?: string }) {
  return channex<Created>("/rate_plans", {
    method: "POST",
    body: JSON.stringify({ rate_plan: {
      title: opts.title || "Standard",
      property_id: propertyId,
      room_type_id: roomTypeId,
      currency: opts.currency || "EUR",
      sell_mode: "per_room",
      rate_mode: "manual",
      options: [{ occupancy: Math.max(1, opts.occupancy), is_primary: true, rate: Math.max(0, Math.round(opts.rate)) }],
    } }),
  });
}
