import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { resolveFicSendConfig } from "@/lib/invoicing/fic-oauth";
import { markFicPayment, todayRome } from "@/lib/invoicing/fic-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Allinea su Fatture in Cloud lo stato di pagamento di un documento emesso da lì (provider_ref "fic:<id>").
//   body { documentId, paid }: paid:true = dopo aver registrato un incasso in Xenora (se gli incassi coprono tutto il totale
//   del documento FIC lo segna pagato; se parziali non tocca nulla); paid:false = dopo l'annullo di un incasso.
// Risponde SEMPRE 200 con { ok, message, ... } anche se Fatture in Cloud non risponde: l'incasso in Xenora è già registrato.
// Mai una cancellazione su Fatture in Cloud.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const soft = (message: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, skipped: true, message, ...extra });
  try {
    const b = await req.json().catch(() => ({}));
    const documentId = String(b?.documentId || "");
    if (!documentId) return NextResponse.json({ error: "bad_request", message: "documentId mancante" }, { status: 400 });
    const paid = b?.paid !== false;

    const { data: doc } = await auth.admin.from("documents").select("id, provider_ref, total_cents, doc_kind").eq("id", documentId).eq("tenant_id", auth.tenantId).maybeSingle();
    if (!doc) return soft("documento non trovato");
    const ref = String(doc.provider_ref ?? "");
    if (!ref.startsWith("fic:")) return NextResponse.json({ ok: true, skipped: true, message: "Documento non emesso tramite Fatture in Cloud: niente da aggiornare." });
    if (doc.doc_kind === "nota_di_credito") return NextResponse.json({ ok: true, skipped: true, message: "Le note di credito non hanno incassi." });

    let cfg;
    try { cfg = await resolveFicSendConfig(auth.admin, auth.tenantId); }
    catch (e) {
      const m = (e as Error)?.message;
      if (m === "fattureincloud_not_connected" || m === "fattureincloud_no_company") return soft("Fatture in Cloud non è collegato");
      return soft("collegamento a Fatture in Cloud non disponibile");
    }

    // Incassato in Xenora (l'incasso appena registrato è già incluso) e data dell'ultimo incasso.
    const { data: pays } = await auth.admin.from("document_payments").select("amount_cents, paid_at").eq("document_id", documentId).eq("tenant_id", auth.tenantId);
    const rows = (pays ?? []) as { amount_cents: number; paid_at: string | null }[];
    const paidCents = rows.reduce((a, p) => a + (p.amount_cents || 0), 0);
    const last = rows.map((p) => p.paid_at).filter(Boolean).sort().pop();
    const paidDate = last ? todayRome(new Date(last)) : todayRome();

    const r = await markFicPayment(cfg, ref, { paid, amount: paidCents / 100, paidDate });
    return NextResponse.json({ ok: r.ok, kind: r.kind, changed: r.changed, message: r.message });
  } catch (e) {
    return soft((e as Error)?.message || "errore");
  }
}
