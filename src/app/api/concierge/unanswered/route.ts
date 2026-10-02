import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { dismissUnanswered, listUnanswered } from "@/lib/concierge-unanswered";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Domande a cui non ho saputo rispondere": le registra il webhook WhatsApp (src/lib/concierge-unanswered.ts, blob app_state
// del tenant, nessuna tabella). Questa route le espone alla UI di Xenora e le fa togliere dall'elenco.
// Body: { action: "list" }  →  { ok, items }      |      { action: "dismiss", ids: string[] }  →  { ok }
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const b = await req.json().catch(() => ({}));
    if (b?.action === "dismiss") {
      const ids = (Array.isArray(b?.ids) ? b.ids : []).map((x: unknown) => String(x)).slice(0, 200);
      const ok = await dismissUnanswered(auth.admin, auth.tenantId, ids);
      return NextResponse.json({ ok });
    }
    const items = await listUnanswered(auth.admin, auth.tenantId);
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "unanswered_failed", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
