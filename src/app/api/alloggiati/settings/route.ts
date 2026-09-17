import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { encryptCred } from "@/lib/crypto-creds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Salva le impostazioni Alloggiati Web cifrando password e chiave WS lato server
// (AES-256-GCM). Le credenziali viaggiano in chiaro SOLO nel body HTTPS verso
// questa route e non vengono mai ri-lette dal client. Campo vuoto = mantieni il
// valore già salvato (l'utente lascia vuoto per non cambiarlo).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const b = await req.json().catch(() => ({}));
    const structureId = String(b?.structureId || "").trim();
    if (!structureId) return NextResponse.json({ error: "missing_structure" }, { status: 400 });

    // PK = (tenant_id, structure_id): niente colonna id. Upsert su quel conflitto.
    const { data: existing } = await auth.admin.from("alloggiati_settings").select("password_enc, ws_code_enc").eq("tenant_id", auth.tenantId).eq("structure_id", structureId).maybeSingle();

    const password_enc = b?.password ? encryptCred(String(b.password)) : (existing?.password_enc ?? null);
    const ws_code_enc = b?.wsCode ? encryptCred(String(b.wsCode)) : (existing?.ws_code_enc ?? null);
    const row = {
      tenant_id: auth.tenantId, structure_id: structureId,
      username: String(b?.username ?? "") || null,
      password_enc,
      ws_code_enc,
      ws_code_expires_at: b?.ws_code_expires_at ? String(b.ws_code_expires_at) : null,
      auto_daily: !!b?.auto_daily,
      group_guests: b?.group_guests !== false,
      group_by_room: !!b?.group_by_room,
      updated_at: new Date().toISOString(),
    };
    const res = await auth.admin.from("alloggiati_settings").upsert(row, { onConflict: "tenant_id,structure_id" });
    if (res.error) return NextResponse.json({ error: "save_failed", message: res.error.message }, { status: 400 });
    return NextResponse.json({ ok: true, message: "Impostazioni salvate ✓" });
  } catch (e) { return NextResponse.json({ error: "save_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
