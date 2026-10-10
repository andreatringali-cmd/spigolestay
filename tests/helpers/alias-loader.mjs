// Hook di risoluzione per i test: risolve l'alias "@/" (-> src/) e gli import senza estensione (.ts/.tsx),
// cosi i test possono caricare moduli reali come src/lib/channex-ari.ts. Si registra con module.register().
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";

const SRC = pathResolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const EXTS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function tryFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const e of EXTS) if (existsSync(base + e)) return base + e;
  return null;
}

export async function resolve(specifier, context, next) {
  let base = null;
  if (specifier.startsWith("@/")) base = pathResolve(SRC, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    base = pathResolve(dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (base) {
    const f = tryFile(base);
    if (f) return next(pathToFileURL(f).href, context);
  }
  return next(specifier, context);
}
