import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { createDocumentFromBooking, type CreateOptions } from "@/lib/invoicing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Crea la BOZZA di documento da una prenotazione.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.bookingId || "").trim();
    if (!bookingId) return NextResponse.json({ error: "missing_booking" }, { status: 400 });
    const options: CreateOptions = (body?.options ?? {}) as CreateOptions;
    const res = await createDocumentFromBooking(auth.admin, auth.tenantId, bookingId, options);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: "create_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 });
  }
}
