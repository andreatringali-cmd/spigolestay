import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { channexEnabled } from "@/lib/channex";
import { ensureChannexHooks } from "@/lib/channex-hooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Registra (in modo idempotente) il webhook Channex per le property del tenant, così le
// prenotazioni OTA arrivano in TEMPO REALE senza premere nulla. Callback fisso su xenora.it
// (dev'essere un URL pubblico raggiungibile da Channex, anche da staging).
// POST /api/channex/webhook-setup (bearer)
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });

  const { data: maps } = await auth.admin.from("channex_map").select("channex_property_id").eq("tenant_id", auth.tenantId);
  const props = Array.from(new Set((maps ?? []).map((m) => m.channex_property_id as string).filter(Boolean)));
  if (!props.length) return NextResponse.json({ ok: false, error: "Nessuna struttura collegata a Channex." }, { status: 200 });

  const { callbackUrl, result } = await ensureChannexHooks(props);
  return NextResponse.json({ ok: true, callbackUrl, result });
}
