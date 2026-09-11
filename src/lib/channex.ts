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
