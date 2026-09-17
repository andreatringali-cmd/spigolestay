import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { encryptCred } from "@/lib/crypto-creds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Salva le impostazioni ISTAT cifrando la password lato server (AES-256-GCM).
// La password viaggia in chiaro SOLO nel body HTTPS verso questa route; non
// viene mai ri-letta dal client. Se il campo password è vuoto, si mantiene quella
// già salvata (l'utente lascia il campo vuoto per non cambiarla).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const b = await req.json().catch(() => ({}));
    const structureId = String(b?.structureId || "").trim();
    if (!structureId) return NextResponse.json({ error: "missing_structure" }, { status: 400 });

    const { data: existing } = await auth.admin.from("istat_settings").select("password_enc").eq("tenant_id", auth.tenantId).eq("structure_id", structureId).maybeSingle();

    const password_enc = b?.password ? encryptCred(String(b.password)) : (existing?.password_enc ?? null);
    const row = {
      tenant_id: auth.tenantId, structure_id: structureId,
      region: String(b?.region ?? "") || null,
      partner: String(b?.partner ?? "") || null,
      username: String(b?.username ?? "") || null,
      password_enc,
      auto_daily: !!b?.auto_daily,
      start_from: b?.start_from ? String(b.start_from) : null,
      updated_at: new Date().toISOString(),
    };
    const res = await auth.admin.from("istat_settings").upsert(row, { onConflict: "tenant_id,structure_id" });
    if (res.error) return NextResponse.json({ error: "save_failed", message: res.error.message }, { status: 400 });
    return NextResponse.json({ ok: true, message: "Impostazioni salvate ✓" });
  } catch (e) { return NextResponse.json({ error: "save_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
