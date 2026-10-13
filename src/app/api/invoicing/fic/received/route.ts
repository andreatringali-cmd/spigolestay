import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { resolveFicSendConfig } from "@/lib/invoicing/fic-oauth";
import {
  listAllFicReceived, buildPreview, FicScopeError, type FicReceivedDoc, type ExistingDoc, type PreviewItem,
} from "@/lib/invoicing/fic-received";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// Massimo di fatture importate per chiamata (timeout della funzione).
const MAX_IMPORT = 300;

// Importa in "Fatture passive" le fatture/spese ricevute dai fornitori presenti in Fatture in Cloud.
// SOLA LETTURA su Fatture in Cloud (permesso received_documents:r).
//   action "preview": elenca i documenti del periodo, segnando quelli già presenti (non scrive nulla).
//   action "import":  ricarica il periodo da FIC (non si fida dei dati del browser) e inserisce SOLO gli
//                     id scelti non ancora importati. La deduplica è sul riferimento "[fic:<id>]" nelle note.
// Esiti "da risolvere" (non collegato / permesso mancante) tornano con 200 + ok:false + needsReconnect,
// così il client mostra il messaggio e il pulsante "Ricollega".
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b?.action || "preview");
    if (action !== "preview" && action !== "import") return NextResponse.json({ error: "bad_action" }, { status: 400 });
    const from = String(b?.from || ""), to = String(b?.to || "");
    if (!ISO.test(from) || !ISO.test(to) || from > to) return NextResponse.json({ error: "bad_period", message: "Periodo non valido." }, { status: 400 });

    let cfg;
    try { cfg = await resolveFicSendConfig(auth.admin, auth.tenantId); }
    catch (e) {
      const m = (e as Error)?.message;
      if (m === "fattureincloud_not_connected" || m === "fattureincloud_no_company") {
        return NextResponse.json({ ok: false, needsReconnect: true, message: "Fatture in Cloud non è collegato: collegalo per importare le fatture ricevute." });
      }
      throw e;
    }

    // Spese/fatture + note di credito passive del periodo.
    let docs: FicReceivedDoc[];
    try {
      const [exp, cn] = await Promise.all([
        listAllFicReceived(cfg, { from, to, type: "expense" }),
        listAllFicReceived(cfg, { from, to, type: "passive_credit_note" }),
      ]);
      docs = [...exp, ...cn];
    } catch (e) {
      if (e instanceof FicScopeError) return NextResponse.json({ ok: false, needsReconnect: true, message: e.message });
      throw e;
    }

    const { data: rows, error: dbErr } = await auth.admin.from("purchase_documents").select("supplier_name, doc_number, doc_date, notes").eq("tenant_id", auth.tenantId).limit(20000);
    if (dbErr) return NextResponse.json({ error: "db_failed", message: dbErr.message }, { status: 500 });
    const existing = (rows ?? []) as ExistingDoc[];
    const items = buildPreview(docs, existing);

    if (action === "preview") return NextResponse.json({ ok: true, items });

    // ---- import ----
    const wanted = new Set<number>(Array.isArray(b?.ficIds) ? b.ficIds.map(Number).filter((n: number) => Number.isFinite(n)) : []);
    const structureId = typeof b?.structureId === "string" && b.structureId && b.structureId !== "common" ? b.structureId : null;
    const todo: PreviewItem[] = items.filter((i) => wanted.has(i.ficId) && i.status !== "imported").slice(0, MAX_IMPORT);
    if (!todo.length) return NextResponse.json({ ok: true, imported: 0, skipped: wanted.size, suppliersCreated: 0 });

    // Fornitori: riusa per nome (senza maiuscole), crea i mancanti.
    const { data: sup } = await auth.admin.from("suppliers").select("id, name").eq("tenant_id", auth.tenantId);
    const byName = new Map<string, string>();
    for (const s of (sup ?? []) as { id: string; name: string }[]) byName.set(s.name.trim().toLowerCase(), s.id);
    let suppliersCreated = 0;
    for (const it of todo) {
      const key = it.supplier_name.trim().toLowerCase();
      if (!key || byName.has(key)) continue;
      const { data: ns } = await auth.admin.from("suppliers").insert({ tenant_id: auth.tenantId, name: it.supplier_name.trim(), vat: it.supplier_vat, country: it.supplier_country }).select("id").single();
      if (ns?.id) { byName.set(key, ns.id as string); suppliersCreated++; }
    }

    const now = new Date().toISOString();
    const insert = todo.map((it) => ({
      tenant_id: auth.tenantId, structure_id: structureId,
      supplier_id: byName.get(it.supplier_name.trim().toLowerCase()) ?? null, supplier_name: it.supplier_name.trim() || null,
      doc_number: it.doc_number, doc_date: it.doc_date, doc_type: it.doc_type, category: null,
      taxable_cents: it.taxable_cents, vat_cents: it.vat_cents, total_cents: it.total_cents,
      due_date: it.due_date, paid: it.paid, paid_at: it.paid ? (it.paid_at ?? it.doc_date) : null, payment_method: null,
      notes: it.notes, updated_at: now,
    }));
    const { error } = await auth.admin.from("purchase_documents").insert(insert);
    if (error) return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, imported: insert.length, skipped: wanted.size - insert.length, suppliersCreated });
  } catch (e) {
    return NextResponse.json({ error: "received_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 });
  }
}
