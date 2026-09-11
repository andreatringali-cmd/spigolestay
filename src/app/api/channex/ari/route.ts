import { NextResponse } from "next/server";
import { channexEnabled, pushAvailability, pushRates, type AvailValue, type RateValue } from "@/lib/channex";

// Aggiorna disponibilità e prezzi su Channex (poi Channex li spinge alle OTA).
// POST /api/channex/ari  body: { availability: AvailValue[], rates: RateValue[] }
export async function POST(req: Request) {
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });
  const body = await req.json().catch(() => null) as null | { availability?: AvailValue[]; rates?: RateValue[] };
  const availability = body?.availability ?? [];
  const rates = body?.rates ?? [];
  if (availability.length === 0 && rates.length === 0) return NextResponse.json({ ok: false, error: "Nessun dato da inviare" }, { status: 400 });

  const av = availability.length ? await pushAvailability(availability) : { ok: true, status: 200 };
  const rt = rates.length ? await pushRates(rates) : { ok: true, status: 200 };

  const ok = av.ok && rt.ok;
  return NextResponse.json({
    ok,
    availability: { ok: av.ok, sent: availability.length, error: av.ok ? undefined : (av as { error?: string }).error },
    rates: { ok: rt.ok, sent: rates.length, error: rt.ok ? undefined : (rt as { error?: string }).error },
  }, { status: 200 });
}
