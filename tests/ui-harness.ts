// Appoggio per i test dei componenti del design system (src/components/ui/*.tsx).
// Node esegue i .ts ma non i .tsx (JSX): qui compiliamo i file con il compilatore TypeScript del progetto in una cartella
// temporanea di sistema (fuori dal progetto: il server di sviluppo non la vede e non si ricarica) e li importiamo, per poi fare renderToString.
// Gli import «react» vengono riscritti con il percorso assoluto di react del progetto.
import ts from "typescript";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

const SRC = new URL("../src/components/ui/", import.meta.url);
const OUT = pathToFileURL(mkdtempSync(tmpdir() + "/xn-ui-test-") + "/");
const BARE = ["react/jsx-runtime", "react/jsx-dev-runtime", "react", "react-dom"].map((m) => [m, import.meta.resolve(m)] as const);

type Mod = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyComp = (props: any) => ReactElement | null;

let built: Promise<Mod> | null = null;

/** Compila tutti i file di components/ui e restituisce l'indice (Button, Field, Modal…). */
export function loadUi(): Promise<Mod> {
  if (!built) {
    built = (async () => {
      mkdirSync(OUT, { recursive: true });
      for (const f of readdirSync(SRC)) {
        if (!/\.tsx?$/.test(f)) continue;
        const code = readFileSync(new URL(f, SRC), "utf8");
        const js = ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
          .replace(/(from\s+")(\.\/[^"]+)(")/g, "$1$2.mjs$3")
          .replace(/(from\s+")([^"./][^"]*)(")/g, (m, a, spec, c) => { const hit = BARE.find(([k]) => k === spec); return hit ? a + hit[1] + c : m; });
        writeFileSync(new URL(f.replace(/\.tsx?$/, ".mjs"), OUT), js);
      }
      process.on("exit", () => { try { rmSync(OUT, { recursive: true, force: true }); } catch { /* pulizia best-effort */ } });
      return (await import(new URL("index.mjs", OUT).href)) as Mod;
    })();
  }
  return built;
}

/** Crea un elemento React senza JSX: h(Comp, props, ...figli). */
export function h(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): ReactElement {
  return createElement(type as string, props ?? null, ...(children as []));
}

/** HTML renderizzato lato server. */
export function html(el: ReactElement): string {
  return renderToString(el);
}
