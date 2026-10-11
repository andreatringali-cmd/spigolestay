import { NextResponse } from "next/server";
import { extractCheckinDoc } from "./checkin-extract";
import { rateLimited } from "../server-auth";
import { clientIp } from "../server-booking-guard";

// Handler UNICO per l'estrazione dei dati dal documento. Montato su entrambi gli URL
// (/api/checkin/extract e /api/ai/checkin-extract) che restano quindi equivalenti.
// POST { image: dataURL } → { ok:true, fields } | { ok:false, error, message? }.
// Limite di richieste per IP (chiamata a pagamento verso l'API AI), condiviso fra i due URL.
export const EXTRACT_MAX_PER_MINUTE = 10;

export async function handleCheckinExtract(req: Request): Promise<Response> {
  if (rateLimited("ckx:" + clientIp(req), EXTRACT_MAX_PER_MINUTE, 60_000)) {
    return NextResponse.json({ ok: false, error: "troppe_richieste" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const image = String(body?.image || "");
  const r = await extractCheckinDoc(image);
  if (!r.ok) {
    const { status, ...payload } = r;
    return NextResponse.json(payload, { status });
  }
  return NextResponse.json({ ok: true, fields: r.fields });
}
