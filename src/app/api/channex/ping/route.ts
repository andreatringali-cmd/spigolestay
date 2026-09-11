import { NextResponse } from "next/server";
import { channexEnabled, channexBase, listProperties } from "@/lib/channex";

// Test di connessione a Channex: verifica che la API key funzioni.
// GET /api/channex/ping  →  { enabled, connected, properties, base } — non espone mai la chiave.
export async function GET() {
  if (!channexEnabled()) {
    return NextResponse.json({ enabled: false, connected: false, message: "CHANNEX_API_KEY non configurata" }, { status: 200 });
  }
  const res = await listProperties();
  if (!res.ok) {
    return NextResponse.json({ enabled: true, connected: false, base: channexBase(), status: res.status, error: res.error }, { status: 200 });
  }
  const count = Array.isArray(res.data?.data) ? res.data!.data.length : 0;
  return NextResponse.json({ enabled: true, connected: true, base: channexBase(), properties: count }, { status: 200 });
}
