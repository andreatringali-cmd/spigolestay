import test from "node:test";
import assert from "node:assert/strict";
import { h, html, loadUi, type AnyComp } from "./ui-harness.ts";

const ui = await loadUi();
const Button = ui.Button as AnyComp;
const IconButton = ui.IconButton as AnyComp;
const buttonClass = ui.buttonClass as (v?: string, s?: string, e?: string) => string;

test("Button: di base è type=button, primaria, 40 px (44 su telefono)", () => {
  const out = html(h(Button, null, "Salva"));
  assert.match(out, /<button[^>]*type="button"/);
  assert.match(out, /bg-focus/);
  assert.match(out, /text-on-focus/);
  assert.match(out, /\bh-10\b/);
  assert.match(out, /max-sm:h-11/);
  assert.match(out, />Salva</);
});

test("Button: le taglie sm/md hanno altezze 36/40 e 44 su telefono", () => {
  assert.match(html(h(Button, { size: "sm" }, "x")), /\bh-9\b/);
  assert.match(html(h(Button, { size: "sm" }, "x")), /max-sm:h-11/);
  assert.match(html(h(Button, { size: "md" }, "x")), /\bh-10\b/);
});

test("Button: la taglia xs (righe compatte) è 32 px, 40 su telefono, con testo xs", () => {
  const x = html(h(Button, { size: "xs" }, "x"));
  assert.match(x, /\bh-8\b/);
  assert.match(x, /max-sm:h-10/);
  assert.match(x, /text-xs/);
  assert.doesNotMatch(x, /text-sm/);
  assert.match(html(h(Button, { size: "sm" }, "x")), /text-sm/);
});

test("Button: varianti secondary, ghost e danger usano i token", () => {
  assert.match(html(h(Button, { variant: "secondary" }, "x")), /border-line-strong/);
  assert.match(html(h(Button, { variant: "ghost" }, "x")), /text-dim/);
  const d = html(h(Button, { variant: "danger" }, "x"));
  assert.match(d, /bg-err/);
  assert.match(d, /text-on-err/);
  assert.doesNotMatch(d, /text-white|#[0-9a-fA-F]{3,6}/, "nessun colore fisso");
});

test("Button: loading = disabled + aria-busy + spinner; disabled normale senza aria-busy", () => {
  const l = html(h(Button, { loading: true }, "Salvo…"));
  assert.match(l, /disabled=""/);
  assert.match(l, /aria-busy="true"/);
  assert.match(l, /animate-spin/);
  const d = html(h(Button, { disabled: true }, "x"));
  assert.match(d, /disabled=""/);
  assert.doesNotMatch(d, /aria-busy/);
  assert.match(d, /disabled:opacity-50/);
  assert.match(d, /disabled:cursor-not-allowed/);
});

test("Button: focus visibile esplicito e fullWidth", () => {
  const out = html(h(Button, { fullWidth: true }, "x"));
  assert.match(out, /focus-visible:outline-2/);
  assert.match(out, /focus-visible:outline-focus/);
  assert.match(out, /\bw-full\b/);
});

test("IconButton: aria-label e title dalla prop label, quadrato", () => {
  const out = html(h(IconButton, { label: "Chiudi" }, h("span", null, "x")));
  assert.match(out, /aria-label="Chiudi"/);
  assert.match(out, /title="Chiudi"/);
  assert.match(out, /\bw-10\b/);
  assert.match(out, /max-sm:w-11/);
});

test("buttonClass: riusabile su un link", () => {
  const c = buttonClass("primary", "sm", "mt-2");
  assert.match(c, /bg-focus/);
  assert.match(c, /\bh-9\b/);
  assert.match(c, /mt-2$/);
});
