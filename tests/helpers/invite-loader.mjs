// Loader per i test degli inviti (api/admin/allowlist): come stubs-loader.mjs, più un finto "@/lib/server-auth" con isUserAllowed.
// globalThis.__stubs.allowed === false → chi chiama non è ammesso (accesso su invito); rateLimited → tetto orario raggiunto.
import { resolve as stubsResolve } from "./stubs-loader.mjs";

const SA = "data:text/javascript," + encodeURIComponent(`
  const S = (globalThis.__stubs ??= { calls: {} });
  export const isUserAllowed = async () => S.allowed !== false;
  export const rateLimited = (key) => { (S.limitKeys ??= []).push(key); return !!S.rateLimited; };
  export const siteOrigin = () => "https://test.xenora.local";
  export const isInternalRequest = () => false;
  export const internalFetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
`);

export async function resolve(specifier, context, next) {
  if (specifier === "@/lib/server-auth") return { url: SA, shortCircuit: true };
  return stubsResolve(specifier, context, next);
}
