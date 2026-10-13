import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { resolveFicSendConfig } from "@/lib/invoicing/fic-oauth";
import {
  listAllFicClients, createFicClient, counterpartToFicClient, ficClientToCounterpart, planClientSync,
  type Counterpart, type FicClient,
} from "@/lib/invoicing/fic-clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Massimo di clienti creati su Fatture in Cloud per chiamata (limiti di frequenza dell'API e timeout della funzione).
const MAX_CREATE = 40;

// Allinea l'anagrafica clienti di Xenora con quella di Fatture in Cloud.
//   action "preview": confronta i due elenchi e dice cosa verrebbe inviato/importato (non scrive nulla).
//   action "sync":    applica SOLO le voci scelte (sendIds = id anagrafica Xenora da creare su FIC,
//                     importIds = id clienti FIC da importare in Xenora). Ricalcola il confronto al momento,
//                     quindi non crea mai un cliente già presente. Nessuna modifica/cancellazione su FIC.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b?.action || "preview");
    if (action !== "preview" && action !== "sync") return NextResponse.json({ error: "bad_action" }, { status: 400 });

    let cfg;
    try { cfg = await resolveFicSendConfig(auth.admin, auth.tenantId); }
    catch (e) {
      const m = (e as Error)?.message;
      if (m === "fattureincloud_not_connected" || m === "fattureincloud_no_company") {
        return NextResponse.json({ error: m, message: "Fatture in Cloud non è collegato: collegalo da Impostazioni fattura." }, { status: 409 });
      }
      throw e;
    }

    const { data: rows, error: dbErr } = await auth.admin.from("counterparts").select("*").eq("tenant_id", auth.tenantId).order("name");
    if (dbErr) return NextResponse.json({ error: "db_failed", message: dbErr.message }, { status: 500 });
    const xenora = (rows ?? []) as (Counterpart & { id: string })[];
    const fic = await listAllFicClients(cfg);
    if (fic.truncated && action === "sync") {
      return NextResponse.json({ error: "fic_list_truncated", message: "L'elenco clienti di Fatture in Cloud è troppo lungo per un confronto sicuro: operazione annullata." }, { status: 413 });
    }
    const plan = planClientSync(xenora, fic.clients);
    const ficKey = (f: FicClient) => String(f.id ?? "");
    const brief = (c: Counterpart) => ({ name: c.name, kind: c.kind, vat: c.vat || null, tax_code: c.tax_code || null, city: c.city || null });

    if (action === "preview") {
      return NextResponse.json({
        ok: true,
        xenoraTotal: xenora.length,
        ficTotal: fic.total,
        truncated: fic.truncated,
        aligned: plan.aligned,
        duplicates: plan.duplicatesXenora.length + plan.duplicatesFic.length,
        toSend: plan.toSend.map((c) => ({ id: c.id, ...brief(c) })),
        toImport: plan.toImport.map((f) => { const c = ficClientToCounterpart(f); return { id: ficKey(f), ...brief(c) }; }),
      });
    }

    // ---- sync ----
    const sendIds = new Set<string>(Array.isArray(b?.sendIds) ? b.sendIds.map(String) : []);
    const importIds = new Set<string>(Array.isArray(b?.importIds) ? b.importIds.map(String) : []);
    const sendList = plan.toSend.filter((c) => c.id && sendIds.has(c.id));
    const importList = plan.toImport.filter((f) => ficKey(f) && importIds.has(ficKey(f)));

    const errors: string[] = [];
    let created = 0, imported = 0;
    const batch = sendList.slice(0, MAX_CREATE);
    for (const c of batch) {
      try { await createFicClient(cfg, counterpartToFicClient(c)); created++; }
      catch (e) {
        const m = (e as Error)?.message || "errore";
        errors.push(`${c.name}: ${m}`);
        if (/\b429\b|\b401\b|\b403\b/.test(m)) break; // limite di frequenza o permessi: inutile proseguire
      }
    }
    if (importList.length) {
      const insert = importList.map((f) => ({ tenant_id: auth.tenantId, ...ficClientToCounterpart(f) })).filter((r) => r.name);
      const { error } = await auth.admin.from("counterparts").insert(insert);
      if (error) errors.push(`Importazione in Xenora: ${error.message}`);
      else imported = insert.length;
    }
    const remaining = sendList.length - created - errors.filter((e) => !e.startsWith("Importazione")).length;
    return NextResponse.json({ ok: errors.length === 0, created, imported, errors, remaining: Math.max(0, remaining) });
  } catch (e) {
    return NextResponse.json({ error: "clients_sync_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 });
  }
}
