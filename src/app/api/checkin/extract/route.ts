import { handleCheckinExtract } from "@/lib/ai/checkin-extract-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// URL storico (usato dal gestionale): stessa implementazione di /api/ai/checkin-extract.
export async function POST(req: Request) {
  return handleCheckinExtract(req);
}
