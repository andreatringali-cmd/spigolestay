// Hook di risoluzione per i test dei moduli SERVER (import Channex, intake prenotazioni del sito):
// oltre all'alias "@/" (alias-loader.mjs) sostituisce con finti i moduli che farebbero rete o richiedono Next.js
// (next/server, @supabase/supabase-js, server-auth, pool-push, googleCalendarSync). I finti scrivono le chiamate in
// globalThis.__stubs (calls) così i test possono verificare cosa e' stato fatto, senza nessuna chiamata reale.
import { resolve as aliasResolve } from "./alias-loader.mjs";

const src = (code) => "data:text/javascript," + encodeURIComponent(code);
const CALLS = `const S = (globalThis.__stubs ??= { calls: {}, rateLimited: false, internal: false }); const rec = (k, v) => { (S.calls[k] ??= []).push(v); };`;

const STUBS = {
  "next/server": src(`${CALLS}
    export class NextResponse { constructor(body, init) { this.body = body; this.status = init?.status ?? 200; }
      static json(body, init) { return new NextResponse(body, init); } async json() { return this.body; } }
    export const after = (fn) => { rec("after", 1); return fn(); };`),
  "@supabase/supabase-js": src(`${CALLS}
    export const createClient = () => { if (!S.admin) throw new Error("globalThis.__stubs.admin non impostato"); return S.admin; };`),
  "@/lib/server-auth": src(`${CALLS}
    export const isInternalRequest = () => !!S.internal;
    export const rateLimited = () => !!S.rateLimited;
    export const siteOrigin = () => "https://test.xenora.local";
    export const internalFetch = async (url, init) => { rec("internalFetch", { url: String(url), body: init?.body ? JSON.parse(init.body) : null }); const forced = S.internalResponse?.(String(url)); if (forced) return forced; return { ok: true, status: 200, json: async () => ({ ok: true }) }; };`),
  "@/lib/pool-push": src(`${CALLS}
    export const schedulePoolPush = async (blob, touched) => { rec("poolPush", { blob, touched }); };
    export const pushPoolAvailability = async () => ({ pushed: 0 });`),
  // La coda con limite 20/min ha il suo test (channex-queue.test.ts): qui passa dritto, altrimenti i test aspetterebbero davvero 60 secondi.
  "@/lib/channex-queue": src(`export const channexFetch = (url, init) => fetch(url, init);`),
  "@/lib/googleCalendarSync": src(`${CALLS}
    export const gcalEventId = (id) => "ev" + id;
    export const upsertGcalEvent = async (i) => { rec("gcalUpsert", i); return { ok: true }; };
    export const deleteGcalEvent = async (cal, ev) => { rec("gcalDelete", { cal, ev }); return { ok: true }; };`),
};

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
  return aliasResolve(specifier, context, next);
}
