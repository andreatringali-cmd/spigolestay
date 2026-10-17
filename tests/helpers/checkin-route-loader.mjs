// Loader per il test della route /api/checkin: come stubs-loader.mjs, più un finto "@/lib/invoicing/api" (authTenant) che il loader comune non conosce.
// globalThis.__stubs.operator = true → la richiesta con header Authorization è dell'operatore (titolare "owner-op"); altrimenti non autorizzata.
import { resolve as stubsResolve } from "./stubs-loader.mjs";

const INV = "data:text/javascript," + encodeURIComponent(`
  const S = globalThis.__stubs;
  export const authTenant = async () => (S.operator ? { admin: S.admin, tenantId: S.operatorId, userId: S.operatorId } : { __resp: true, status: 401 });
  export const isResponse = (x) => !!x && x.__resp === true;
`);

export async function resolve(specifier, context, next) {
  if (specifier === "@/lib/invoicing/api") return { url: INV, shortCircuit: true };
  return stubsResolve(specifier, context, next);
}
