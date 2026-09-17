import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { createAutofattura, getAutofatturaXml } from "@/lib/invoicing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Autofattura/integrazione reverse charge (TD17) da una fattura passiva estera.
//   action: "create" (genera + eventuale invio SdI) | "xml" (scarica l'XML)
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const b = await req.json().catch(() => ({}));
    const purchaseDocId = String(b?.purchaseDocId || "").trim();
    const action = String(b?.action || "create").trim();
    if (!purchaseDocId) return NextResponse.json({ error: "missing_doc" }, { status: 400 });
    if (action === "xml") {
      const xml = await getAutofatturaXml(auth.admin, auth.tenantId, purchaseDocId);
      if (!xml) return NextResponse.json({ error: "no_xml", message: "Autofattura non ancora generata." }, { status: 404 });
      return NextResponse.json({ ok: true, xml });
    }
    const res = await createAutofattura(auth.admin, auth.tenantId, purchaseDocId, Number(b?.vatRate) || 22);
    return NextResponse.json(res);
  } catch (e) { return NextResponse.json({ error: "autofattura_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
