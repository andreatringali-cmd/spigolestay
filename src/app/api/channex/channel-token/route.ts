import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { channexEnabled, channexBase, createChannelOneTimeToken } from "@/lib/channex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Genera il token per aprire (in iframe, dentro Xenora) l'interfaccia di collegamento canali di
// Channex per UNA struttura già collegata. Verifica che il chiamante sia davvero il proprietario
// (personale) o un membro dell'organizzazione a cui appartiene quella mappatura, prima di generare
// il token — altrimenti chiunque autenticato potrebbe chiedere il token di una property altrui.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });

  const body = await req.json().catch(() => null) as { structureId?: string } | null;
  const structureId = String(body?.structureId || "").trim();
  if (!structureId) return NextResponse.json({ ok: false, error: "structureId mancante" }, { status: 400 });

  // Più righe possono avere lo stesso structure_id (id scelti dal client, copie personale/org): con maybeSingle()
  // un duplicato faceva fallire la lettura. Si prendono tutte e si usa solo una riga di cui il chiamante è davvero titolare.
  const { data: maps } = await auth.admin.from("channex_map").select("channex_property_id, tenant_id, org_id").eq("structure_id", structureId);
  const rows = (maps ?? []).filter((m) => m.channex_property_id);
  if (!rows.length) return NextResponse.json({ ok: false, error: "Struttura non collegata a un canale manager." }, { status: 200 });

  // Autorizzazione: proprietario diretto, oppure membro dell'organizzazione proprietaria della mappatura.
  const { data: mships } = await auth.admin.from("memberships").select("org_id").eq("user_id", auth.tenantId);
  const myOrgs = new Set((mships ?? []).map((m) => m.org_id as string).filter(Boolean));
  const map = rows.find((m) => m.tenant_id === auth.tenantId) ?? rows.find((m) => m.org_id && myOrgs.has(m.org_id as string));
  if (!map) return NextResponse.json({ ok: false, error: "Non autorizzato per questa struttura." }, { status: 403 });

  const { data: who } = await auth.admin.auth.admin.getUserById(auth.tenantId);
  const username = who?.user?.email || "utente";

  const res = await createChannelOneTimeToken(String(map.channex_property_id), username);
  if (!res.ok || !res.data?.data?.token) return NextResponse.json({ ok: false, error: res.error || "Impossibile generare il token" }, { status: 200 });

  return NextResponse.json({ ok: true, token: res.data.data.token, propertyId: map.channex_property_id, base: channexBase().replace(/\/api\/v1$/, "") });
}
