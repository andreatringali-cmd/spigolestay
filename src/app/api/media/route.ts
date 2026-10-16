import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { MEDIA_MAX_BYTES, SIGNED_URL_SECONDS, authorizeRef, bucketOf, checkUpload, publicUrlOf, uploadTarget, type MediaVisibility } from "@/lib/media";
import { memberOrgIds, putMedia, removeMedia, signedUrlOf } from "@/lib/media-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Foto e documenti su Supabase Storage (vedi lib/media.ts per il formato dei riferimenti "media:<bucket>:<percorso>").
//  - POST (multipart: file, visibility = public|private, orgId opzionale) → { ok, ref, url? }  (url solo per i pubblici);
//  - GET ?ref=…    → pubblico: { url } pubblico; privato: { url } FIRMATO per 5 minuti, solo se il file è del chiamante
//                    (suo account) o di un'organizzazione di cui è membro;
//  - DELETE ?ref=… → toglie il file (stesse verifiche di accesso).
// Nulla di privato è leggibile senza passare da qui. L'accesso si decide dal solo percorso (canAccessPath).

const err = (status: number, error: string, message: string) => NextResponse.json({ error, message }, { status });

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > MEDIA_MAX_BYTES + 64 * 1024) return err(413, "too_large", "Il file è troppo grande.");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return err(400, "missing_file", "Nessun file.");
    const vis = String(form?.get("visibility") || "");
    if (vis !== "public" && vis !== "private") return err(400, "bad_visibility", "Visibilità non valida.");
    const visibility = vis as MediaVisibility;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkUpload({ visibility, declaredType: file.type, bytes });
    if (!check.ok) return err(400, "invalid_file", check.error);
    const orgIds = await memberOrgIds(auth.admin, [auth.userId, auth.tenantId]);
    const orgIdRaw = form?.get("orgId");
    const target = uploadTarget({ tenantId: auth.tenantId, orgIds }, typeof orgIdRaw === "string" ? orgIdRaw : null);
    if (!target.ok) return err(403, "forbidden", target.error);
    const ref = await putMedia(auth.admin, { bucket: bucketOf(visibility), scope: target.scope, id: target.id, mime: check.mime, bytes });
    return NextResponse.json(visibility === "public" ? { ok: true, ref, url: publicUrlOf(ref) } : { ok: true, ref });
  } catch (e) { return err(500, "upload_failed", (e as Error)?.message ?? "Impossibile salvare il file."); }
}

export async function GET(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const ref = new URL(req.url).searchParams.get("ref");
  const orgIds = await memberOrgIds(auth.admin, [auth.userId, auth.tenantId]);
  const a = authorizeRef(ref, { tenantId: auth.tenantId, orgIds }, "read");
  if (!a.ok) return err(a.status, a.status === 403 ? "forbidden" : "bad_ref", a.error);
  if (a.ref.visibility === "public") return NextResponse.json({ ok: true, url: publicUrlOf(ref) });
  const url = await signedUrlOf(auth.admin, ref as string, SIGNED_URL_SECONDS);
  if (!url) return err(404, "not_found", "File non trovato.");
  return NextResponse.json({ ok: true, url, expiresIn: SIGNED_URL_SECONDS });
}

export async function DELETE(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const ref = new URL(req.url).searchParams.get("ref");
  const orgIds = await memberOrgIds(auth.admin, [auth.userId, auth.tenantId]);
  const a = authorizeRef(ref, { tenantId: auth.tenantId, orgIds }, "delete");
  if (!a.ok) return err(a.status, a.status === 403 ? "forbidden" : "bad_ref", a.error);
  if (!(await removeMedia(auth.admin, ref as string))) return err(502, "delete_failed", "Impossibile eliminare il file.");
  return NextResponse.json({ ok: true });
}
