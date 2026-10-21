import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { siteOrigin } from "@/lib/server-auth";
import { shadowStructureScope } from "@/lib/entities-shadow";
import { deliverPuliziePlan, romeNowSlot } from "@/lib/pulizie-send";
import type { Booking, Unit, RoomType, Structure, Guest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/pulizie/send-now (bearer) { structureId }
// Invia SUBITO il Planning pulizie di oggi per quella struttura, con le impostazioni di "Invio automatico" già SALVATE (destinatari ed email/WhatsApp),
// usando la stessa logica del cron. Serve per provare senza aspettare l'orario. Non tocca il segno "già inviato oggi" del cron.
// Risponde con l'esito di ogni canale (e l'errore grezzo se non è partito).
const DATA_KEY = "spigolestay:data:v1";
const NOTES_KEY = "spigolestay:pulizie:notes";
const CFG_PREFIX = "spigolestay:pulizie:autoshare:";
type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const body = await req.json().catch(() => ({}));
  const structureId = typeof body?.structureId === "string" ? body.structureId.trim() : "";
  if (!structureId) return NextResponse.json({ ok: false, error: "Struttura mancante." }, { status: 400 });

  // La struttura può stare nei dati personali o in un'org condivisa di cui l'utente fa parte.
  const blobs: Record<string, string>[] = [];
  const blobOwners: { type: "u" | "o"; id: string }[] = []; // di chi e' ciascun blocco (per il confronto con le tabelle)
  const { data: personal } = await auth.admin.from("app_state").select("data").eq("user_id", auth.tenantId).maybeSingle();
  if (personal?.data) { blobs.push(personal.data as Record<string, string>); blobOwners.push({ type: "u", id: auth.tenantId }); }
  const { data: mships } = await auth.admin.from("memberships").select("org_id").eq("user_id", auth.tenantId);
  for (const oid of Array.from(new Set((mships ?? []).map((m) => m.org_id as string).filter(Boolean)))) {
    const { data: os } = await auth.admin.from("org_state").select("data").eq("org_id", oid).maybeSingle();
    if (os?.data) { blobs.push(os.data as Record<string, string>); blobOwners.push({ type: "o", id: oid }); }
  }
  for (const [bi, blob] of blobs.entries()) {
    let data: Json = {};
    try { data = JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { continue; }
    const st = arr(data.structures).find((x) => x.id === structureId) as unknown as Structure | undefined;
    if (!st) continue;
    await shadowStructureScope(auth.admin, "pulizie/send-now.structure", blobOwners[bi], structureId, data); // Fase 3, passo 1: solo con SERVER_READ_ENTITIES=compare; i dati usati restano quelli del blocco
    let cfg: { enabled?: boolean; email?: boolean; emailTo?: string; emailCc?: string[]; whatsapp?: boolean; whatsappTo?: string; intro?: string; outro?: string; subject?: string } = {};
    // Impostazioni e note stanno nei dati personali dell'utente, anche se la struttura vive in un'organizzazione condivisa (prima: «Nessun destinatario salvato»).
    const personalBlob = (personal?.data ?? {}) as Record<string, string>;
    try { cfg = JSON.parse(personalBlob[CFG_PREFIX + structureId] || blob[CFG_PREFIX + structureId] || "{}"); } catch { cfg = {}; }
    const wantsEmail = !!cfg.email && !!cfg.emailTo, wantsWa = false; // il planning parte solo per email
    if (!wantsEmail && !wantsWa) return NextResponse.json({ ok: false, error: "Nessun destinatario salvato: scegli l'email in Invio automatico, poi premi Salva." });
    let notes: Record<string, string> = {};
    try { notes = JSON.parse(personalBlob[NOTES_KEY] || blob[NOTES_KEY] || "{}") as Record<string, string>; } catch { notes = {}; }
    const results = await deliverPuliziePlan({
      admin: auth.admin, tenantId: auth.tenantId, origin: siteOrigin(req), structure: st,
      cfg: { email: !!cfg.email, emailTo: cfg.emailTo ?? "", emailCc: Array.isArray(cfg.emailCc) ? cfg.emailCc.filter((x) => typeof x === "string") : [], whatsapp: false, whatsappTo: "", intro: cfg.intro, outro: cfg.outro, subject: cfg.subject },
      date: romeNowSlot().ymd,
      units: arr(data.units) as unknown as Unit[], roomTypes: arr(data.roomTypes) as unknown as RoomType[],
      bookings: arr(data.bookings) as unknown as Booking[], guests: arr(data.guests) as unknown as Guest[], notes,
    });
    return NextResponse.json({ ok: results.some((r) => r.ok), results });
  }
  return NextResponse.json({ ok: false, error: "Struttura non trovata per questo account." }, { status: 404 });
}
