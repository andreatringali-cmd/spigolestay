import { NextResponse } from "next/server";
import { extractCheckinDoc } from "@/lib/ai/checkin-extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Check-in AI: l'ospite carica una foto del documento e Claude (vision) estrae i campi.
// POST { image: dataURL } → { ok:true, fields:{...} } oppure { ok:false, error:"..." }.
// GATING: se ANTHROPIC_API_KEY manca → { ok:false, error:"ai_not_configured" } (nessun crash).
// PRIVACY: l'immagine è usata SOLO per l'estrazione, non viene salvata da nessuna parte.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const image = String(body?.image || "");
  const r = await extractCheckinDoc(image);
  if (!r.ok) {
    const { status, ...payload } = r;
    return NextResponse.json(payload, { status });
  }
  return NextResponse.json({ ok: true, fields: r.fields });
}
