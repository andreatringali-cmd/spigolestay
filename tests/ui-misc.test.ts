import test from "node:test";
import assert from "node:assert/strict";
import { h, html, loadUi, type AnyComp } from "./ui-harness.ts";

const ui = await loadUi();
const Badge = ui.Badge as AnyComp;
const Switch = ui.Switch as AnyComp;
const Tabs = ui.Tabs as AnyComp;
const TabPanel = ui.TabPanel as AnyComp;
const DataTable = ui.DataTable as AnyComp;
const Alert = ui.Alert as AnyComp;
const ToastView = ui.ToastView as AnyComp;
const ModalView = ui.ModalView as AnyComp;

// ── Badge ──
test("Badge: toni ok/warn/err/info/neutral con testo e tinta del token", () => {
  assert.match(html(h(Badge, { tone: "ok" }, "Saldato")), /bg-ok\/15 text-ok/);
  assert.match(html(h(Badge, { tone: "warn" }, "x")), /bg-warn\/15 text-warn/);
  assert.match(html(h(Badge, { tone: "err" }, "x")), /bg-err\/15 text-err/);
  assert.match(html(h(Badge, { tone: "info" }, "x")), /bg-focus\/15 text-focus/);
  assert.match(html(h(Badge, null, "x")), /bg-wash text-dim/);
});

test("Badge: due taglie, mai sotto 11 px; dot decorativo", () => {
  assert.match(html(h(Badge, null, "x")), /text-\[11px\]/);
  assert.match(html(h(Badge, { size: "md" }, "x")), /text-xs/);
  const d = html(h(Badge, { tone: "ok", dot: true }, "Pagato"));
  assert.match(d, /aria-hidden="true"/);
  assert.match(d, />Pagato</);
  for (const m of html(h(Badge, null, "x")).matchAll(/text-\[(\d+)px\]/g)) assert.ok(Number(m[1]) >= 11);
});

// ── Switch ──
test("Switch: role=switch, aria-checked, aria-label e bersaglio esteso", () => {
  const on = html(h(Switch, { checked: true, label: "Invio automatico" }));
  assert.match(on, /role="switch"/);
  assert.match(on, /aria-checked="true"/);
  assert.match(on, /aria-label="Invio automatico"/);
  assert.match(on, /before:-inset-2/);
  assert.match(on, /var\(--focus\)/);
  const off = html(h(Switch, { checked: false }));
  assert.match(off, /aria-checked="false"/);
  assert.match(off, /var\(--line-strong\)/);
});

test("Switch: disabled e colore personalizzato", () => {
  const d = html(h(Switch, { checked: true, disabled: true, color: "var(--ok)" }));
  assert.match(d, /disabled=""/);
  assert.match(d, /var\(--ok\)/);
});

// ── Tabs ──
const ITEMS = [{ value: "a", label: "Arrivi" }, { value: "b", label: "Partenze", badge: 3 }, { value: "c", label: "Chiusi", disabled: true }];

test("Tabs: tablist/tab con aria-selected e tabindex mobile", () => {
  const out = html(h(Tabs, { id: "t", ariaLabel: "Sezioni", value: "b", onChange: () => {}, items: ITEMS }));
  assert.match(out, /role="tablist"/);
  assert.match(out, /aria-label="Sezioni"/);
  assert.equal((out.match(/role="tab"/g) || []).length, 3);
  assert.match(out, /id="t-tab-b"[^>]*aria-selected="true"[^>]*tabindex="0"|aria-selected="true"[^>]*id="t-tab-b"/);
  assert.match(out, /aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(out, /aria-controls="t-panel-a"/);
  assert.match(out, />3</);
});

test("TabPanel: role=tabpanel collegato alla scheda, solo se attivo", () => {
  const on = html(h(TabPanel, { id: "t", value: "a", active: "a" }, "contenuto"));
  assert.match(on, /role="tabpanel"/);
  assert.match(on, /id="t-panel-a"/);
  assert.match(on, /aria-labelledby="t-tab-a"/);
  assert.equal(html(h(TabPanel, { id: "t", value: "a", active: "b" }, "x")), "");
});

test("Tabs: variante pill e bersagli 40/44 px", () => {
  const out = html(h(Tabs, { id: "t", value: "a", onChange: () => {}, items: ITEMS, variant: "pill" }));
  assert.match(out, /rounded-lg bg-wash/);
  assert.match(out, /\bh-10\b/);
  assert.match(out, /max-sm:h-11/);
});

// ── DataTable ──
const COLS = [{ key: "n", header: "Nome", cell: (r: { n: string }) => r.n }, { key: "i", header: "Importo", align: "right", cell: () => "€ 10,00" }];

test("DataTable: intestazioni scope=col, caption nascosta, allineamento a destra", () => {
  const out = html(h(DataTable, { columns: COLS, rows: [{ n: "Rossi" }], rowKey: (r: { n: string }) => r.n, caption: "Pagamenti" }));
  assert.match(out, /<caption class="sr-only">Pagamenti</);
  assert.equal((out.match(/scope="col"/g) || []).length, 2);
  assert.match(out, /text-right/);
  assert.match(out, />Rossi</);
});

test("DataTable: righe cliccabili raggiungibili da tastiera", () => {
  const out = html(h(DataTable, { columns: COLS, rows: [{ n: "A" }, { n: "B" }], rowKey: (r: { n: string }) => r.n, onRowClick: () => {} }));
  assert.equal((out.match(/<tr[^>]*tabindex="0"/g) || []).length, 2);
  assert.match(out, /cursor-pointer/);
  const plain = html(h(DataTable, { columns: COLS, rows: [{ n: "A" }], rowKey: (r: { n: string }) => r.n }));
  assert.doesNotMatch(plain, /tabindex/);
});

test("DataTable: stato vuoto, caricamento con aria-busy, intestazione sticky", () => {
  const e = html(h(DataTable, { columns: COLS, rows: [], rowKey: () => "x", empty: "Nessun pagamento" }));
  assert.match(e, /colSpan|colspan="2"/);
  assert.match(e, /Nessun pagamento/);
  const l = html(h(DataTable, { columns: COLS, rows: [], rowKey: () => "x", loading: true, loadingRows: 3 }));
  assert.match(l, /aria-busy="true"/);
  assert.equal((l.match(/animate-pulse/g) || []).length, 6);
  assert.doesNotMatch(l, /Nessun dato/);
  const s = html(h(DataTable, { columns: COLS, rows: [], rowKey: () => "x", stickyHeader: true }));
  assert.match(s, /sticky top-0/);
});

// ── Alert / Toast ──
test("Alert: errore e avviso = role=alert, gli altri role=status", () => {
  assert.match(html(h(Alert, { tone: "err" }, "x")), /role="alert"/);
  assert.match(html(h(Alert, { tone: "warn" }, "x")), /role="alert"/);
  assert.match(html(h(Alert, { tone: "ok" }, "x")), /role="status"/);
  assert.match(html(h(Alert, null, "x")), /role="status"/);
});

test("Alert: titolo, chiusura con aria-label, icona decorativa", () => {
  const out = html(h(Alert, { tone: "err", title: "Non salvato", onClose: () => {} }, "Riprova"));
  assert.match(out, />Non salvato</);
  assert.match(out, /aria-label="Chiudi"/);
  assert.match(out, /aria-hidden="true"/);
  assert.match(out, /border-l-err/);
});

test("ToastView: contiene il messaggio e il pulsante chiudi", () => {
  const out = html(h(ToastView, { message: "Salvato", tone: "ok", onClose: () => {} }));
  assert.match(out, /Salvato/);
  assert.match(out, /aria-label="Chiudi"/);
  assert.match(out, /role="status"/);
});

// ── Modal (il pannello, senza portale) ──
test("Modal: role=dialog, aria-modal, titolo e descrizione collegati", () => {
  const out = html(h(ModalView, { onClose: () => {}, title: "Nuova tariffa", description: "Compila i campi" }, "corpo"));
  assert.match(out, /role="dialog"/);
  assert.match(out, /aria-modal="true"/);
  const labelled = out.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(labelled);
  assert.match(out, new RegExp(`<h2 id="${labelled!.replace(/[:.]/g, "\\$&")}"[^>]*>Nuova tariffa<`));
  const described = out.match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(described);
  assert.match(out, new RegExp(`<p id="${described!.replace(/[:.]/g, "\\$&")}"`));
});

test("Modal: z-index dai token, versione sheet su telefono, pulsante chiudi con aria-label", () => {
  const out = html(h(ModalView, { onClose: () => {}, title: "T", closeLabel: "Chiudi finestra" }, "x"));
  assert.match(out, /z-index:var\(--z-modal\)/);
  assert.match(out, /max-sm:items-end/);
  assert.match(out, /max-sm:rounded-b-none/);
  assert.match(out, /aria-label="Chiudi finestra"/);
  const top = html(h(ModalView, { onClose: () => {}, title: "T", layer: "top" }, "x"));
  assert.match(top, /calc\(var\(--z-modal\) \+ 10\)/);
});

test("Modal: footer a destra, busy blocca il pulsante chiudi, dimensioni", () => {
  const out = html(h(ModalView, { onClose: () => {}, title: "T", footer: h("button", null, "Salva"), busy: true, size: "sm" }, "x"));
  assert.match(out, /justify-end/);
  assert.match(out, /max-w-sm/);
  assert.match(out, /data-modal-close[^>]*disabled=""|disabled=""[^>]*data-modal-close/);
  assert.match(html(h(ModalView, { onClose: () => {}, title: "T", size: "lg" }, "x")), /max-w-2xl/);
});
