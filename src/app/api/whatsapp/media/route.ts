import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { fetchWaMedia } from "@/lib/whatsapp-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Riproduce un vocale ricevuto: lo scarica da Meta con il token del tenant e lo restituisce al browser.
// Body: { id }  →  file audio
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const b = await req.json().catch(() => ({}));
  const id = String(b?.id || "");
  const media = await fetchWaMedia(auth.admin, auth.tenantId, id);
  if (!media) return NextResponse.json({ error: "media_unavailable", message: "Vocale non più disponibile (Meta lo conserva circa 30 giorni)" }, { status: 404 });
  return new NextResponse(media.bytes, { headers: { "Content-Type": media.mime.split(";")[0] || "audio/ogg", "Cache-Control": "private, max-age=3600" } });
}
