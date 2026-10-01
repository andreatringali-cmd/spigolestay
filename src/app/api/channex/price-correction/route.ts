import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { channexEnabled, listChannels, getChannel, setChannelPriceCorrection } from "@/lib/channex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Correzione di prezzo (derived_option) a livello di CONNESSIONE canale, letta/scritta dalla
// pagina Canali invece che dalla dashboard di Channex. Per ora un solo step (+/- percentuale):
// il campo Channex resta un array di step [regola, valore] applicati in ordine, quindi un domani
// si potrà aggiungerne un secondo senza cambiare lo shape qui sotto.
// POST /api/channex/price-correction (bearer) { channelId, action: "get" }
//   → { ok, rule?: "increase_by_percent"|"decrease_by_percent", value?: string }
// POST /api/channex/price-correction (bearer) { channelId, action: "set", rule, value }
async function ownsChannel(auth: { admin: import("@supabase/supabase-js").SupabaseClient; tenantId: string }, channelId: string) {
  const { data: personalRows } = await auth.admin.from("channex_map").select("channex_property_id").eq("tenant_id", auth.tenantId).is("org_id", null);
  const { data: mships } = await auth.admin.from("memberships").select("org_id").eq("user_id", auth.tenantId);
  const orgIds = Array.from(new Set((mships ?? []).map((m) => m.org_id as string).filter(Boolean)));
  const orgRows: { channex_property_id: string }[] = [];
  for (const oid of orgIds) {
    const { data } = await auth.admin.from("channex_map").select("channex_property_id").eq("org_id", oid);
    orgRows.push(...(data ?? []));
  }
  const propertyIds = [...(personalRows ?? []), ...orgRows].map((r) => r.channex_property_id as string).filter(Boolean);
  for (const pid of propertyIds) {
    const res = await listChannels(pid);
    if ((res.data?.data ?? []).some((c) => c.id === channelId)) return true;
  }
  return false;
}

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });

  const body = await req.json().catch(() => ({}));
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  const action = body.action === "set" ? "set" : "get";
  if (!channelId) return NextResponse.json({ ok: false, error: "channelId mancante" }, { status: 400 });

  // Il canale deve appartenere a una property di QUESTO tenant (channelId arriva dal client, non fidato).
  if (!(await ownsChannel(auth, channelId))) return NextResponse.json({ ok: false, error: "Canale non trovato per questo account" }, { status: 404 });

  if (action === "get") {
    const res = await getChannel(channelId);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error || "Lettura non riuscita" }, { status: 200 });
    const steps = res.data?.data?.attributes?.settings?.derived_option?.rate ?? [];
    const [rule, value] = steps[0] ?? [];
    return NextResponse.json({ ok: true, rule: rule || null, value: value || null });
  }

  const rule = body.rule === "increase_by_percent" || body.rule === "decrease_by_percent" ? body.rule : null;
  const rawValue = typeof body.value === "string" ? body.value.replace(",", ".").trim() : "";
  const num = rawValue ? Number(rawValue) : NaN;
  // Nessuna regola/valore → azzera la correzione (array vuoto = nessuno step, prezzo Xenora invariato).
  const steps: [string, string][] = rule && Number.isFinite(num) && num > 0 ? [[rule, num.toFixed(2)]] : [];
  const res = await setChannelPriceCorrection(channelId, steps);
  if (!res.ok) return NextResponse.json({ ok: false, error: friendlyChannexError(res.error) }, { status: 200 });
  return NextResponse.json({ ok: true });
}

// Channex a volte risponde con un errore di validazione sulla connessione del canale stesso
// (es. "hotel_id is required" quando manca un campo nella configurazione di Booking.com/Airbnb
// su Channex), non sulla correzione prezzo che stiamo scrivendo: il messaggio grezzo (JSON) è
// incomprensibile per l'utente, qui lo traduciamo in qualcosa di azionabile.
function friendlyChannexError(raw?: string): string {
  if (!raw) return "Salvataggio non riuscito";
  try {
    const j = JSON.parse(raw) as { details?: Record<string, string[]>; message?: string };
    const fields = j.details ? Object.entries(j.details).map(([k, v]) => `${k}: ${v.join(", ")}`).join("; ") : "";
    if (/hotel_id/i.test(fields) || /hotel_id/i.test(raw)) {
      return "Channex segnala che manca il campo \"Hotel Id\" nella configurazione di questo canale (impostazioni della connessione, non la correzione prezzo). Controllalo su Channex prima di riprovare.";
    }
    if (fields) return `Channex: ${fields}`;
    if (j.message) return `Channex: ${j.message}`;
  } catch { /* non era JSON, mostra il testo così com'è */ }
  return raw.length > 200 ? "Salvataggio non riuscito (errore Channex non leggibile)." : raw;
}
