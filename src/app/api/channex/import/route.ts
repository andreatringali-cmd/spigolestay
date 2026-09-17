import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { importBookings } from "@/lib/channex-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Import manuale delle prenotazioni OTA dal feed Channex, limitato alle property
// del tenant (dalla channex_map). Usato dal pulsante "Importa prenotazioni" in Canali.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const { data: maps } = await auth.admin.from("channex_map").select("channex_property_id").eq("tenant_id", auth.tenantId);
  const props = (maps ?? []).map((m) => m.channex_property_id as string);
  if (!props.length) return NextResponse.json({ ok: false, error: "Nessuna struttura collegata a Channex." }, { status: 200 });
  const tot = { feed: 0, imported: 0, cancelled: 0, acked: 0, skipped: 0, errors: [] as string[] };
  for (const pid of props) {
    const r = await importBookings(auth.admin, { propertyId: pid });
    tot.feed += r.feed; tot.imported += r.imported; tot.cancelled += r.cancelled; tot.acked += r.acked; tot.skipped += r.skipped; tot.errors.push(...r.errors);
  }
  return NextResponse.json({ ok: true, ...tot });
}
