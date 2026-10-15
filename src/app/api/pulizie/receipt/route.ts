import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import {
  RECEIPT_BUCKET, RECEIPT_MAX_BYTES, RECEIPT_SIGNED_SECONDS, cleanFileName, isReceiptPathOf, newUuid,
  receiptPathFor, sniffReceiptType, validateReceiptFile,
} from "@/lib/pulizie-purchase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scontrini degli acquisti dell'addetta. Bucket PRIVATO "receipts" su Supabase Storage, un file per scontrino in <tenantId>/<uuid>.<ext>.
// tenantId = titolare del workspace (anche per i collaboratori, vedi authTenant). Nulla è leggibile senza passare da qui:
//  - POST (multipart "file")  → carica e restituisce il riferimento { path, name, type };
//  - GET ?path=…              → URL firmato temporaneo (solo per file dell'account);
//  - DELETE ?path=…           → toglie un file dell'account (scontrino rimosso prima di salvare).

let bucketReady = false;
async function ensureBucket(admin: import("@supabase/supabase-js").SupabaseClient) {
  if (bucketReady) return;
  await admin.storage.createBucket(RECEIPT_BUCKET, { public: false, fileSizeLimit: RECEIPT_MAX_BYTES }).catch(() => {}); // ignora se esiste già
  bucketReady = true;
}

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > RECEIPT_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "too_large", message: "Il file è troppo grande." }, { status: 413 });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "missing_file", message: "Nessun file." }, { status: 400 });
    const check = validateReceiptFile({ type: file.type, size: file.size });
    if (!check.ok) return NextResponse.json({ error: "invalid_file", message: check.error }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const real = sniffReceiptType(bytes);
    if (!real || real !== check.type) return NextResponse.json({ error: "invalid_file", message: "Il contenuto del file non corrisponde al formato." }, { status: 400 });
    await ensureBucket(auth.admin);
    const path = receiptPathFor(auth.tenantId, newUuid(), check.ext);
    const { error } = await auth.admin.storage.from(RECEIPT_BUCKET).upload(path, bytes, { contentType: real, upsert: false });
    if (error) return NextResponse.json({ error: "upload_failed", message: "Impossibile salvare lo scontrino. Riprova." }, { status: 502 });
    return NextResponse.json({ ok: true, receipt: { path, name: cleanFileName(file.name), type: real } });
  } catch (e) { return NextResponse.json({ error: "upload_failed", message: (e as Error)?.message ?? "errore" }, { status: 500 }); }
}

export async function GET(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const path = new URL(req.url).searchParams.get("path");
  if (!isReceiptPathOf(auth.tenantId, path)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data, error } = await auth.admin.storage.from(RECEIPT_BUCKET).createSignedUrl(path, RECEIPT_SIGNED_SECONDS);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "not_found", message: "Scontrino non trovato." }, { status: 404 });
  return NextResponse.json({ ok: true, url: data.signedUrl, expiresIn: RECEIPT_SIGNED_SECONDS });
}

export async function DELETE(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const path = new URL(req.url).searchParams.get("path");
  if (!isReceiptPathOf(auth.tenantId, path)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { error } = await auth.admin.storage.from(RECEIPT_BUCKET).remove([path]);
  if (error) return NextResponse.json({ error: "delete_failed" }, { status: 502 });
  return NextResponse.json({ ok: true });
}
