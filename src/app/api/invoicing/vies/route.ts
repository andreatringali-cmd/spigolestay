import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Verifica una partita IVA UE tramite il servizio VIES (Commissione Europea).
// Best-effort: se VIES è irraggiungibile, ritorna unknown senza bloccare.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const raw = String(body?.vat || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (raw.length < 4) return NextResponse.json({ error: "bad_vat" }, { status: 400 });
    const country = /^[A-Z]{2}/.test(raw) ? raw.slice(0, 2) : "IT";
    const number = /^[A-Z]{2}/.test(raw) ? raw.slice(2) : raw;
    const r = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${country}/vat/${number}`, { headers: { Accept: "application/json" } });
    if (!r.ok) return NextResponse.json({ ok: true, status: "unknown", message: "Servizio VIES non disponibile, riprova più tardi." });
    const j = await r.json();
    return NextResponse.json({ ok: true, status: j?.isValid ? "valid" : "invalid", valid: !!j?.isValid, name: j?.name ?? null, address: j?.address ?? null, country, number });
  } catch {
    return NextResponse.json({ ok: true, status: "unknown", message: "Verifica non riuscita (VIES)." });
  }
}
