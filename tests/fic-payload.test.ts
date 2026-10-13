import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { FattureInCloudProvider } = await import("../src/lib/invoicing/provider.ts");

// Cattura la richiesta di creazione documento che Xenora manda a Fatture in Cloud (fetch simulato: nessuna rete).
async function sendAndCapture(totals: { taxableCents: number; vatCents: number; outOfScopeCents: number; bolloCents: number; totalCents: number }, ficAmountDue?: number) {
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    calls.push({ method: init?.method ?? "GET", url: u, body: init?.body ? JSON.parse(init.body) : undefined });
    if (u.endsWith("/issued_documents/totals")) {
      return ficAmountDue == null ? new Response("{}", { status: 404 }) : new Response(JSON.stringify({ data: { amount_due: ficAmountDue } }), { status: 200 });
    }
    if (u.endsWith("/info/vat_types")) {
      return new Response(JSON.stringify({ data: [{ id: 1, value: 0, ei_type: "N2.2" }, { id: 2, value: 0, ei_type: "N1" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { id: 123 } }), { status: 200 });
  }) as typeof fetch;
  try {
    const p = new FattureInCloudProvider({ accessToken: "t", companyId: "9", dryRun: true });
    await p.send({
      docKind: "fattura", numberLabel: "2/2026", issueDate: "2026-10-13", currency: "EUR", notes: "",
      cliente: { name: "Mario Rossi", taxCode: "RSSMRA80A01H501U", country: "IT", sdiCode: "0000000" },
      lines: [
        { description: "DELUXE", qty: 1, unitPriceCents: 9900, vatRate: 0, vatNature: "N2.2" },
        { description: "Imposta di soggiorno", qty: 1, unitPriceCents: 396, vatRate: 0, vatNature: "N1" },
      ],
      totals,
      payment: { dueDate: "2026-11-12" },
    } as never);
  } finally { globalThis.fetch = realFetch; }
  return calls.find((c) => c.method === "POST" && c.url.endsWith("/issued_documents"))!.body as { data: Record<string, unknown> };
}

test("FIC: il bollo va nel campo stamp_duty, così il totale dei pagamenti coincide con il totale del documento", async () => {
  const { data } = await sendAndCapture({ taxableCents: 9900, vatCents: 0, outOfScopeCents: 396, bolloCents: 200, totalCents: 10496 });
  assert.equal(data.stamp_duty, 2);
  const pay = (data.payments_list as { amount: number }[]).reduce((a, x) => a + x.amount, 0);
  const items = (data.items_list as { qty: number; net_price: number }[]).reduce((a, x) => a + x.qty * x.net_price, 0);
  assert.equal(Math.round((items + (data.stamp_duty as number)) * 100), Math.round(pay * 100), "voci + bollo = pagamenti");
});

test("FIC: senza bollo non si manda stamp_duty", async () => {
  const { data } = await sendAndCapture({ taxableCents: 5000, vatCents: 0, outOfScopeCents: 0, bolloCents: 0, totalCents: 5000 });
  assert.ok(!("stamp_duty" in data));
});

test("FIC: il pagamento usa il totale da pagare calcolato da Fatture in Cloud, se diverso da quello di Xenora", async () => {
  const { data } = await sendAndCapture({ taxableCents: 9900, vatCents: 0, outOfScopeCents: 396, bolloCents: 200, totalCents: 10496 }, 102.96);
  assert.equal((data.payments_list as { amount: number }[])[0].amount, 102.96);
});

test("FIC: se il servizio dei totali non risponde, si resta sul totale di Xenora", async () => {
  const { data } = await sendAndCapture({ taxableCents: 9900, vatCents: 0, outOfScopeCents: 396, bolloCents: 200, totalCents: 10496 });
  assert.equal((data.payments_list as { amount: number }[])[0].amount, 104.96);
});

test("FIC: se i totali coincidono il pagamento non cambia", async () => {
  const { data } = await sendAndCapture({ taxableCents: 9900, vatCents: 0, outOfScopeCents: 396, bolloCents: 200, totalCents: 10496 }, 104.96);
  assert.equal((data.payments_list as { amount: number }[])[0].amount, 104.96);
});
