import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { channexEnabled, listChannels, getChannel, setChannelPriceCorrection } from "@/lib/channex";
import { parseCorrection, signedPct, validateCorrectionInput, explainChannexError, correctionToApi } from "@/lib/priceCorrection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Correzione di prezzo (derived_option) a livello di CONNESSIONE canale, letta/scritta dalla
// pagina Canali invece che dalla dashboard di Channex. Per ora un solo step (+/- percentuale):
// il campo Channex resta un array di step [regola, valore] applicati in ordine, quindi un domani
// si potrà aggiungerne un secondo senza cambiare lo shape qui sotto.
//
// POST /api/channex/price-correction (bearer) { channelId, action: "get", structureId? }
//   → { ok, rule: "increase_by_percent"|"decrease_by_percent"|null, value: string|null }
// POST /api/channex/price-correction (bearer) { channelId, action: "set", rule, value, structureId? }
//   → { ok, previous: {rule,value}|null, previousKnown, applied: {rule,value}|null, verified, unchanged?, code?, error? }
//   `previous` = valore letto da Channex PRIMA della scrittura; `applied` = valore RILETTO da Channex DOPO
//   (verifica reale: se non coincide con quello richiesto, `verified` è false e lo diciamo all'utente).
//
// Se arriva `structureId` il canale deve appartenere a una property collegata A QUELLA struttura
// (indipendenza per struttura: una correzione non può toccare canali di un'altra struttura).
type Auth = { admin: SupabaseClient; tenantId: string };

async function propertyIdsFor(auth: Auth, structureId?: string): Promise<string[]> {
  let q1 = auth.admin.from("channex_map").select("channex_property_id").eq("tenant_id", auth.tenantId).is("org_id", null);
  if (structureId) q1 = q1.eq("structure_id", structureId);
  const { data: personalRows } = await q1;
  const { data: mships } = await auth.admin.from("memberships").select("org_id").eq("user_id", auth.tenantId);
  const orgIds = Array.from(new Set((mships ?? []).map((m) => m.org_id as string).filter(Boolean)));
  const orgRows: { channex_property_id: string }[] = [];
  for (const oid of orgIds) {
    let q = auth.admin.from("channex_map").select("channex_property_id").eq("org_id", oid);
    if (structureId) q = q.eq("structure_id", structureId);
    const { data } = await q;
    orgRows.push(...(data ?? []));
  }
  return Array.from(new Set([...(personalRows ?? []), ...orgRows].map((r) => r.channex_property_id as string).filter(Boolean)));
}

async function ownsChannel(auth: Auth, channelId: string, structureId?: string) {
  for (const pid of await propertyIdsFor(auth, structureId)) {
    const res = await listChannels(pid);
    if ((res.data?.data ?? []).some((c) => c.id === channelId)) return true;
  }
  return false;
}

// Legge la correzione corrente da Channex. `known:false` se la lettura è fallita (non sappiamo il valore).
async function readCorrection(channelId: string) {
  const res = await getChannel(channelId);
  if (!res.ok) return { ok: false as const, status: res.status, error: res.error, known: false as const, correction: null };
  const steps = res.data?.data?.attributes?.settings?.derived_option?.rate ?? [];
  const [rule, value] = steps[0] ?? [];
  return { ok: true as const, status: res.status, known: true as const, correction: parseCorrection(rule, value) };
}

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!channexEnabled()) return NextResponse.json({ ok: false, code: "not_configured", error: explainChannexError(0, "CHANNEX_API_KEY non configurata") }, { status: 200 });

  const body = await req.json().catch(() => ({}));
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  const structureId = typeof body.structureId === "string" && body.structureId && body.structureId !== "all" ? body.structureId : undefined;
  const action = body.action === "set" ? "set" : "get";
  if (!channelId) return NextResponse.json({ ok: false, code: "bad_request", error: "channelId mancante" }, { status: 400 });

  // Il canale deve appartenere a una property di QUESTO tenant (e, se indicata, di QUELLA struttura):
  // channelId e structureId arrivano dal client, non fidati.
  if (!(await ownsChannel(auth, channelId, structureId))) {
    return NextResponse.json({ ok: false, code: "not_found", error: structureId ? "Canale non trovato per la struttura selezionata" : "Canale non trovato per questo account" }, { status: 404 });
  }

  if (action === "get") {
    const cur = await readCorrection(channelId);
    if (!cur.ok) return NextResponse.json({ ok: false, code: "read_failed", error: explainChannexError(cur.status, cur.error) }, { status: 200 });
    const api = correctionToApi(cur.correction);
    return NextResponse.json({ ok: true, rule: api?.rule ?? null, value: api?.value ?? null });
  }

  // ── set ──
  // Validazione LATO SERVER (il client non è fidato): stesso criterio dell'interfaccia.
  const rawValue = typeof body.value === "string" ? body.value : typeof body.value === "number" ? String(body.value) : "";
  const check = validateCorrectionInput(String(body.rule ?? ""), rawValue);
  // Nessuna regola/valore (o zero) → azzera la correzione (array vuoto = nessuno step, prezzo Xenora invariato).
  // Una regola non riconosciuta con valore vuoto è comunque un azzeramento esplicito.
  if (!check.ok && rawValue.trim() !== "") return NextResponse.json({ ok: false, code: "invalid", error: check.error }, { status: 200 });
  const target = check.ok ? check.correction : null;

  // Valore PRIMA della scrittura (serve allo storico/ripristino); se la lettura fallisce non blocchiamo la scrittura.
  const before = await readCorrection(channelId);
  const previousApi = before.ok ? correctionToApi(before.correction) : null;
  if (before.ok && signedPct(before.correction) === signedPct(target)) {
    return NextResponse.json({ ok: true, unchanged: true, previous: previousApi, previousKnown: true, applied: previousApi, verified: true });
  }

  const steps: [string, string][] = target ? [[target.rule, target.value.toFixed(2)]] : [];
  const res = await setChannelPriceCorrection(channelId, steps);
  if (!res.ok) return NextResponse.json({ ok: false, code: "write_failed", previous: previousApi, previousKnown: before.ok, error: explainChannexError(res.status, res.error) }, { status: 200 });

  // Verifica reale: rilegge da Channex e confronta con quanto richiesto.
  const after = await readCorrection(channelId);
  const verified = after.ok && signedPct(after.correction) === signedPct(target);
  return NextResponse.json({
    ok: true,
    previous: previousApi,
    previousKnown: before.ok,
    applied: after.ok ? correctionToApi(after.correction) : null,
    verified,
    ...(after.ok && !verified ? { warning: "Channex ha risposto OK ma il valore riletto è diverso da quello richiesto: controlla il canale." } : {}),
    ...(!after.ok ? { warning: "Salvato, ma non sono riuscito a rileggere il valore da Channex per verificarlo." } : {}),
  });
}
