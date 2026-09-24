import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { saveProviderCredentials, providerCredStatus, testProvider } from "@/lib/invoicing/service";
import { ficStatus, disconnectFic, setFicDryRun, ficConfigured } from "@/lib/invoicing/fic-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gestione credenziali intermediario SdI (token cifrato lato server).
//   action: "save" | "status" | "test" | "disconnect" | "dryrun"
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const b = await req.json().catch(() => ({}));
    const provider = String(b?.provider || "").trim();
    const action = String(b?.action || "status").trim();
    if (!provider) return NextResponse.json({ error: "missing_provider" }, { status: 400 });

    // Fatture in Cloud: gestione OAuth (stato collegamento, prova, scollega).
    if (provider === "fattureincloud") {
      if (action === "disconnect") { await disconnectFic(auth.admin, auth.tenantId); return NextResponse.json({ ok: true, message: "Fatture in Cloud scollegato." }); }
      if (action === "dryrun") { await setFicDryRun(auth.admin, auth.tenantId, !!b?.dryRun); return NextResponse.json({ ok: true, message: b?.dryRun ? "Modalità prova attiva." : "Modalità prova disattivata: gli invii saranno reali." }); }
      if (action === "test") { const r = await testProvider(auth.admin, auth.tenantId, provider); return NextResponse.json(r); }
      const st = await ficStatus(auth.admin, auth.tenantId);
      return NextResponse.json({ ok: true, configured: ficConfigured(), ...st });
    }

    if (action === "save") {
      const res = await saveProviderCredentials(auth.admin, auth.tenantId, provider, {
        token: b?.token || undefined, sandbox: !!b?.sandbox, signature: !!b?.signature, legalStorage: !!b?.legalStorage,
      });
      return NextResponse.json(res);
    }
    if (action === "test") {
      const res = await testProvider(auth.admin, auth.tenantId, provider);
      return NextResponse.json(res);
    }
    const st = await providerCredStatus(auth.admin, auth.tenantId, provider);
    return NextResponse.json({ ok: true, ...st });
  } catch (e) { return NextResponse.json({ error: "provider_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
