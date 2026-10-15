import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { RECEIPT_BUCKET, buildPurchaseMovement, isReceiptPathOf, isUuid } from "@/lib/pulizie-purchase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Collegamento acquisto → Prima nota (tabella cash_movements). Si scrive dal SERVER con la chiave di servizio e con il tenant_id del
// TITOLARE del workspace (authTenant), così funziona anche per un collaboratore con il solo permesso Pulizie, senza dipendere dalle policy
// della tabella. Id del movimento = id dell'acquisto → nessun doppione, e dalla Cassa si risale allo scontrino.
//  - POST   { id, date, name, qty, cost, structureId, conto } → crea il movimento SE NON ESISTE già (non sovrascrive mai: se in Cassa
//    lo hai corretto a mano, resta com'è). Senza importo non crea nulla.
//  - DELETE ?id=…[&receipt=…] → toglie il movimento dell'acquisto (acquisto eliminato) e, se indicato, il file dello scontrino.

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const built = buildPurchaseMovement({
      id: String(b.id ?? ""), date: String(b.date ?? ""), name: String(b.name ?? ""), qty: Number(b.qty),
      cost: b.cost == null ? undefined : Number(b.cost), structureId: b.structureId ? String(b.structureId) : undefined, conto: b.conto ? String(b.conto) : undefined,
    }, auth.tenantId);
    if (!built.ok) return NextResponse.json({ error: "invalid", message: built.error }, { status: 400 });
    const { data: existing, error: selErr } = await auth.admin.from("cash_movements").select("id, tenant_id").eq("id", built.row.id).maybeSingle();
    if (selErr) return NextResponse.json({ error: "db_error", message: selErr.message }, { status: 502 });
    if (existing) {
      if (existing.tenant_id !== auth.tenantId) return NextResponse.json({ error: "conflict" }, { status: 409 }); // mai toccare i dati di un altro account
      return NextResponse.json({ ok: true, created: false }); // già registrato: idempotente
    }
    const { error } = await auth.admin.from("cash_movements").insert(built.row);
    if (error) {
      if ((error as { code?: string }).code === "23505") return NextResponse.json({ ok: true, created: false }); // inserito in parallelo da un altro dispositivo
      return NextResponse.json({ error: "db_error", message: error.message }, { status: 502 });
    }
    return NextResponse.json({ ok: true, created: true });
  } catch (e) { return NextResponse.json({ error: "failed", message: (e as Error)?.message ?? "errore" }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { error } = await auth.admin.from("cash_movements").delete().eq("id", id).eq("tenant_id", auth.tenantId);
  if (error) return NextResponse.json({ error: "db_error", message: error.message }, { status: 502 });
  const receipt = sp.get("receipt");
  if (receipt && isReceiptPathOf(auth.tenantId, receipt)) await auth.admin.storage.from(RECEIPT_BUCKET).remove([receipt]).catch(() => {});
  return NextResponse.json({ ok: true });
}
