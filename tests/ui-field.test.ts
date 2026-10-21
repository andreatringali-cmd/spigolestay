import test from "node:test";
import assert from "node:assert/strict";
import { h, html, loadUi, type AnyComp } from "./ui-harness.ts";

const ui = await loadUi();
const Field = ui.Field as AnyComp;
const Input = ui.Input as AnyComp;
const Select = ui.Select as AnyComp;
const Textarea = ui.Textarea as AnyComp;

test("Field: etichetta collegata al campo con htmlFor/id", () => {
  const out = html(h(Field, { label: "Email" }, h(Input, { type: "email" })));
  const id = out.match(/<label[^>]*for="([^"]+)"/)?.[1];
  assert.ok(id, "label con for");
  assert.match(out, new RegExp(`<input[^>]*id="${id!.replace(/[:.]/g, "\\$&")}"`));
  assert.match(out, />Email</);
});

test("Field: hint collegato con aria-describedby", () => {
  const out = html(h(Field, { label: "Nome", hint: "Come sul documento" }, h(Input, null)));
  const hintId = out.match(/<p id="([^"]+-hint)"/)?.[1];
  assert.ok(hintId);
  assert.match(out, new RegExp(`aria-describedby="${hintId!.replace(/[:.]/g, "\\$&")}"`));
  assert.doesNotMatch(out, /aria-invalid/);
});

test("Field: errore = role=alert, aria-invalid e bordo rosso", () => {
  const out = html(h(Field, { label: "Email", error: "Indirizzo non valido" }, h(Input, null)));
  assert.match(out, /role="alert"/);
  assert.match(out, /Indirizzo non valido/);
  assert.match(out, /aria-invalid="true"/);
  assert.match(out, /border-err/);
  assert.doesNotMatch(out, /border-line-strong/);
});

test("Field: required mette l'asterisco decorativo e l'attributo required", () => {
  const out = html(h(Field, { label: "Cognome", required: true }, h(Input, null)));
  assert.match(out, /aria-hidden="true">\*</);
  assert.match(out, /<input[^>]*required=""/);
});

test("Input: altezza unica 40 px (44 su telefono), bordo forte, placeholder faint, focus", () => {
  const out = html(h(Input, { placeholder: "Cerca" }));
  assert.match(out, /\bh-10\b/);
  assert.match(out, /max-sm:h-11/);
  assert.match(out, /border-line-strong/);
  assert.match(out, /placeholder:text-faint/);
  assert.match(out, /focus-visible:outline-focus/);
  assert.match(out, /disabled:bg-wash/);
});

test("Input con scorciatoie label/error si avvolge da solo in un Field", () => {
  const out = html(h(Input, { label: "Telefono", error: "Obbligatorio" }));
  assert.match(out, /<label[^>]*for=/);
  assert.match(out, /role="alert"/);
  assert.match(out, /aria-invalid="true"/);
  assert.match(out, /aria-describedby=/);
});

test("Select: stessa altezza, chevron decorativo, opzioni passate", () => {
  const out = html(h(Select, { label: "Stato" }, h("option", { value: "a" }, "Aperta")));
  assert.match(out, /<select/);
  assert.match(out, /\bh-10\b/);
  assert.match(out, /appearance-none/);
  assert.match(out, /<svg[^>]*aria-hidden="true"/);
  assert.match(out, />Aperta</);
});

test("Textarea: altezza minima e aria dall'errore", () => {
  const out = html(h(Textarea, { label: "Note", error: "Troppo lungo" }));
  assert.match(out, /<textarea/);
  assert.match(out, /min-h-20/);
  assert.match(out, /aria-invalid="true"/);
});
