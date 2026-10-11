import { handleCheckinExtract } from "@/lib/ai/checkin-extract-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Check-in AI: l'ospite carica una foto del documento e Claude (vision) estrae i campi.
// Implementazione condivisa con /api/checkin/extract (vedi lib/ai/checkin-extract-handler).
// GATING: senza ANTHROPIC_API_KEY → { ok:false, error:"ai_not_configured" }.
// PRIVACY: l'immagine è usata SOLO per l'estrazione, non viene salvata da nessuna parte.
export async function POST(req: Request) {
  return handleCheckinExtract(req);
}
