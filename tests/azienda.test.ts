import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./helpers/alias-loader.mjs", import.meta.url);
const A = await import("../src/lib/azienda.ts");

test("i dati aziendali non ancora esistenti sono segnaposto uniformi", () => {
  for (const k of ["denominazione", "partitaIva", "codiceFiscale", "sede", "pec"] as const) {
    assert.match(A.AZIENDA[k], /^\[DA COMPLETARE: .+\]$/, k);
    assert.ok(A.isSegnaposto(A.AZIENDA[k]));
  }
  assert.equal(A.isSegnaposto("Esempio S.r.l."), false);
});

test("la riga del footer usa il marchio e la denominazione", () => {
  // finché la denominazione è un segnaposto il footer mostra solo il marchio; con la denominazione vera la mostra
  assert.equal(A.copyrightRiga(2026), A.isSegnaposto(A.AZIENDA.denominazione) ? "© 2026 Xenora" : `© 2026 Xenora · ${A.AZIENDA.denominazione}`);
  assert.equal(A.partitaIvaFooter(), A.isSegnaposto(A.AZIENDA.partitaIva) ? "" : ` · P.IVA ${A.AZIENDA.partitaIva}`);
});

test("le pagine pubbliche non nominano più una società inventata e non hanno segnaposto sparsi", () => {
  const files = ["src/app/termini/page.tsx", "src/app/privacy/page.tsx", "src/app/cookie/page.tsx", "src/components/LegalShell.tsx", "src/app/prezzi/page.tsx", "src/app/login/LoginForm.tsx"];
  for (const f of files) {
    const s = readFileSync(new URL("../" + f, import.meta.url), "utf8");
    assert.ok(!/Xenora Digital Solutions/.test(s.replace(/xenoradigitalsolutions/g, "")), `${f}: nome società scritto a mano`);
    assert.ok(!/\[ragione sociale\]|\[indirizzo sede\]|\[__\]/.test(s), `${f}: segnaposto non uniforme`);
  }
});
