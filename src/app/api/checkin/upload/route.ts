import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { findBookingStore, findBookingStoreById } from "@/lib/manage-booking";
import { clientIp } from "@/lib/server-booking-guard";
import { rateLimited } from "@/lib/server-auth";
import { MEDIA_MAX_BYTES, PRIVATE_BUCKET } from "@/lib/media";
import { putMedia } from "@/lib/media-server";
import { checkinInactiveReason } from "@/lib/checkin-sanitize";
import { signUploadToken, storeMediaTarget, uploadSecret, validateCheckinFile, type AttachmentKind, type MediaTarget } from "@/lib/checkin-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Upload ANONIMO di UN allegato del check-in (foto documento o firma) nel bucket PRIVATO.
//   POST multipart: slug (opz.), b (id prenotazione), kind = photo|signature, file  →  { ok, ref, token }
// - Il file va alla cartella del PROPRIETARIO della prenotazione (org condivisa → o/<orgId>/…, altrimenti u/<ownerId>/…): il percorso lo
//   costruisce il server, mai il client. La prenotazione deve esistere.
// - Stessi controlli di /api/media: tipo reale dai byte (jpeg/png/webp/pdf; la firma solo immagine), massimo 4 MB, non vuoto.
// - Il token restituito (HMAC su prenotazione + riferimento) serve al POST finale di /api/checkin per accettare il riferimento.
// - Limite di frequenza per IP e per prenotazione. Nessun endpoint qui legge file: la lettura passa solo da /api/media (autenticata).

const err = (status: number, error: string, message: string) => NextResponse.json({ ok: false, error, message }, { status });

// Piccola cache in memoria (per istanza) del "dove vive la prenotazione": evita di rifare la ricerca ad ogni foto dello stesso check-in.
const targetCache = new Map<string, { t: MediaTarget; exp: number; inactive: boolean }>();
const TARGET_TTL_MS = 5 * 60 * 1000;

export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return err(503, "supabase_not_configured", "Servizio non disponibile.");
  const secret = uploadSecret();
  if (!secret) return err(503, "not_configured", "Servizio non disponibile.");
  try {
    if (rateLimited("ciu:" + clientIp(req), 60, 60_000)) return err(429, "troppe_richieste", "Troppe richieste: riprova tra un minuto.");
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > MEDIA_MAX_BYTES + 64 * 1024) return err(413, "too_large", "Il file è troppo grande.");
    const form = await req.formData().catch(() => null);
    if (!form) return err(400, "bad_request", "Richiesta non valida.");
    const slug = String(form.get("slug") || "").trim().slice(0, 120);
    const bid = String(form.get("b") || "").trim().slice(0, 80);
    const kindRaw = String(form.get("kind") || "photo");
    const file = form.get("file");
    if (!bid || !file || typeof file === "string") return err(400, "missing_params", "Dati mancanti.");
    if (kindRaw !== "photo" && kindRaw !== "signature") return err(400, "bad_kind", "Tipo di allegato non valido.");
    const kind = kindRaw as AttachmentKind;
    if (rateLimited("ciub:" + bid, 120, 10 * 60_000)) return err(429, "troppe_richieste", "Troppe richieste: riprova tra qualche minuto.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = validateCheckinFile(kind, file.type, bytes);
    if (!check.ok) return err(400, "invalid_file", check.error);

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    let target: MediaTarget | null = null;
    const cached = targetCache.get(bid);
    let inactive = false;
    if (cached && cached.exp > Date.now()) { target = cached.t; inactive = cached.inactive; }
    else {
      let store = slug ? await findBookingStore(admin, slug, bid) : null;
      if (!store) store = await findBookingStoreById(admin, bid);
      if (!store) return err(404, "not_found", "Prenotazione non trovata.");
      target = storeMediaTarget(store);
      // Prenotazione annullata / no-show: niente nuovi documenti (il soggiorno concluso lo gestisce il POST, che lo ammette solo all operatore).
      inactive = checkinInactiveReason(store.booking) === "cancelled";
      targetCache.set(bid, { t: target, exp: Date.now() + TARGET_TTL_MS, inactive });
      if (targetCache.size > 500) for (const [k, v] of targetCache) if (v.exp < Date.now()) targetCache.delete(k);
    }
    if (inactive) return err(409, "booking_inactive", "Prenotazione non più attiva.");
    const ref = await putMedia(admin, { bucket: PRIVATE_BUCKET, scope: target.scope, id: target.id, mime: check.mime, bytes });
    return NextResponse.json({ ok: true, ref, token: signUploadToken(secret, bid, ref) });
  } catch (e) { return err(500, "upload_failed", (e as Error)?.message ?? "Impossibile salvare il file."); }
}
