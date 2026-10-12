import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import {
  gbpConfigured, gbpStatus, gbpAccessToken, setGbpLocation, disconnectGbp, listGbpAccounts, listGbpLocations, listGbpReviews, replyGbpReview,
  reviewBelongsTo, isAccountName, isLocationName, gbpErrorMessage, type GbpLocation,
} from "@/lib/google-business";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recensioni Google (Business Profile API) per le strutture del tenant.
//   POST { action: "overview", structureId }  → { configured, connected, mapped?: {title}, reviews?, average?, total?, loadError? }
//   POST { action: "locations" }              → sedi a cui l'account collegato ha accesso
//   POST { action: "select", structureId, account, location, title } → collega la struttura a una sede (senza account/location = scollega)
//   POST { action: "reply", structureId, reviewName, text }
//   POST { action: "disconnect" }
// Gli errori di Google tornano come { ok:false, error } già tradotti in italiano.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "overview");
  const structureId = typeof body.structureId === "string" ? body.structureId.trim() : "";
  const configured = gbpConfigured();
  const status = configured ? await gbpStatus(auth.admin, auth.tenantId) : { connected: false, locations: {} as Record<string, GbpLocation> };

  if (action === "overview") {
    const loc = structureId ? status.locations[structureId] : undefined;
    const base = { ok: true, configured, connected: status.connected, ...(loc ? { mapped: { title: loc.title } } : {}) };
    if (!configured || !status.connected || !loc) return NextResponse.json(base);
    try {
      const token = await gbpAccessToken(auth.admin, auth.tenantId);
      const r = await listGbpReviews(token, loc);
      if (!r.ok) return NextResponse.json({ ...base, loadError: gbpErrorMessage(r.status, r.error) });
      return NextResponse.json({ ...base, reviews: r.data!.reviews, average: r.data!.average, total: r.data!.total });
    } catch (e) {
      const reauth = (e as Error)?.message === "gbp_reauth";
      return NextResponse.json({ ...base, ...(reauth ? { connected: false, loadError: gbpErrorMessage(401) } : { loadError: gbpErrorMessage(0) }) });
    }
  }

  if (!configured) return NextResponse.json({ ok: false, error: "Google Business non è configurato sul server." });
  if (action === "disconnect") { await disconnectGbp(auth.admin, auth.tenantId); return NextResponse.json({ ok: true }); }
  if (!status.connected) return NextResponse.json({ ok: false, error: "Google non è collegato." });

  if (action === "select") {
    if (!structureId) return NextResponse.json({ ok: false, error: "Struttura mancante." }, { status: 400 });
    if (!body.location && !body.account) { await setGbpLocation(auth.admin, auth.tenantId, structureId, null); return NextResponse.json({ ok: true }); }
    if (!isAccountName(body.account) || !isLocationName(body.location)) return NextResponse.json({ ok: false, error: "Sede non valida." }, { status: 400 });
    await setGbpLocation(auth.admin, auth.tenantId, structureId, { account: body.account, location: body.location, title: String(body.title || body.location).slice(0, 200) });
    return NextResponse.json({ ok: true });
  }

  let token: string;
  try { token = await gbpAccessToken(auth.admin, auth.tenantId); }
  catch (e) { return NextResponse.json({ ok: false, error: (e as Error)?.message === "gbp_reauth" ? gbpErrorMessage(401) : gbpErrorMessage(0) }); }

  if (action === "locations") {
    const acc = await listGbpAccounts(token);
    if (!acc.ok) return NextResponse.json({ ok: false, error: gbpErrorMessage(acc.status, acc.error) });
    const locations: GbpLocation[] = [];
    for (const a of (acc.data ?? []).slice(0, 5)) {
      const l = await listGbpLocations(token, a.name);
      if (!l.ok) return NextResponse.json({ ok: false, error: gbpErrorMessage(l.status, l.error) });
      locations.push(...(l.data ?? []));
    }
    return NextResponse.json({ ok: true, locations });
  }

  if (action === "reply") {
    const reviewName = typeof body.reviewName === "string" ? body.reviewName.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const loc = structureId ? status.locations[structureId] : undefined;
    if (!loc) return NextResponse.json({ ok: false, error: "Struttura non collegata a una sede Google." }, { status: 404 });
    if (!reviewName || !text) return NextResponse.json({ ok: false, error: "Recensione o testo mancante." }, { status: 400 });
    if (!reviewBelongsTo(reviewName, loc)) return NextResponse.json({ ok: false, error: "Recensione non trovata per questa sede." }, { status: 404 });
    const r = await replyGbpReview(token, reviewName, text.slice(0, 4000));
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: gbpErrorMessage(r.status, r.error) });
  }

  return NextResponse.json({ ok: false, error: "Azione sconosciuta." }, { status: 400 });
}
